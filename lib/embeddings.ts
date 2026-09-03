/**
 * Local semantic search vectors.
 *
 * Bookmarks are embedded with a small sentence-embedding model that runs on
 * the CPU via transformers.js (ONNX). Nothing leaves the machine. Vectors are
 * stored in the BookmarkEmbedding table and searched with a brute-force
 * cosine scan, which is plenty fast for a personal library (tens of
 * thousands of 384-dim vectors scan in a few milliseconds).
 *
 * The first run downloads the model (~35MB) into .cache/models.
 */
import { createHash } from 'crypto'
import path from 'path'
import prisma from '@/lib/db'
import { dot, topN } from '@/lib/rank'
import { imageTagsToText, semanticTagsToText } from '@/lib/fts'

export const EMBEDDING_MODEL = process.env.EMBEDDINGS_MODEL ?? 'Xenova/bge-small-en-v1.5'
export const EMBEDDING_DIM = 384
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
const DISABLED = process.env.EMBEDDINGS_DISABLED === 'true'

type ModelStatus = 'disabled' | 'unloaded' | 'loading' | 'ready' | 'error'

interface IndexState {
  status: 'idle' | 'running'
  done: number
  total: number
  error: string | null
  modelStatus: ModelStatus
  modelError: string | null
  abort: boolean
  pending: Set<string>
  cacheVersion: number
}

// Survive Next.js dev hot reloads by hanging state off globalThis
const g = globalThis as unknown as { __sortxEmbed?: IndexState }
if (!g.__sortxEmbed) {
  g.__sortxEmbed = {
    status: 'idle', done: 0, total: 0, error: null,
    modelStatus: DISABLED ? 'disabled' : 'unloaded', modelError: null,
    abort: false, pending: new Set(), cacheVersion: 0,
  }
}
const state = g.__sortxEmbed

// ── Model ─────────────────────────────────────────────────────────────────────

type Extractor = (
  texts: string[],
  opts: { pooling: 'cls' | 'mean'; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array }>

let extractorPromise: Promise<Extractor> | null = null

async function getExtractor(): Promise<Extractor> {
  if (DISABLED) throw new Error('Embeddings are disabled (EMBEDDINGS_DISABLED=true)')
  if (extractorPromise) return extractorPromise
  state.modelStatus = 'loading'
  extractorPromise = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = process.env.EMBEDDINGS_CACHE_DIR ?? path.join(process.cwd(), '.cache', 'models')
      env.allowLocalModels = false
      const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
      state.modelStatus = 'ready'
      state.modelError = null
      return pipe as unknown as Extractor
    } catch (err) {
      state.modelStatus = 'error'
      state.modelError = err instanceof Error ? err.message : String(err)
      extractorPromise = null
      throw err
    }
  })()
  return extractorPromise
}

export function isEmbeddingEnabled(): boolean {
  return !DISABLED
}

/** Embed texts. Passages and queries use different prefixes for this model family. */
export async function embedTexts(texts: string[], kind: 'passage' | 'query' = 'passage'): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const extractor = await getExtractor()
  const inputs = kind === 'query' ? texts.map((t) => QUERY_PREFIX + t) : texts
  const out = await extractor(inputs, { pooling: 'cls', normalize: true })
  const [n, dim] = out.dims
  const vectors: Float32Array[] = []
  for (let i = 0; i < n; i++) vectors.push(out.data.slice(i * dim, (i + 1) * dim))
  return vectors
}

// ── Documents ─────────────────────────────────────────────────────────────────

export const EMBED_SOURCE_SELECT = {
  id: true,
  text: true,
  translatedText: true,
  quotedText: true,
  authorHandle: true,
  authorName: true,
  semanticTags: true,
  entities: true,
  mediaItems: { select: { imageTags: true } },
  categories: { select: { category: { select: { name: true } } } },
  embedding: { select: { docHash: true, model: true } },
} as const

export interface EmbedSourceRow {
  id: string
  text: string
  translatedText?: string | null
  quotedText: string | null
  authorHandle: string
  authorName: string
  semanticTags: string | null
  entities: string | null
  mediaItems: { imageTags: string | null }[]
  categories: { category: { name: string } }[]
  embedding?: { docHash: string; model: string } | null
}

