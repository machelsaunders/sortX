import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getCategoryTopics } from '@/lib/topics'

interface MindMapNode {
  id: string
  type: string
  data: Record<string, unknown>
  position: { x: number; y: number }
}

interface MindMapEdge {
  id: string
  source: string
  target: string
  type?: string
  style?: Record<string, unknown>
}

interface MindMapResponse {
  nodes: MindMapNode[]
  edges: MindMapEdge[]
}

const ROOT_POSITION = { x: 0, y: 0 }
const TWEET_RADIUS = 200

// Keep category nodes equidistant: radius scales with count so the gap between
// node edges stays constant (~36px) regardless of how many categories exist.
const CAT_NODE_DIAMETER = 112
const CAT_NODE_GAP = 36
const CAT_MIN_RADIUS = 200

function categoryRadius(count: number): number {
  const circumference = count * (CAT_NODE_DIAMETER + CAT_NODE_GAP)
  return Math.max(CAT_MIN_RADIUS, Math.round(circumference / (2 * Math.PI)))
}

function categoryPosition(index: number, total: number, radius: number): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2
  return {
    x: Math.round(ROOT_POSITION.x + radius * Math.cos(angle)),
    y: Math.round(ROOT_POSITION.y + radius * Math.sin(angle)),
  }
}

function tweetPosition(
  categoryPosition: { x: number; y: number },
  index: number,
  total: number
): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / Math.max(total, 1) - Math.PI / 2
  return {
    x: Math.round(categoryPosition.x + TWEET_RADIUS * Math.cos(angle)),
    y: Math.round(categoryPosition.y + TWEET_RADIUS * Math.sin(angle)),
  }
}

async function getBaseGraph(): Promise<MindMapResponse> {
  const [totalBookmarks, categories] = await Promise.all([
    prisma.bookmark.count(),
    prisma.category.findMany({
      include: {
        _count: { select: { bookmarks: true } },
      },
      orderBy: { bookmarks: { _count: 'desc' } },
    }),
  ])

  const rootNode: MindMapNode = {
    id: 'root',
    type: 'root',
    data: { label: 'My Bookmarks', count: totalBookmarks },
    position: ROOT_POSITION,
  }

  const radius = categoryRadius(categories.length)
  const categoryNodes: MindMapNode[] = categories.map((cat, index) => ({
    id: `cat-${cat.slug}`,
    type: 'category',
    data: {
      name: cat.name,
      slug: cat.slug,
      color: cat.color,
      count: cat._count.bookmarks,
      description: cat.description,
    },
    position: categoryPosition(index, categories.length, radius),
  }))

  const categoryEdges: MindMapEdge[] = categories.map((cat) => ({
    id: `edge-root-cat-${cat.slug}`,
    source: 'root',
    target: `cat-${cat.slug}`,
    type: 'chain',
    style: { stroke: cat.color, strokeWidth: 1.5, opacity: 1 },
  }))

  return {
    nodes: [rootNode, ...categoryNodes],
    edges: categoryEdges,
  }
}

