/**
 * Shared write path for every import method (JSON upload, bookmarklet,
 * cookie sync, OAuth). Deduplicates in bulk, writes in transactions, extracts
 * entities immediately, and indexes new rows for keyword + semantic search
 * so they are findable the moment the import finishes.
 */
import prisma from '@/lib/db'
import type { ParsedBookmark } from '@/lib/parser'
import { extractEntities } from '@/lib/rawjson-extractor'
import { upsertFtsRows } from '@/lib/fts'
import { scheduleEmbedding } from '@/lib/embeddings'

export type ImportSource = 'bookmark' | 'like'

export interface ImportSummary {
  imported: number
  skipped: number
  newIds: string[]
}

const LOOKUP_CHUNK = 500
const WRITE_CHUNK = 50

function buildCreateData(b: ParsedBookmark, source: ImportSource) {
  return {
    tweetId: b.tweetId,
    text: b.text,
    authorHandle: b.authorHandle || 'unknown',
    authorName: b.authorName || 'Unknown',
    tweetCreatedAt: b.tweetCreatedAt,
    rawJson: b.rawJson,
    source,
    quotedText: b.quotedText,
    likeCount: b.likeCount,
    retweetCount: b.retweetCount,
    replyCount: b.replyCount,
    viewCount: b.viewCount,
    lang: b.lang,
    entities: JSON.stringify(extractEntities(b.rawJson)),
    mediaItems: b.media.length
      ? { create: b.media.map((m) => ({ type: m.type, url: m.url, thumbnailUrl: m.thumbnailUrl ?? null })) }
      : undefined,
  }
}

export async function importParsedBookmarks(
  items: ParsedBookmark[],
  source: ImportSource,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  // Dedupe within the batch (exports often contain the same tweet twice)
  const byId = new Map<string, ParsedBookmark>()
  for (const b of items) if (b.tweetId && !byId.has(b.tweetId)) byId.set(b.tweetId, b)
  const unique = Array.from(byId.values())

  // Bulk lookup of tweets we already have
  const existing = new Set<string>()
  const tweetIds = unique.map((b) => b.tweetId)
  for (let i = 0; i < tweetIds.length; i += LOOKUP_CHUNK) {
    const rows = await prisma.bookmark.findMany({
      where: { tweetId: { in: tweetIds.slice(i, i + LOOKUP_CHUNK) } },
      select: { tweetId: true },
    })
    for (const r of rows) existing.add(r.tweetId)
  }

  const toCreate = unique.filter((b) => !existing.has(b.tweetId))
  let skipped = items.length - toCreate.length
  const newIds: string[] = []

  for (let i = 0; i < toCreate.length; i += WRITE_CHUNK) {
    const chunk = toCreate.slice(i, i + WRITE_CHUNK)
    try {
      const created = await prisma.$transaction(
        chunk.map((b) => prisma.bookmark.create({ data: buildCreateData(b, source), select: { id: true } })),
      )
      for (const c of created) newIds.push(c.id)
    } catch (err) {
      // A concurrent import may have raced us — fall back to one at a time
      console.warn('[import] chunk failed, retrying rows individually:', err instanceof Error ? err.message : err)
      for (const b of chunk) {
        try {
          const c = await prisma.bookmark.create({ data: buildCreateData(b, source), select: { id: true } })
          newIds.push(c.id)
        } catch (rowErr) {
          skipped++
          console.error(`[import] failed to import tweet ${b.tweetId}:`, rowErr instanceof Error ? rowErr.message : rowErr)
        }
      }
    }
    onProgress?.(Math.min(i + WRITE_CHUNK, toCreate.length), toCreate.length)
  }

  if (newIds.length > 0) {
    await upsertFtsRows(newIds).catch((err) => console.warn('[import] FTS index failed:', err))
    scheduleEmbedding(newIds)
  }

  return { imported: newIds.length, skipped, newIds }
}