/** The text that gets embedded for a bookmark. Deterministic. */
export function buildBookmarkDocument(b: EmbedSourceRow): string {
  const lines: string[] = []
  lines.push(`Post by ${b.authorName} (@${b.authorHandle})`)
  lines.push(b.text.trim())
  if (b.translatedText) lines.push(`English: ${b.translatedText.trim()}`)
  if (b.quotedText) lines.push(`Quoting ${b.quotedText.trim()}`)
  const cats = b.categories.map((c) => c.category.name).filter(Boolean)
  if (cats.length) lines.push(`Topics: ${cats.join(', ')}`)
  const tags = semanticTagsToText(b.semanticTags)
  if (tags) lines.push(`Tags: ${tags}`)
  let ents: { hashtags?: string[]; tools?: string[] } | null = null
  try { ents = b.entities ? JSON.parse(b.entities) : null } catch { /* ignore */ }
  if (ents?.hashtags?.length) lines.push(`Hashtags: ${ents.hashtags.slice(0, 10).join(' ')}`)
  if (ents?.tools?.length) lines.push(`Tools: ${ents.tools.join(', ')}`)
  const img = b.mediaItems.map((m) => imageTagsToText(m.imageTags)).filter(Boolean).join(' ')
  if (img) lines.push(`Image: ${img}`)
  return lines.join('\n').slice(0, 2000)
}

export function hashDocument(doc: string): string {
  return createHash('sha1').update(EMBEDDING_MODEL).update('\n').update(doc).digest('hex')
}

function toBuffer(vec: Float32Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(vec.byteLength)
  out.set(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength))
  return out
}

function fromBuffer(buf: Uint8Array, dim: number): Float32Array {
  const ab = new ArrayBuffer(dim * 4)
  new Uint8Array(ab).set(buf.subarray(0, dim * 4))
  return new Float32Array(ab)
}

// ── Indexing ──────────────────────────────────────────────────────────────────

export interface EmbedOptions {
  force?: boolean
  onProgress?: (done: number, total: number) => void
  shouldAbort?: () => boolean
}

/**
 * Embed the given bookmarks (or every bookmark when ids is null). Rows whose
 * document text is unchanged are skipped unless `force` is set. Returns the
 * number of vectors written.
 */
export async function embedBookmarks(ids: string[] | null, options: EmbedOptions = {}): Promise<number> {
  if (DISABLED) return 0
  const { force = false, onProgress, shouldAbort } = options
  const CHUNK = 64
  let written = 0
  let done = 0

  const total = ids ? ids.length : await prisma.bookmark.count()
  let cursor: string | undefined
  let offset = 0

  while (true) {
    if (shouldAbort?.()) break
    const rows: EmbedSourceRow[] = ids
      ? await prisma.bookmark.findMany({ where: { id: { in: ids.slice(offset, offset + CHUNK) } }, select: EMBED_SOURCE_SELECT })
      : await prisma.bookmark.findMany({
          where: cursor ? { id: { gt: cursor } } : {},
          orderBy: { id: 'asc' },
          take: CHUNK,
          select: EMBED_SOURCE_SELECT,
        })
    if (rows.length === 0) break
    if (ids) offset += CHUNK
    else cursor = rows[rows.length - 1].id

    const work: { id: string; doc: string; hash: string }[] = []
    for (const r of rows) {
      const doc = buildBookmarkDocument(r)
      const hash = hashDocument(doc)
      if (!force && r.embedding?.docHash === hash && r.embedding.model === EMBEDDING_MODEL) continue
      work.push({ id: r.id, doc, hash })
    }

    if (work.length > 0) {
      const vectors = await embedTexts(work.map((w) => w.doc), 'passage')
      await prisma.$transaction(
        work.map((w, i) =>
          prisma.bookmarkEmbedding.upsert({
            where: { bookmarkId: w.id },
            update: { model: EMBEDDING_MODEL, dim: vectors[i].length, vector: toBuffer(vectors[i]), docHash: w.hash },
            create: { bookmarkId: w.id, model: EMBEDDING_MODEL, dim: vectors[i].length, vector: toBuffer(vectors[i]), docHash: w.hash },
          }),
        ),
      )
      written += work.length
      invalidateVectorCache()
    }

    done += rows.length
    onProgress?.(Math.min(done, total), total)
    if (ids ? offset >= ids.length : rows.length < CHUNK) break
  }
  return written
}

/** Background, coalescing indexer used after imports. Never throws. */
export function scheduleEmbedding(ids: string[]): void {
  if (DISABLED || ids.length === 0) return
  for (const id of ids) state.pending.add(id)
  if (state.status === 'running') return
  void runPending()
}

async function runPending(): Promise<void> {
  while (state.pending.size > 0) {
    const batch = Array.from(state.pending)
    state.pending.clear()
    try {
      await runIndex(batch, false)
    } catch (err) {
      console.warn('[embeddings] background indexing failed:', err instanceof Error ? err.message : err)
      return
    }
  }
}

