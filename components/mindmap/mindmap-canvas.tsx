'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Type } from 'lucide-react'
import RootNode from './root-node'
import CategoryNode from './category-node'
import TweetNode from './tweet-node'
import TopicNode from './topic-node'
import ChainEdge from './chain-edge'
import { MindmapContext } from './mindmap-context'

const nodeTypes = { root: RootNode, category: CategoryNode, tweet: TweetNode, topic: TopicNode }
const edgeTypes = { chain: ChainEdge }

// Golden angle — Fibonacci/sunflower spiral for organic, non-overlapping spread
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)) // ≈ 137.508°

function layoutTweetNodes(nodes: Node[], center: Node): Node[] {
  const count = nodes.length
  return nodes.map((n, i) => {
    const angle = i * GOLDEN_ANGLE
    // Scale radius with count so nodes never overlap, even at 100+ bookmarks
    const t = count > 1 ? (i + 0.5) / count : 0.5
    const maxRadius = Math.max(400, 80 * Math.sqrt(count))
    const radius = 110 + maxRadius * Math.sqrt(t)
    return {
      ...n,
      position: {
        x: center.position.x + Math.round(radius * Math.cos(angle)),
        y: center.position.y + Math.round(radius * Math.sin(angle)),
      },
    }
  })
}

// ── Canvas ────────────────────────────────────────────────────────────────────

interface MindmapCanvasProps {
  initialNodes: Node[]
  initialEdges: Edge[]
}

type ViewMode = 'categories' | 'focused' | 'topic'

export default function MindmapCanvas({ initialNodes, initialEdges }: MindmapCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
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
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const [focusedTopic, setFocusedTopic] = useState<{ slug: string; index: number; categoryNode: Node } | null>(null)

  function styleTweetEdges(edgesIn: Edge[], color: string): Edge[] {
    return edgesIn.map((e) => ({
      ...e,
      type: 'straight',
      style: { stroke: color, strokeWidth: 0.8, opacity: 0.25 },
      markerEnd: undefined,
    }))
  }

  /** Lay topic nodes on a ring around the category node. */
  function layoutTopicNodes(topicNodes: Node[], center: Node): Node[] {
    const total = topicNodes.length
    const radius = Math.max(230, Math.round((total * 195) / (2 * Math.PI)))
    return topicNodes.map((n, i) => {
      const angle = (2 * Math.PI * i) / total - Math.PI / 2
      return { ...n, position: { x: center.position.x + Math.round(radius * Math.cos(angle)), y: center.position.y + Math.round(radius * Math.sin(angle)) } }
    })
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
      } else {
        const tweetNodes = newNodes.filter((n) => n.type === 'tweet')
        const positioned = layoutTweetNodes(tweetNodes, node)
        const styledEdges = styleTweetEdges(newEdges, color)
        setTweetCache((prev) => ({ ...prev, [slug]: { nodes: tweetNodes, edges: styledEdges } }))
        setNodes([node, ...positioned])
        setEdges(styledEdges)
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
    const centered: Node = { ...topicNode, position: categoryNode.position }

    if (tweetCache[key]) {
      const { nodes: cn, edges: ce } = tweetCache[key]
      setNodes([centered, ...layoutTweetNodes(cn, centered)])
      setEdges(ce)
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
    } catch (err) {
      console.error('Failed to load topic:', err)
    }
  }, [tweetCache, setNodes, setEdges])

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
