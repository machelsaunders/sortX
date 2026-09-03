'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Type, FolderPlus, Loader2 } from 'lucide-react'
import RootNode from './root-node'
import CategoryNode from './category-node'
import TweetNode from './tweet-node'
import TopicNode from './topic-node'
import ChainEdge from './chain-edge'
import { MindmapContext } from './mindmap-context'
import { ringLayout, spiralLayout, tweetDiameter, topicDiameter, categoryDiameter } from '@/lib/mindmap-layout'

const nodeTypes = { root: RootNode, category: CategoryNode, tweet: TweetNode, topic: TopicNode }
const edgeTypes = { chain: ChainEdge }

function nodeDiameter(n: Node): number {
  const d = n.data as { diameter?: number; count?: number; size?: number; likeCount?: number }
  if (typeof d.diameter === 'number') return d.diameter
  if (n.type === 'category') return categoryDiameter(d.count ?? 0)
  if (n.type === 'topic') return topicDiameter(d.size ?? 0)
  if (n.type === 'tweet') return tweetDiameter(d.likeCount)
  return 140
}

function centerOf(n: Node): { x: number; y: number } {
  const d = nodeDiameter(n)
  return { x: n.position.x + d / 2, y: n.position.y + d / 2 }
}

/** Posts around a parent node: bigger (more-liked) posts get more room. */
function layoutTweetNodes(nodes: Node[], center: Node): Node[] {
  const diameters = nodes.map(tweetDiameterOf)
  const positions = spiralLayout(diameters, centerOf(center), nodeDiameter(center) / 2 + 70)
  return nodes.map((n, i) => ({ ...n, position: positions[i] }))
}

function tweetDiameterOf(n: Node): number {
  return tweetDiameter((n.data as { likeCount?: number }).likeCount)
}

// ── Canvas ────────────────────────────────────────────────────────────────────

interface MindmapCanvasProps {
  initialNodes: Node[]
  initialEdges: Edge[]
  /** Called after the category set changes (e.g. a topic was promoted) so the page can refetch */
  onGraphChanged?: () => void
}

type ViewMode = 'categories' | 'focused' | 'topic'

