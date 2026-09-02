/**
 * Hybrid search: plain-English query → structured filters + keyword (FTS5)
 * + semantic (local embeddings) retrieval, fused with Reciprocal Rank
 * Fusion. Runs in tens of milliseconds and needs no API calls, so it can
 * power search-as-you-type. The optional "Ask AI" rerank builds on top of
 * these candidates (see app/api/search/ai/route.ts).
 */
import prisma from '@/lib/db'
import { ftsSearch } from '@/lib/fts'
import { vectorSearch } from '@/lib/embeddings'
import { rrfFuse } from '@/lib/rank'
import { parseQuery, type ParsedQuery, type CategoryRef } from '@/lib/query-parser'
import { BOOKMARK_LIST_SELECT, serializeBookmark } from '@/lib/serialize-bookmark'
import type { SearchHit, ParsedQueryInfo, MatchSource } from '@/lib/types'

export interface HybridOptions {
  limit?: number
  /** Restrict to a category slug (e.g. when searching inside a collection page) */
  category?: string
  /** Prefix-match the last word so results update while typing */
  asYouType?: boolean
  /** How many fused candidates to hydrate before filtering (Ask AI wants more) */
  candidates?: number
}

export interface HybridResult {
  bookmarks: SearchHit[]
  total: number
  parsed: ParsedQuery
  usedSemantic: boolean
  tookMs: number
}

// ── Category cache (names are needed to understand "in dev tools") ────────────
let categoryCache: { at: number; list: CategoryRef[] } | null = null
export async function getCategoryRefs(): Promise<CategoryRef[]> {
  if (categoryCache && Date.now() - categoryCache.at < 60_000) return categoryCache.list
  const list = await prisma.category.findMany({ select: { name: true, slug: true } })
  categoryCache = { at: Date.now(), list }
  return list
}
export function invalidateCategoryRefs(): void {
  categoryCache = null
}

type BookmarkWhere = NonNullable<Parameters<typeof prisma.bookmark.findMany>[0]>['where']

export function buildWhere(parsed: ParsedQuery, categoryOverride?: string): BookmarkWhere {
  const where: Record<string, unknown> = {}
  if (parsed.author) where.authorHandle = { equals: parsed.author }
  if (parsed.since || parsed.until) {
    where.tweetCreatedAt = {
      ...(parsed.since ? { gte: parsed.since } : {}),
      ...(parsed.until ? { lt: parsed.until } : {}),
    }
  }
  if (parsed.mediaType) where.mediaItems = { some: { type: parsed.mediaType === 'video' ? { in: ['video', 'gif'] } : 'photo' } }
  const category = categoryOverride ?? parsed.category
  if (category) where.categories = { some: { category: { slug: category } } }
  return where as BookmarkWhere
}

export function toParsedInfo(p: ParsedQuery): ParsedQueryInfo {
  return {
    terms: p.terms,
    author: p.author,
    since: p.since?.toISOString() ?? null,
    until: p.until?.toISOString() ?? null,
    mediaType: p.mediaType,
    category: p.category,
    sort: p.sort,
    filters: p.filters,
  }
}

function orderFor(sort: ParsedQuery['sort']) {
  if (sort === 'popular') return [{ likeCount: 'desc' as const }, { tweetCreatedAt: 'desc' as const }]
  if (sort === 'oldest') return [{ tweetCreatedAt: 'asc' as const }, { importedAt: 'asc' as const }]
  return [{ tweetCreatedAt: 'desc' as const }, { importedAt: 'desc' as const }]
}

export async function hybridSearch(query: string, options: HybridOptions = {}): Promise<HybridResult> {
  const started = Date.now()
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 200)
  const candidateCap = options.candidates ?? 400
  const categories = await getCategoryRefs()
  const parsed = parseQuery(query, categories)
  const where = buildWhere(parsed, options.category)

  // Filters only (e.g. "videos from @karpathy last month") — no ranking needed
  if (parsed.keywords.length === 0) {
    const [rows, total] = await Promise.all([
      prisma.bookmark.findMany({ where, orderBy: orderFor(parsed.sort), take: limit, select: BOOKMARK_LIST_SELECT }),
      prisma.bookmark.count({ where }),
    ])
    return {
      bookmarks: rows.map((r) => ({ ...serializeBookmark(r), score: 0, matchedBy: ['filter' as MatchSource] })),
      total,
      parsed,
      usedSemantic: false,
      tookMs: Date.now() - started,
    }
  }

  // Three ranked lists: posts matching ALL keywords (precision), posts matching
  // ANY keyword (recall, lower weight), and semantic neighbours.
  const [ftsAllIds, ftsAnyIds, vectorHits] = await Promise.all([
    parsed.keywords.length > 1
      ? ftsSearch(parsed.keywords, { limit: 300, prefixLast: options.asYouType, mode: 'all' })
      : Promise.resolve<string[]>([]),
    ftsSearch(parsed.keywords, { limit: 300, prefixLast: options.asYouType, mode: 'any' }),
    vectorSearch(parsed.terms, 300),
  ])
  const usedSemantic = vectorHits.length > 0

  let fused = rrfFuse([
    { ids: ftsAllIds, label: 'keyword', weight: 1 },
    { ids: ftsAnyIds, label: 'keyword', weight: 0.7 },
    { ids: vectorHits.map((h) => h.id), label: 'semantic', weight: 1 },
  ])

  // Last resort when neither index has anything: substring scan of tweet text
  if (fused.length === 0) {
    const rows = await prisma.bookmark.findMany({
      where: { ...where, OR: parsed.keywords.map((kw) => ({ text: { contains: kw } })) },
      orderBy: orderFor(parsed.sort),
      take: candidateCap,
      select: { id: true },
    })
    fused = rows.map((r, i) => ({ id: r.id, score: 1 / (60 + i + 1), matchedBy: ['keyword'] }))
  }

  const candidateIds = fused.slice(0, candidateCap).map((f) => f.id)
  const rows = await prisma.bookmark.findMany({
    where: { ...where, id: { in: candidateIds } },
    select: BOOKMARK_LIST_SELECT,
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const fusedById = new Map(fused.map((f) => [f.id, f]))

  let hits: SearchHit[] = candidateIds
    .filter((id) => byId.has(id))
    .map((id) => {
      const f = fusedById.get(id)!
      return { ...serializeBookmark(byId.get(id)!), score: f.score, matchedBy: f.matchedBy as MatchSource[] }
    })

  // An explicit sort intent wins over relevance
  if (parsed.sort === 'popular') hits.sort((a, b) => (b.likeCount ?? -1) - (a.likeCount ?? -1))
  else if (parsed.sort === 'oldest') hits.sort((a, b) => (a.tweetCreatedAt ?? '').localeCompare(b.tweetCreatedAt ?? ''))
  else if (parsed.sort === 'newest') hits.sort((a, b) => (b.tweetCreatedAt ?? '').localeCompare(a.tweetCreatedAt ?? ''))

  const total = hits.length
  hits = hits.slice(0, limit)
  return { bookmarks: hits, total, parsed, usedSemantic, tookMs: Date.now() - started }
}
