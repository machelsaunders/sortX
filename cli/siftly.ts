#!/usr/bin/env npx tsx
import prisma from '@/lib/db'
import { hybridSearch } from '@/lib/hybrid-search'
import { runIndex, getEmbeddingStatus } from '@/lib/embeddings'

// ─── Output ──────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY
function output(data: unknown): void {
  const json = isTTY ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  process.stdout.write(json + '\n')
}

function die(message: string): never {
  output({ error: message })
  process.exit(1)
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = 'true'
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdSearch(args: string[]) {
  const { positional, flags } = parseArgs(args)
  const query = positional.join(' ')
  if (!query) die('Usage: siftly search <plain-English query> [--limit N] [--category slug]')

  const limit = Math.min(parseInt(flags.limit ?? '20', 10) || 20, 100)
  const result = await hybridSearch(query, { limit, category: flags.category })

  output({
    query,
    understood: {
      terms: result.parsed.terms,
      filters: result.parsed.filters,
      author: result.parsed.author,
      since: result.parsed.since?.toISOString() ?? null,
      until: result.parsed.until?.toISOString() ?? null,
      mediaType: result.parsed.mediaType,
      category: result.parsed.category,
      sort: result.parsed.sort,
    },
    usedSemantic: result.usedSemantic,
    tookMs: result.tookMs,
    count: result.bookmarks.length,
    total: result.total,
    bookmarks: result.bookmarks.map((b) => ({
      id: b.id,
      tweetId: b.tweetId,
      url: `https://x.com/${b.authorHandle}/status/${b.tweetId}`,
      author: `@${b.authorHandle}`,
      date: b.tweetCreatedAt,
      likes: b.likeCount,
      score: Number(b.score.toFixed(4)),
      matchedBy: b.matchedBy,
      categories: b.categories.map((c) => c.slug),
      text: b.text.length > 280 ? b.text.slice(0, 280) + '…' : b.text,
    })),
  })
}

async function cmdIndex(args: string[]) {
  const { flags } = parseArgs(args)
  if (flags.status === 'true') {
    output(await getEmbeddingStatus())
    return
  }
  const written = await runIndex(null, flags.force === 'true')
  output({ indexed: written, ...(await getEmbeddingStatus()) })
}

async function cmdList(args: string[]) {
  const { flags } = parseArgs(args)

  const limit = Math.min(parseInt(flags.limit ?? '20', 10) || 20, 100)
  const page = parseInt(flags.page ?? '1', 10) || 1
  const skip = (page - 1) * limit
  const sortDir = flags.sort === 'oldest' ? 'asc' as const : 'desc' as const

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {}

  if (flags.source === 'bookmark' || flags.source === 'like') {
    where.source = flags.source
  }
  if (flags.category) {
    where.categories = { some: { category: { slug: flags.category } } }
  }
  if (flags.author) {
    where.authorHandle = flags.author
  }
  if (flags.media === 'photo' || flags.media === 'video') {
    where.mediaItems = { some: { type: flags.media } }
  }

  const [bookmarks, total] = await Promise.all([
    prisma.bookmark.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ tweetCreatedAt: sortDir }, { importedAt: sortDir }],
      include: {
        mediaItems: { select: { id: true, type: true, url: true } },
        categories: {
          include: { category: { select: { name: true, slug: true } } },
          orderBy: { confidence: 'desc' },
        },
      },
    }),
    prisma.bookmark.count({ where }),
  ])

  output({
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    bookmarks: bookmarks.map(formatBookmark),
  })
}