export default function MindmapCanvas({ initialNodes, initialEdges, onGraphChanged }: MindmapCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const rf = useRef<ReactFlowInstance | null>(null)
  /** Re-frame the graph after the visible node set changes */
  const refit = useCallback(() => {
    setTimeout(() => rf.current?.fitView({ padding: 0.18, duration: 450 }), 60)
  }, [])
  const [viewMode, setViewMode] = useState<ViewMode>('categories')
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null)
  const [tweetCache, setTweetCache] = useState<Record<string, { nodes: Node[]; edges: Edge[] }>>({})
  const [bgColor, setBgColor] = useState('#111113')
  const [showLabels, setShowLabels] = useState(false)

  useEffect(() => {
    const update = () => setBgColor(document.documentElement.classList.contains('light') ? '#ececef' : '#111113')
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (viewMode === 'categories') {
      setNodes(initialNodes)
      setEdges(initialEdges)
    }
  }, [initialNodes, initialEdges, setNodes, setEdges, viewMode])

  const resetToCategories = useCallback(() => {
    setViewMode('categories')
    setFocusedSlug(null)
    setNodes(initialNodes)
    setEdges(initialEdges)
    refit()
  }, [initialNodes, initialEdges, setNodes, setEdges, refit])

  const [focusedTopic, setFocusedTopic] = useState<{ slug: string; index: number; categoryNode: Node } | null>(null)

  function styleTweetEdges(edgesIn: Edge[], color: string): Edge[] {
    return edgesIn.map((e) => ({
      ...e,
      type: 'straight',
      style: { stroke: color, strokeWidth: 0.8, opacity: 0.25 },
      markerEnd: undefined,
    }))
  }

  /** Lay topic nodes on a ring around the category node, arcs proportional to size. */
  function layoutTopicNodes(topicNodes: Node[], center: Node): Node[] {
    const diameters = topicNodes.map(nodeDiameter)
    const positions = ringLayout(diameters, { center: centerOf(center), gap: 36, minRadius: nodeDiameter(center) / 2 + 170 })
    return topicNodes.map((n, i) => ({ ...n, position: positions[i] }))
  }

  const openCategory = useCallback(async (node: Node) => {
    const { slug, color } = node.data as { slug: string; color: string }
    setFocusedSlug(slug)
    setFocusedTopic(null)
    setViewMode('focused')

    if (tweetCache[slug]) {
      const { nodes: cn, edges: ce } = tweetCache[slug]
      const isTopics = cn.some((n) => n.type === 'topic')
      const positioned = isTopics ? layoutTopicNodes(cn, node) : layoutTweetNodes(cn, node)
      setNodes([node, ...positioned])
      setEdges(ce)
      refit()
      return
    }

    try {
      const res = await fetch(`/api/mindmap?category=${slug}`)
      const { nodes: newNodes, edges: newEdges, mode } = (await res.json()) as { nodes: Node[]; edges: Edge[]; mode?: string }
      if (mode === 'topics') {
        const topicNodes = newNodes.filter((n) => n.type === 'topic')
        const positioned = layoutTopicNodes(topicNodes, node)
        setTweetCache((prev) => ({ ...prev, [slug]: { nodes: topicNodes, edges: newEdges } }))
        setNodes([node, ...positioned])
        setEdges(newEdges)
      refit()
      } else {
        const tweetNodes = newNodes.filter((n) => n.type === 'tweet')
        const positioned = layoutTweetNodes(tweetNodes, node)
        const styledEdges = styleTweetEdges(newEdges, color)
        setTweetCache((prev) => ({ ...prev, [slug]: { nodes: tweetNodes, edges: styledEdges } }))
        setNodes([node, ...positioned])
        setEdges(styledEdges)
      refit()
      }
    } catch (err) {
      console.error('Failed to load category:', err)
    }
  }, [tweetCache, setNodes, setEdges])

  const openTopic = useCallback(async (topicNode: Node, categoryNode: Node) => {
    const { slug, index, color } = topicNode.data as { slug: string; index: number; color: string }
    const key = `${slug}#${index}`
    setFocusedTopic({ slug, index, categoryNode })
    setViewMode('topic')
    const c = centerOf(categoryNode)
    const td = nodeDiameter(topicNode)
    const centered: Node = { ...topicNode, position: { x: c.x - td / 2, y: c.y - td / 2 } }

    if (tweetCache[key]) {
      const { nodes: cn, edges: ce } = tweetCache[key]
      setNodes([centered, ...layoutTweetNodes(cn, centered)])
      setEdges(ce)
      refit()
      return
    }
    try {
      const res = await fetch(`/api/mindmap?category=${slug}&topic=${index}`)
      const { nodes: newNodes, edges: newEdges } = (await res.json()) as { nodes: Node[]; edges: Edge[] }
      const tweetNodes = newNodes.filter((n) => n.type === 'tweet')
      const styledEdges = styleTweetEdges(newEdges, color)
      setTweetCache((prev) => ({ ...prev, [key]: { nodes: tweetNodes, edges: styledEdges } }))
      setNodes([centered, ...layoutTweetNodes(tweetNodes, centered)])
      setEdges(styledEdges)
      refit()
    } catch (err) {
      console.error('Failed to load topic:', err)
    }
  }, [tweetCache, setNodes, setEdges])

  const [promoting, setPromoting] = useState(false)
  const promoteTopic = useCallback(async () => {
    if (!focusedTopic || promoting) return
    const topicNode = nodes.find((n) => n.type === 'topic')
    const currentName = (topicNode?.data as { name?: string } | undefined)?.name ?? 'New category'
    const name = window.prompt('Create a category from this topic. Name:', currentName)
    if (!name) return
    setPromoting(true)
    try {
      const res = await fetch('/api/categories/from-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: focusedTopic.slug, topicIndex: focusedTopic.index, name }),
      })
      const d = (await res.json()) as { error?: string; moved?: number; category?: { name: string } }
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      setTweetCache({})
      resetToCategories()
      onGraphChanged?.()
      window.alert(`Created "${d.category?.name}" and moved ${d.moved} posts into it.`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create the category')
    } finally {
      setPromoting(false)
    }
  }, [focusedTopic, promoting, nodes, resetToCategories, onGraphChanged])

  const backToTopics = useCallback(() => {
    if (!focusedTopic) return resetToCategories()
    void openCategory(focusedTopic.categoryNode)
  }, [focusedTopic, openCategory, resetToCategories])

  const handleNodeClick: NodeMouseHandler = useCallback(async (_, node) => {
    if (node.type === 'root') { resetToCategories(); return }
    if (node.type === 'topic') {
      const categoryNode = nodes.find((n) => n.type === 'category') ?? focusedTopic?.categoryNode
      if (categoryNode) await openTopic(node, categoryNode)
      return
    }
    if (node.type !== 'category') return
    const { slug } = node.data as { slug: string }
    if (viewMode === 'focused' && focusedSlug === slug) { resetToCategories(); return }
    await openCategory(node)
  }, [nodes, viewMode, focusedSlug, focusedTopic, openCategory, openTopic, resetToCategories])

  return (
    <MindmapContext.Provider value={{ showLabels }}>
    <div className="relative w-full h-full">
      {/* Top-left controls */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        {viewMode !== 'categories' && (
          <button
            onClick={resetToCategories}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 hover:text-zinc-100 transition-colors backdrop-blur-sm"
          >
            ← All categories
          </button>
        )}
        {viewMode === 'topic' && (
          <button
            onClick={backToTopics}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 hover:text-zinc-100 transition-colors backdrop-blur-sm"
          >
            ← Topics
          </button>
        )}
        {viewMode === 'topic' && (
          <button
            onClick={() => void promoteTopic()}
            disabled={promoting}
            title="Turn this topic into its own category and move these posts into it"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/90 border border-indigo-500 text-white text-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors backdrop-blur-sm"
          >
            {promoting ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />}
            Make this a category
          </button>
        )}
        {viewMode !== 'categories' && (
          <button
            onClick={() => setShowLabels((v) => !v)}
            title={showLabels ? 'Hide labels' : 'Show labels'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors backdrop-blur-sm ${
              showLabels
                ? 'bg-indigo-600/80 border-indigo-500 text-white'
                : 'bg-zinc-900/90 border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            <Type size={13} />
            Labels
          </button>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onInit={(inst) => { rf.current = inst }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: 'chain',
          style: { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.8 },
          markerEnd: undefined,
        }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2.5}
      >
        <Background color={bgColor} gap={24} size={1} />
        <Controls
          className="bg-zinc-900/90 border border-zinc-700 rounded-xl overflow-hidden backdrop-blur-sm"
          showInteractive={false}
        />
      </ReactFlow>

      {/* Hint */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-500 pointer-events-none whitespace-nowrap">
        {viewMode === 'categories' ? 'Click a category to explore its bookmarks' : 'Drag any bubble · Click ← to go back'}
      </div>
    </div>
    </MindmapContext.Provider>
  )
}
