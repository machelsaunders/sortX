import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { BOOKMARK_LIST_SELECT, serializeBookmark } from '@/lib/serialize-bookmark'
import { rebuildFts } from '@/lib/fts'
import { invalidateVectorCache } from '@/lib/embeddings'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

function parseIntParam(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = parseInt(value, 10)
  return isNaN(parsed) || parsed < 1 ? defaultValue : parsed
}

/** Clear the whole library (bookmarks, media, categories, search indexes). */
export async function DELETE(): Promise<NextResponse> {
  try {
    await prisma.$transaction([
      prisma.bookmarkCategory.deleteMany({}),
      prisma.bookmarkEmbedding.deleteMany({}),
      prisma.mediaItem.deleteMany({}),
      prisma.bookmark.deleteMany({}),
      prisma.category.deleteMany({}),
    ])
    await rebuildFts().catch(() => {})
    invalidateVectorCache()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Clear bookmarks error:', err)
    return NextResponse.json(
      { error: `Failed to clear bookmarks: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url)

  const q = searchParams.get('q')?.trim() ?? ''
  const source = searchParams.get('source')?.trim() ?? ''
  const author = searchParams.get('author')?.trim().replace(/^@/, '') ?? ''
  const categorySlug = searchParams.get('category')?.trim() ?? ''
  const mediaType = searchParams.get('mediaType')?.trim() ?? ''
  const uncategorized = searchParams.get('uncategorized') === 'true'
  const sortParam = searchParams.get('sort')?.trim() ?? 'newest'
  const page = parseIntParam(searchParams.get('page'), DEFAULT_PAGE)
  const limit = Math.min(parseIntParam(searchParams.get('limit'), DEFAULT_LIMIT), MAX_LIMIT)
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}

  if (source === 'bookmark' || source === 'like') where.source = source
  if (author) where.authorHandle = author

  if (q) {
    where.OR = [
      { text: { contains: q } },
      { quotedText: { contains: q } },
      { authorHandle: { contains: q } },
      { authorName: { contains: q } },
    ]
  }

  if (uncategorized) {
    where.categories = { none: {} }
  } else if (categorySlug) {
    where.categories = { some: { category: { slug: categorySlug } } }
  }

  if (mediaType === 'photo') where.mediaItems = { some: { type: 'photo' } }
  else if (mediaType === 'video') where.mediaItems = { some: { type: { in: ['video', 'gif'] } } }

  const orderBy =
    sortParam === 'popular'
      ? [{ likeCount: 'desc' as const }, { tweetCreatedAt: 'desc' as const }]
      : sortParam === 'oldest'
        ? [{ tweetCreatedAt: 'asc' as const }, { importedAt: 'asc' as const }]
        : [{ tweetCreatedAt: 'desc' as const }, { importedAt: 'desc' as const }]

  try {
    const [bookmarks, total] = await Promise.all([
      prisma.bookmark.findMany({ where, skip, take: limit, orderBy, select: BOOKMARK_LIST_SELECT }),
      prisma.bookmark.count({ where }),
    ])

    return NextResponse.json({
      bookmarks: bookmarks.map(serializeBookmark),
      total,
      page,
      limit,
    })
  } catch (err) {
    console.error('Bookmarks fetch error:', err)
    return NextResponse.json(
      { error: `Failed to fetch bookmarks: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