/** Run a tracked indexing job (progress visible via getEmbeddingStatus). */
export async function runIndex(ids: string[] | null, force: boolean): Promise<number> {
  if (state.status === 'running') throw new Error('Indexing is already running')
  state.status = 'running'
  state.abort = false
  state.error = null
  state.done = 0
  state.total = ids ? ids.length : await prisma.bookmark.count()
  try {
    return await embedBookmarks(ids, {
      force,
      onProgress: (done, total) => { state.done = done; state.total = total },
      shouldAbort: () => state.abort,
    })
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    state.status = 'idle'
  }
}

export function abortIndex(): void {
  state.abort = true
}

export interface EmbeddingStatus {
  enabled: boolean
  model: string
  modelStatus: ModelStatus
  modelError: string | null
  indexing: boolean
  done: number
  total: number
  embedded: number
  bookmarks: number
  error: string | null
}

export async function getEmbeddingStatus(): Promise<EmbeddingStatus> {
  const [embedded, bookmarks] = await Promise.all([
    prisma.bookmarkEmbedding.count({ where: { model: EMBEDDING_MODEL } }),
    prisma.bookmark.count(),
  ])
  return {
    enabled: !DISABLED,
    model: EMBEDDING_MODEL,
    modelStatus: state.modelStatus,
    modelError: state.modelError,
    indexing: state.status === 'running',
    done: state.done,
    total: state.total,
    embedded,
    bookmarks,
    error: state.error,
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

interface VectorCache {
  version: number
  ids: string[]
  vectors: Float32Array[]
}

let vectorCache: VectorCache | null = null

export function invalidateVectorCache(): void {
  state.cacheVersion++
}

async function loadVectors(): Promise<VectorCache> {
  if (vectorCache && vectorCache.version === state.cacheVersion) return vectorCache
  const rows = await prisma.bookmarkEmbedding.findMany({
    where: { model: EMBEDDING_MODEL },
    select: { bookmarkId: true, vector: true, dim: true },
  })
  const cache: VectorCache = { version: state.cacheVersion, ids: [], vectors: [] }
  for (const r of rows) {
    cache.ids.push(r.bookmarkId)
    cache.vectors.push(fromBuffer(r.vector, r.dim))
  }
  vectorCache = cache
  return cache
}

export interface VectorHit {
  id: string
  score: number
}

/**
 * Nearest bookmarks to a natural-language query. Returns [] when the model
 * is unavailable so keyword search can carry on alone.
 *
 * Thresholds (measured with bge-small on real posts): genuine matches score
 * roughly 0.68–0.86, unrelated posts 0.45–0.60. A hit is kept when it clears
 * `minScore` AND sits within `window` of the best hit, so a strong match does
 * not drag a long tail of loosely related posts in with it.
 */
export async function vectorSearch(query: string, limit = 200, minScore = 0.6, window = 0.15): Promise<VectorHit[]> {
  if (DISABLED || !query.trim()) return []
  try {
    const [cache, [q]] = await Promise.all([loadVectors(), embedTexts([query], 'query')])
    if (cache.ids.length === 0) return []
    const hits: VectorHit[] = []
    let best = 0
    for (let i = 0; i < cache.ids.length; i++) {
      const score = dot(q, cache.vectors[i])
      if (score > best) best = score
      if (score >= minScore) hits.push({ id: cache.ids[i], score })
    }
    const floor = Math.max(minScore, best - window)
    return topN(hits.filter((h) => h.score >= floor), limit)
  } catch (err) {
    console.warn('[embeddings] vector search unavailable:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Bookmarks whose vectors are closest to the given bookmark's vector. */
export async function relatedByVector(bookmarkId: string, limit = 6, minScore = 0.55): Promise<VectorHit[]> {
  if (DISABLED) return []
  try {
    const cache = await loadVectors()
    const idx = cache.ids.indexOf(bookmarkId)
    if (idx === -1) return []
    const q = cache.vectors[idx]
    const hits: VectorHit[] = []
    for (let i = 0; i < cache.ids.length; i++) {
      if (i === idx) continue
      const score = dot(q, cache.vectors[i])
      if (score >= minScore) hits.push({ id: cache.ids[i], score })
    }
    return topN(hits, limit)
  } catch (err) {
    console.warn('[embeddings] related lookup failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Warm the model in the background so the first search is fast. */
export function warmEmbeddingModel(): void {
  if (DISABLED || state.modelStatus !== 'unloaded') return
  getExtractor().catch(() => { /* status recorded in state */ })
}