async function getCategoryTweetNodes(
  categorySlug: string,
  options: { onlyIds?: string[]; parentId?: string } = {},
): Promise<MindMapResponse> {
  const category = await prisma.category.findUnique({
    where: { slug: categorySlug },
    include: {
      _count: { select: { bookmarks: true } },
    },
  })

  if (!category) {
    return { nodes: [], edges: [] }
  }

  const bookmarkCategories = await prisma.bookmarkCategory.findMany({
    where: {
      category: { slug: categorySlug },
      ...(options.onlyIds ? { bookmarkId: { in: options.onlyIds } } : {}),
    },
    select: {
      confidence: true,
      bookmark: {
        select: {
          id: true,
          tweetId: true,
          text: true,
          authorHandle: true,
          authorName: true,
          tweetCreatedAt: true,
          semanticTags: true,
          mediaItems: {
            select: { url: true, thumbnailUrl: true, type: true, imageTags: true },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ confidence: 'desc' }],
    take: 66, // Max nodes across 4 rings (8+14+20+24)
  })

  const bookmarks = bookmarkCategories.map((bc) => ({ ...bc.bookmark, confidence: bc.confidence }))

  const catNodeId = options.parentId ?? `cat-${categorySlug}`
  const catPos = { x: 0, y: 0 } // Position relative to the parent node

  const tweetNodes: MindMapNode[] = bookmarks.map((bookmark, index) => {
    const truncatedText =
      bookmark.text.length > 80
        ? bookmark.text.slice(0, 77) + '...'
        : bookmark.text

    const firstMedia = bookmark.mediaItems[0] ?? null
    const thumbnailUrl = firstMedia?.thumbnailUrl ?? (firstMedia?.type === 'photo' ? firstMedia.url : null) ?? null

    // Extract a brief visual summary from structured imageTags for tooltip
    let visualSummary: string | null = null
    if (firstMedia?.imageTags) {
      try {
        const parsed = JSON.parse(firstMedia.imageTags) as Record<string, unknown>
        visualSummary = [parsed.scene, parsed.action].filter(Boolean).join(' — ') || null
      } catch {
        visualSummary = null
      }
    }

    return {
      id: `tweet-${bookmark.tweetId}`,
      type: 'tweet',
      data: {
        tweetId: bookmark.tweetId,
        text: truncatedText,
        authorHandle: bookmark.authorHandle,
        authorName: bookmark.authorName,
        tweetUrl: `https://twitter.com/${bookmark.authorHandle}/status/${bookmark.tweetId}`,
        thumbnailUrl,
        hasMedia: firstMedia !== null,
        mediaType: firstMedia?.type ?? null,
        tweetCreatedAt: bookmark.tweetCreatedAt?.toISOString() ?? null,
        categoryColor: category.color,
        confidence: bookmark.confidence,
        visualSummary,
      },
      position: tweetPosition(catPos, index, bookmarks.length),
    }
  })

  const tweetEdges: MindMapEdge[] = bookmarks.map((bookmark) => ({
    id: `edge-${catNodeId}-tweet-${bookmark.tweetId}`,
    source: catNodeId,
    target: `tweet-${bookmark.tweetId}`,
  }))

  return {
    nodes: tweetNodes,
    edges: tweetEdges,
  }
}

const TOPIC_NODE_WIDTH = 150
const TOPIC_NODE_GAP = 44

async function getCategoryTopicNodes(categorySlug: string, force: boolean): Promise<MindMapResponse | null> {
  const category = await prisma.category.findUnique({ where: { slug: categorySlug }, select: { color: true, name: true } })
  if (!category) return null
  const result = await getCategoryTopics(categorySlug, force)
  if (!result || result.topics.length < 2) return null

  const total = result.topics.length
  const radius = Math.max(220, Math.round((total * (TOPIC_NODE_WIDTH + TOPIC_NODE_GAP)) / (2 * Math.PI)))
  const nodes: MindMapNode[] = result.topics.map((t, index) => ({
    id: `topic-${categorySlug}-${t.index}`,
    type: 'topic',
    data: { name: t.name, size: t.size, index: t.index, slug: categorySlug, color: category.color },
    position: categoryPosition(index, total, radius),
  }))
  const edges: MindMapEdge[] = result.topics.map((t) => ({
    id: `edge-cat-${categorySlug}-topic-${t.index}`,
    source: `cat-${categorySlug}`,
    target: `topic-${categorySlug}-${t.index}`,
    type: 'chain',
    style: { stroke: category.color, strokeWidth: 1.2, opacity: 0.8 },
  }))
  return { nodes, edges }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)
  const categorySlug = searchParams.get('category')
  const topicParam = searchParams.get('topic')
  const force = searchParams.get('refresh') === '1'

  try {
    if (categorySlug && topicParam !== null) {
      // Posts inside one topic cluster
      const topics = await getCategoryTopics(categorySlug)
      const topic = topics?.topics.find((t) => t.index === parseInt(topicParam, 10))
      if (!topic) return NextResponse.json({ nodes: [], edges: [] })
      const data = await getCategoryTweetNodes(categorySlug, { onlyIds: topic.ids, parentId: `topic-${categorySlug}-${topic.index}` })
      return NextResponse.json(data)
    }

    if (categorySlug) {
      // Big categories get topic clusters; small ones show posts directly
      const topicGraph = await getCategoryTopicNodes(categorySlug, force)
      if (topicGraph) return NextResponse.json({ ...topicGraph, mode: 'topics' })
      const data = await getCategoryTweetNodes(categorySlug)
      return NextResponse.json({ ...data, mode: 'tweets' })
    }

    const data = await getBaseGraph()
    return NextResponse.json(data)
  } catch (err) {
    console.error('Mindmap fetch error:', err)
    return NextResponse.json(
      { error: `Failed to build mindmap: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
