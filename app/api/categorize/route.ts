import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getActiveModel, getProvider } from '@/lib/settings'
import {
  seedDefaultCategories,
  categorizeBatch,
  mapBookmarkForCategorization,
  writeCategoryResults,
  BOOKMARK_SELECT,
} from '@/lib/categorizer'
import {
  analyzeItem,
  runWithConcurrency,
  enrichBatchSemanticTags,
  BookmarkForEnrichment,
} from '@/lib/vision-analyzer'
import { backfillEntities } from '@/lib/rawjson-extractor'
import { rebuildFts } from '@/lib/fts'
import { embedBookmarks } from '@/lib/embeddings'

type Stage = 'vision' | 'entities' | 'enrichment' | 'categorize' | 'parallel' | 'index'

interface CategorizationState {
  status: 'idle' | 'running' | 'stopping'
  stage: Stage | null
  done: number
  total: number
  stageCounts: {
    visionTagged: number
    entitiesExtracted: number
    enriched: number
    categorized: number
    indexed: number
  }
  lastError: string | null
  error: string | null
  startedAt: string | null
}

// In-memory state for progress tracking across requests
const globalState = globalThis as unknown as {
  categorizationState: CategorizationState
  categorizationAbort: boolean
}

if (!globalState.categorizationState) {
  globalState.categorizationState = {
    status: 'idle',
    stage: null,
    done: 0,
    total: 0,
    stageCounts: { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0, indexed: 0 },
    lastError: null,
    error: null,
    startedAt: null,
  }
}
if (globalState.categorizationAbort === undefined) {
  globalState.categorizationAbort = false
}

function shouldAbort(): boolean {
  return globalState.categorizationAbort
}

function getState(): CategorizationState {
  return { ...globalState.categorizationState }
}

function setState(update: Partial<CategorizationState>): void {
  globalState.categorizationState = { ...globalState.categorizationState, ...update }
}

export async function GET(): Promise<NextResponse> {
  const state = getState()
  return NextResponse.json({
    status: state.status,
    stage: state.stage,
    done: state.done,
    total: state.total,
    stageCounts: state.stageCounts,
    lastError: state.lastError,
    error: state.error,
    startedAt: state.startedAt,
  })
}

export async function DELETE(): Promise<NextResponse> {
  const state = getState()
  if (state.status !== 'running') {
    return NextResponse.json({ error: 'No pipeline running' }, { status: 409 })
  }
  globalState.categorizationAbort = true
  setState({ status: 'stopping' })
  return NextResponse.json({ stopped: true })
}