async function cmdShow(args: string[]) {
  const id = args[0]
  if (!id) die('Usage: siftly show <id|tweetId>')

  const bookmark = await prisma.bookmark.findFirst({
    where: { OR: [{ id }, { tweetId: id }] },
    include: {
      mediaItems: true,
      categories: {
        include: { category: { select: { id: true, name: true, slug: true, color: true } } },
        orderBy: { confidence: 'desc' },
      },
    },
  })

  if (!bookmark) die(`Bookmark not found: ${id}`)

  output({
    id: bookmark.id,
    tweetId: bookmark.tweetId,
    text: bookmark.text,
    authorHandle: bookmark.authorHandle,
    authorName: bookmark.authorName,
    source: bookmark.source,
    tweetCreatedAt: bookmark.tweetCreatedAt?.toISOString() ?? null,
    importedAt: bookmark.importedAt.toISOString(),
    enrichedAt: bookmark.enrichedAt?.toISOString() ?? null,
    semanticTags: safeParse(bookmark.semanticTags),
    entities: safeParse(bookmark.entities),
    enrichmentMeta: safeParse(bookmark.enrichmentMeta),
    mediaItems: bookmark.mediaItems.map((m) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      imageTags: safeParse(m.imageTags),
    })),
    categories: bookmark.categories.map((bc) => ({
      id: bc.category.id,
      name: bc.category.name,
      slug: bc.category.slug,
      color: bc.category.color,
      confidence: bc.confidence,
    })),
  })
}

async function cmdCategories() {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { bookmarks: true } } },
    orderBy: { name: 'asc' },
  })

  output({
    count: categories.length,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      color: c.color,
      bookmarkCount: c._count.bookmarks,
    })),
  })
}

async function cmdStats() {
  const [totalBookmarks, totalCategories, totalMedia, sourceGroups, enrichedCount] =
    await Promise.all([
      prisma.bookmark.count(),
      prisma.category.count(),
      prisma.mediaItem.count(),
      prisma.bookmark.groupBy({ by: ['source'], _count: true }),
      prisma.bookmark.count({ where: { enrichedAt: { not: null } } }),
    ])

  const sources: Record<string, number> = {}
  for (const g of sourceGroups) {
    sources[g.source] = g._count
  }

  output({
    totalBookmarks,
    enrichedBookmarks: enrichedCount,
    unenrichedBookmarks: totalBookmarks - enrichedCount,
    totalCategories,
    totalMediaItems: totalMedia,
    sources,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParse(json: string | null): unknown {
  if (!json) return null
  try { return JSON.parse(json) } catch { return json }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatBookmark(b: any) {
  return {
    id: b.id,
    tweetId: b.tweetId,
    text: b.text,
    authorHandle: b.authorHandle,
    authorName: b.authorName,
    source: b.source,
    tweetCreatedAt: b.tweetCreatedAt?.toISOString() ?? null,
    mediaItems: b.mediaItems.map((m: { id: string; type: string; url: string }) => ({
      id: m.id,
      type: m.type,
      url: m.url,
    })),
    categories: b.categories.map(
      (bc: { category: { name: string; slug: string }; confidence: number }) => ({
        name: bc.category.name,
        slug: bc.category.slug,
        confidence: bc.confidence,
      })
    ),
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, string> = {
  search: 'search <plain English>   Hybrid keyword + semantic search',
  list: 'list [--source] [--category] [--author] [--media] [--sort] [--limit] [--page]',
  index: 'index [--force] [--status] Build local semantic vectors',
  show: 'show <id|tweetId>         Full bookmark detail',
  categories: 'categories                List categories with counts',
  stats: 'stats                     Library statistics',
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  const rest = args.slice(1)

  if (!command || command === '--help' || command === '-h') {
    output({
      usage: 'siftly <command> [options]',
      commands: COMMANDS,
    })
    process.exit(0)
  }

  try {
    switch (command) {
      case 'index':
        await cmdIndex(rest)
        break
      case 'search':
        await cmdSearch(rest)
        break
      case 'list':
        await cmdList(rest)
        break
      case 'show':
        await cmdShow(rest)
        break
      case 'categories':
        await cmdCategories()
        break
      case 'stats':
        await cmdStats()
        break
      default:
        die(`Unknown command: ${command}. Run 'siftly --help' for usage.`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('no such table')) {
      die('Prisma client not generated or database not set up. Run: npx prisma generate && npx prisma db push')
    }
    throw err
  } finally {
    await prisma.$disconnect()
  }
}

main()
