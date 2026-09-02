/**
 * SQLite FTS5 keyword index over bookmarks.
 *
 * The table is a plain FTS5 table keyed by bookmark_id (UNINDEXED) with
 * cleaned-up text columns rather than raw JSON, so BM25 ranks real words.
 * Rows are upserted incrementally on import and rebuilt after the AI
 * pipeline enriches bookmarks. Managed at runtime because Prisma cannot
 * model virtual tables.
 */

import prisma from '@/lib/db'

export const FTS_TABLE = 'bookmark_fts_v2'
const LEGACY_TABLE = 'bookmark_fts'

// Column order matters: bm25() weights below are positional.
const COLUMNS = ['bookmark_id', 'text', 'quoted', 'author', 'semantic_tags', 'entities', 'image_tags'] as const
// bookmark_id is UNINDEXED (weight ignored). Tweet text is the strongest signal.
const BM25_WEIGHTS = [0, 10, 4, 6, 5, 3, 3]

let ensured = false

export async function ensureFtsTable(): Promise<void> {
  if (ensured) return
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
      bookmark_id UNINDEXED,
      text,
      quoted,
      author,
      semantic_tags,
      entities,
      image_tags,
      tokenize='porter unicode61 remove_diacritics 2'
    )
  `)
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`).catch(() => {})
  ensured = true
}

export interface FtsSourceRow {
  id: string
  text: string
  quotedText: string | null
  authorHandle: string
  authorName: string
  semanticTags: string | null
  entities: string | null
  mediaItems: { imageTags: string | null }[]
}

export const FTS_SOURCE_SELECT = {
  id: true,
  text: true,
  quotedText: true,
  authorHandle: true,
  authorName: true,
  semanticTags: true,
  entities: true,
  mediaItems: { select: { imageTags: true } },
} as const

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

/** Flatten the structured vision JSON into searchable words. */
export function imageTagsToText(raw: string | null): string {
  const p = parseJson<Record<string, unknown>>(raw)
  if (!p) return ''
  const parts: string[] = []
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim())
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x.trim()) parts.push(x.trim())
  }
  push(p.text_ocr)
  push(p.scene)
  push(p.action)
  push(p.style)
  push(p.meme_template)
  push(p.people)
  push(p.objects)
  push(p.tags)
  return parts.join(' ')
}

export function entitiesToText(raw: string | null): string {
  const e = parseJson<{ hashtags?: string[]; tools?: string[]; mentions?: string[]; urls?: string[] }>(raw)
  if (!e) return ''
  const parts: string[] = []
  for (const h of e.hashtags ?? []) parts.push(h)
  for (const t of e.tools ?? []) parts.push(t)
  for (const m of e.mentions ?? []) parts.push(m)
  for (const u of e.urls ?? []) {
    try { parts.push(new URL(u).hostname.replace(/^www\./, '')) } catch { /* ignore */ }
  }
  return parts.join(' ')
}

export function semanticTagsToText(raw: string | null): string {
  const tags = parseJson<string[]>(raw)
  return Array.isArray(tags) ? tags.map(String).join(', ') : ''
}

function buildRow(b: FtsSourceRow): string[] {
  return [
    b.id,
    b.text,
    b.quotedText ?? '',
    `${b.authorName} ${b.authorHandle}`,
    semanticTagsToText(b.semanticTags),
    entitiesToText(b.entities),
    b.mediaItems.map((m) => imageTagsToText(m.imageTags)).filter(Boolean).join(' '),
  ]
}

async function insertRows(rows: FtsSourceRow[]): Promise<void> {
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await prisma.$transaction(
      batch.map((b) => {
        const [id, text, quoted, author, tags, ents, img] = buildRow(b)
        return prisma.$executeRawUnsafe(
          `INSERT INTO ${FTS_TABLE}(${COLUMNS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id, text, quoted, author, tags, ents, img,
        )
      }),
    )
  }
}

/** Rebuild the whole index. Idempotent and fast for a personal library. */
export async function rebuildFts(): Promise<void> {
  await ensureFtsTable()
  await prisma.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE}`)
  const rows = await prisma.bookmark.findMany({ select: FTS_SOURCE_SELECT })
  if (rows.length === 0) return
  await insertRows(rows)
}

/** Re-index specific bookmarks (after import or enrichment). */
export async function upsertFtsRows(bookmarkIds: string[]): Promise<void> {
  if (bookmarkIds.length === 0) return
  await ensureFtsTable()
  await deleteFtsRows(bookmarkIds)
  const rows = await prisma.bookmark.findMany({
    where: { id: { in: bookmarkIds } },
    select: FTS_SOURCE_SELECT,
  })
  await insertRows(rows)
}

export async function deleteFtsRows(bookmarkIds: string[]): Promise<void> {
  if (bookmarkIds.length === 0) return
  await ensureFtsTable()
  const CHUNK = 500
  for (let i = 0; i < bookmarkIds.length; i += CHUNK) {
    const chunk = bookmarkIds.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    await prisma.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE} WHERE bookmark_id IN (${placeholders})`, ...chunk)
  }
}

export interface FtsSearchOptions {
  limit?: number
  /** Treat the last keyword as a prefix so results update while typing */
  prefixLast?: boolean
  /** 'any' = OR (recall), 'all' = AND (precision) */
  mode?: 'any' | 'all'
}

/** Build a safe FTS5 MATCH expression from quoted terms. */
export function buildMatchQuery(keywords: string[], prefixLast = false, mode: 'any' | 'all' = 'any'): string {
  const terms = keywords
    .map((kw) => kw.replace(/["*()]/g, ' ').trim())
    .filter((kw) => kw.length >= 2)
  if (terms.length === 0) return ''
  return terms
    .map((t, i) => (prefixLast && i === terms.length - 1 && t.length >= 3 ? `"${t}"*` : `"${t}"`))
    .join(mode === 'all' ? ' AND ' : ' OR ')
}

/**
 * Keyword search. Returns bookmark IDs best-first (BM25 with per-column
 * weights). Returns [] on any error so callers can fall back gracefully.
 */
export async function ftsSearch(keywords: string[], options: FtsSearchOptions = {}): Promise<string[]> {
  const { limit = 200, prefixLast = false, mode = 'any' } = options
  const matchQuery = buildMatchQuery(keywords, prefixLast, mode)
  if (!matchQuery) return []
  try {
    await ensureFtsTable()
    const results = await prisma.$queryRawUnsafe<{ bookmark_id: string }[]>(
      `SELECT bookmark_id FROM ${FTS_TABLE}
       WHERE ${FTS_TABLE} MATCH ?
       ORDER BY bm25(${FTS_TABLE}, ${BM25_WEIGHTS.join(', ')})
       LIMIT ?`,
      matchQuery,
      limit,
    )
    return results.map((r) => r.bookmark_id)
  } catch (err) {
    console.warn('[fts] search failed:', err instanceof Error ? err.message : err)
    return []
  }
}