const PIPELINE_WORKERS = 6      // concurrent chunks
const CHUNK_SIZE = 10           // bookmarks per semantic-tagging call
const VISION_CONCURRENCY = 3    // concurrent image analyses within a chunk
const CAT_BATCH_SIZE = 25

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (getState().status === 'running' || getState().status === 'stopping') {
    return NextResponse.json({ error: 'Categorization is already running' }, { status: 409 })
  }

  let body: { bookmarkIds?: string[]; apiKey?: string; force?: boolean } = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { bookmarkIds = [], apiKey, force = false } = body

  if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
    const currentProvider = await getProvider()
    const keySlot = currentProvider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
    await prisma.setting.upsert({
      where: { key: keySlot },
      update: { value: apiKey.trim() },
      create: { key: keySlot, value: apiKey.trim() },
    })
  }

  globalState.categorizationAbort = false

  let total = 0
  try {
    if (bookmarkIds.length > 0) {
      total = bookmarkIds.length
    } else if (force) {
      total = await prisma.bookmark.count()
    } else {
      total = await prisma.bookmark.count({ where: { enrichedAt: null } })
    }
  } catch {
    total = 0
  }

  setState({
    status: 'running',
    stage: 'entities',
    done: 0,
    total,
    stageCounts: { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0, indexed: 0 },
    lastError: null,
    error: null,
    startedAt: new Date().toISOString(),
  })

  const provider = await getProvider()
  const keyName = provider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
  const dbApiKey =
    (await prisma.setting.findUnique({ where: { key: keyName } }))?.value?.trim() || ''

  void (async () => {
    const counts = { visionTagged: 0, entitiesExtracted: 0, enriched: 0, categorized: 0, indexed: 0 }

    try {
      let client: AIClient | null = null
      try {
        client = await resolveAIClient({ dbKey: dbApiKey })
      } catch {
        // SDK client not available — CLI path may still work (e.g. ChatGPT OAuth via codex exec)
        console.warn('No SDK client available — will rely on CLI path')
      }

        await seedDefaultCategories()

        if (force) {
          await prisma.mediaItem.updateMany({ where: { imageTags: '{}' }, data: { imageTags: null } })
          await prisma.bookmark.updateMany({ where: { semanticTags: '[]' }, data: { semanticTags: null } })
        }

        // Stage 1: Entity extraction (free, fast — no API calls)
        if (!shouldAbort()) {
          setState({ stage: 'entities' })
          counts.entitiesExtracted = await backfillEntities((n) => {
            counts.entitiesExtracted = n
            setState({ stageCounts: { ...counts } })
          }, shouldAbort).catch((err) => {
            console.error('Entity extraction error:', err)
            return counts.entitiesExtracted
          })
          setState({ stageCounts: { ...counts } })
        }

        // Stage 2: Parallel pipeline — vision + enrichment + categorize per bookmark
        if (!shouldAbort()) {
          // Fetch all bookmark IDs to process
          let bookmarkIdsToProcess: string[]
          if (bookmarkIds.length > 0) {
            bookmarkIdsToProcess = bookmarkIds
          } else if (force) {
            const all = await prisma.bookmark.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
            bookmarkIdsToProcess = all.map((b) => b.id)
          } else {
            const unprocessed = await prisma.bookmark.findMany({
              where: { enrichedAt: null },
              select: { id: true },
              orderBy: { id: 'asc' },
            })
            bookmarkIdsToProcess = unprocessed.map((b) => b.id)
          }

          const runTotal = bookmarkIdsToProcess.length
          setState({ stage: 'parallel', done: 0, total: runTotal, stageCounts: { ...counts } })

          // Load category metadata once (shared across all workers)
          const dbCategories = await prisma.category.findMany({
            select: { slug: true, name: true, description: true },
          })
          const allSlugs = dbCategories.map((c) => c.slug)
          const categoryDescriptions = Object.fromEntries(
            dbCategories.map((c) => [c.slug, c.description?.trim() || c.name]),
          )
          const model = await getActiveModel()

          // Shared categorization queue (JS single-threaded: splice is atomic vs async)
          const catPending: string[] = []
          let catFlushing = false

          async function drainCategorizeQueue(final = false): Promise<void> {
            if (final) {
              // Wait for any in-progress flush before draining remainder
              while (catFlushing) {
                await new Promise<void>((resolve) => setTimeout(resolve, 50))
              }
            } else if (catFlushing || catPending.length < CAT_BATCH_SIZE) {
              return
            }

            catFlushing = true
            try {
              while (catPending.length > 0) {
                if (!final && catPending.length < CAT_BATCH_SIZE) break
                const ids = catPending.splice(0, CAT_BATCH_SIZE)
                if (ids.length === 0) break
                const rows = await prisma.bookmark.findMany({
                  where: { id: { in: ids } },
                  select: BOOKMARK_SELECT,
                })
                const batch = rows.map(mapBookmarkForCategorization)
                try {
                  const results = await categorizeBatch(batch, client, categoryDescriptions, allSlugs)
                  await writeCategoryResults(results)
                  counts.categorized += ids.length
                  setState({ stageCounts: { ...counts } })
                } catch (catErr) {
                  console.error('[parallel] categorize batch error:', catErr)
                }
              }
            } finally {
              catFlushing = false
            }
          }

          let processedCount = 0

          /** Video/GIF thumbnails rarely carry the content; only analyse them when the post has almost no text. */
          function needsVision(media: { type: string; imageTags: string | null }, text: string): boolean {
            if (media.imageTags !== null) return false
            if (media.type === 'photo') return true
            return text.trim().length < 60
          }

          // Each worker takes a chunk: vision for the chunk's images (bounded
          // concurrency), ONE tagging call for the whole chunk, then queue for
          // categorization. This is ~10x fewer model calls than per-bookmark.
          async function processChunk(chunkIds: string[]): Promise<void> {
            if (shouldAbort()) return
            const rows = await prisma.bookmark.findMany({
              where: { id: { in: chunkIds } },
              select: {
                id: true,
                text: true,
                semanticTags: true,
                entities: true,
                mediaItems: {
                  where: { type: { in: ['photo', 'gif', 'video'] } },
                  select: { id: true, url: true, thumbnailUrl: true, type: true, imageTags: true },
                },
              },
            })

            // Vision
            const visionTasks: (() => Promise<void>)[] = []
            for (const bm of rows) {
              for (const media of bm.mediaItems) {
                if (!needsVision(media, bm.text)) continue
                visionTasks.push(async () => {
                  if (shouldAbort()) return
                  try {
                    await analyzeItem({ id: media.id, url: media.url, thumbnailUrl: media.thumbnailUrl, type: media.type }, client, model)
                    counts.visionTagged++
                    setState({ stageCounts: { ...counts } })
                  } catch (err) {
                    console.warn('[pipeline] vision failed for', media.id, err instanceof Error ? err.message : err)
                  }
                })
              }
            }
            if (visionTasks.length) await runWithConcurrency(visionTasks, VISION_CONCURRENCY)
            if (shouldAbort()) return

            // Semantic tags — one call for the chunk
            const needTags = rows.filter((bm) => !bm.semanticTags)
            if (needTags.length) {
              const freshMedia = await prisma.mediaItem.findMany({
                where: { bookmarkId: { in: needTags.map((b) => b.id) }, type: { in: ['photo', 'gif', 'video'] } },
                select: { bookmarkId: true, imageTags: true },
              })
              const tagsByBookmark = new Map<string, string[]>()
              for (const m of freshMedia) {
                if (m.imageTags && m.imageTags !== '' && m.imageTags !== '{}') {
                  tagsByBookmark.set(m.bookmarkId, [...(tagsByBookmark.get(m.bookmarkId) ?? []), m.imageTags])
                }
              }
              const trivial: string[] = []
              const toEnrich: BookmarkForEnrichment[] = []
              for (const bm of needTags) {
                const imageTags = tagsByBookmark.get(bm.id) ?? []
                if (imageTags.length === 0 && bm.text.length < 20) { trivial.push(bm.id); continue }
                let entities: BookmarkForEnrichment['entities'] = undefined
                if (bm.entities) { try { entities = JSON.parse(bm.entities) as BookmarkForEnrichment['entities'] } catch { /* ignore */ } }
                toEnrich.push({ id: bm.id, text: bm.text, imageTags, entities })
              }
              if (trivial.length) {
                await prisma.bookmark.updateMany({ where: { id: { in: trivial } }, data: { semanticTags: '[]' } })
              }
              if (toEnrich.length) {
                try {
                  const results = await enrichBatchSemanticTags(toEnrich, client)
                  const byId = new Map(results.map((r) => [r.id, r]))
                  const updates = toEnrich
                    .map((b) => ({ id: b.id, r: byId.get(b.id) }))
                    .filter((x): x is { id: string; r: NonNullable<typeof x.r> } => !!x.r && x.r.tags.length > 0)
                  if (updates.length) {
                    await prisma.$transaction(
                      updates.map(({ id, r }) =>
                        prisma.bookmark.update({
                          where: { id },
                          data: {
                            semanticTags: JSON.stringify(r.tags),
                            enrichmentMeta: JSON.stringify({ sentiment: r.sentiment, people: r.people, companies: r.companies }),
                          },
                        }),
                      ),
                    )
                    counts.enriched += updates.length
                    setState({ stageCounts: { ...counts } })
                  }
                } catch (err) {
                  console.warn('[pipeline] enrichment failed for chunk:', err instanceof Error ? err.message : err)
                }
              }
            }

            // Queue for categorization
            for (const bm of rows) catPending.push(bm.id)
            processedCount += rows.length
            setState({ done: processedCount, stageCounts: { ...counts } })
            await drainCategorizeQueue()
          }

          const chunks: string[][] = []
          for (let i = 0; i < bookmarkIdsToProcess.length; i += CHUNK_SIZE) chunks.push(bookmarkIdsToProcess.slice(i, i + CHUNK_SIZE))
          const tasks = chunks.map((ids) => () => processChunk(ids))
          try {
            await runWithConcurrency(tasks, PIPELINE_WORKERS)
          } finally {
            // Always drain remaining items even if some workers threw
            await drainCategorizeQueue(true)
          }
        }
    } catch (err) {
      console.error('Pipeline error:', err)
      setState({ lastError: err instanceof Error ? err.message.slice(0, 200) : String(err) })
    }

    // Final stage: refresh the keyword index and re-embed anything whose
    // text/tags/categories changed so semantic search reflects the new data.
    if (!shouldAbort()) {
      setState({ stage: 'index', done: 0, total: 0 })
      await rebuildFts().catch((err) => console.error('FTS rebuild error:', err))
      try {
        counts.indexed = await embedBookmarks(null, {
          onProgress: (done, total) => setState({ done, total, stageCounts: { ...counts } }),
          shouldAbort,
        })
        setState({ stageCounts: { ...counts } })
      } catch (err) {
        console.error('Embedding index error:', err)
        setState({ lastError: `Semantic index: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}` })
      }
    }
  })()
    .then(() => {
      const wasStopped = globalState.categorizationAbort
      globalState.categorizationAbort = false
      setState({
        status: 'idle',
        stage: null,
        done: wasStopped ? getState().done : total,
        total,
        error: wasStopped ? 'Stopped by user' : null,
      })
    })
    .catch((err) => {
      globalState.categorizationAbort = false
      console.error('Categorization pipeline error:', err)
      setState({
        status: 'idle',
        stage: null,
        error: err instanceof Error ? err.message : String(err),
      })
    })

  return NextResponse.json({ status: 'started', total })
}
