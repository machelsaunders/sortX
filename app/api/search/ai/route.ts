import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { hybridSearch, toParsedInfo } from '@/lib/hybrid-search'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getActiveModel, getProvider } from '@/lib/settings'
import { getCliAvailability, claudePrompt, modelNameToCliAlias } from '@/lib/claude-cli-auth'
import { getCodexCliAvailability, codexPrompt } from '@/lib/codex-cli'
import { imageTagsToText } from '@/lib/fts'
import type { SearchHit, SearchResponse } from '@/lib/types'

/**
 * "Ask AI" search: hybrid retrieval picks the best ~40 candidates, then the
 * configured model reranks them, explains each match, and summarises what
 * it found. Far cheaper and more accurate than sending 150 random rows.
 */

const CANDIDATES = 40
const MAX_RESULTS = 15

// ── Cache ─────────────────────────────────────────────────────────────────────
interface CacheEntry { results: SearchResponse; expiresAt: number }
const searchCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

function getCached(key: string): SearchResponse | null {
  const entry = searchCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { searchCache.delete(key); return null }
  return entry.results
}
function setCache(key: string, results: SearchResponse): void {
  if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value!)
  searchCache.set(key, { results, expiresAt: Date.now() + CACHE_TTL_MS })
}
export function clearAiSearchCache(): void {
  searchCache.clear()
}

async function getDbApiKey(): Promise<string> {
  const provider = await getProvider()
  const keyName = provider === 'openai' ? 'openaiApiKey' : provider === 'minimax' ? 'minimaxApiKey' : 'anthropicApiKey'
  const setting = await prisma.setting.findUnique({ where: { key: keyName } })
  return setting?.value?.trim() ?? ''
}

function indexEntry(b: SearchHit): string {
  const lines = [`[${b.id}] @${b.authorHandle}${b.tweetCreatedAt ? ` ${b.tweetCreatedAt.slice(0, 10)}` : ''}`]
  lines.push(`text: ${b.text.replace(/\s+/g, ' ').slice(0, 320)}`)
  if (b.quotedText) lines.push(`quoting: ${b.quotedText.replace(/\s+/g, ' ').slice(0, 160)}`)
  const img = b.mediaItems.map((m) => imageTagsToText(m.imageTags ?? null)).filter(Boolean).join(' | ')
  if (img) lines.push(`media: ${img.slice(0, 220)}`)
  else if (b.mediaItems.length) lines.push(`media: ${b.mediaItems.map((m) => m.type).join(', ')}`)
  if (b.categories.length) lines.push(`categories: ${b.categories.map((c) => c.name).join(', ')}`)
  return lines.join('\n')
}

interface AiResponse {
  matches: { id: string; score: number; reason: string }[]
  explanation: string
}

function parseAiResponse(rawText: string): AiResponse {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { matches: [], explanation: '' }
  const parsed = JSON.parse(jsonMatch[0]) as Partial<AiResponse>
  return {
    matches: Array.isArray(parsed.matches) ? parsed.matches.filter((m) => m && typeof m.id === 'string') : [],
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { query?: string; category?: string } = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { query, category } = body
  if (!query?.trim()) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  const cacheKey = `${query.trim().toLowerCase()}::${category ?? ''}`
  const cached = getCached(cacheKey)
  if (cached) return NextResponse.json(cached)

  // ── Step 1: hybrid candidates ─────────────────────────────────────────────
  const hybrid = await hybridSearch(query, { limit: CANDIDATES, category, candidates: 300 })
  const base = {
    total: hybrid.total,
    parsed: toParsedInfo(hybrid.parsed),
    usedSemantic: hybrid.usedSemantic,
    tookMs: hybrid.tookMs,
  }

  if (hybrid.bookmarks.length === 0) {
    return NextResponse.json({ ...base, bookmarks: [], explanation: 'Nothing in your library matches that yet.' } satisfies SearchResponse)
  }

  // ── Step 2: rerank with the configured model ──────────────────────────────
  const entries = hybrid.bookmarks.map(indexEntry).join('\n---\n')
  const prompt = `You are the search engine for someone's personal library of saved X/Twitter posts. Below are the ${hybrid.bookmarks.length} best candidates a keyword+semantic index found for their query. Pick the ones that genuinely answer what they want, in order.

USER QUERY: "${query}"
${hybrid.parsed.filters.length ? `FILTERS ALREADY APPLIED: ${hybrid.parsed.filters.join(', ')}` : ''}

Judge by meaning, not word overlap. Use text, quoted text, image descriptions, and categories. A candidate about the same topic phrased differently is a match; one that only shares a common word is not.

CANDIDATES:
${entries}

Return ONLY JSON:
{
  "matches": [ { "id": "candidate id", "score": 0.0-1.0, "reason": "≤12 words, specific to this post" } ],
  "explanation": "one plain sentence about what was found"
}
Rules: up to ${MAX_RESULTS} matches sorted by score, only ids from the list, no repeats, minimum score 0.3, and if nothing fits return an empty matches array.`

  const provider = await getProvider()
  const model = await getActiveModel()
  let ai: AiResponse | null = null

  try {
    if (provider === 'openai' && await getCodexCliAvailability()) {
      const result = await codexPrompt(prompt, { timeoutMs: 90_000 })
      if (result.success && result.data) ai = parseAiResponse(result.data)
    } else if (provider === 'anthropic' && await getCliAvailability()) {
      const result = await claudePrompt(prompt, { model: modelNameToCliAlias(model), timeoutMs: 90_000 })
      if (result.success && result.data) ai = parseAiResponse(result.data)
    }
  } catch (err) {
    console.warn('[ai-search] CLI path failed, trying SDK:', err instanceof Error ? err.message : err)
  }

  if (!ai) {
    let client: AIClient | null = null
    try {
      client = await resolveAIClient({ dbKey: await getDbApiKey() })
    } catch { /* no SDK auth */ }

    if (!client) {
      // No AI available: still return the hybrid results so the page is useful
      const fallback: SearchResponse = {
        ...base,
        bookmarks: hybrid.bookmarks.slice(0, MAX_RESULTS),
        explanation: 'AI is not configured, so these are the best keyword + semantic matches.',
        aiUnavailable: true,
      }
      return NextResponse.json(fallback)
    }

    try {
      const response = await client.createMessage({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
      ai = parseAiResponse(response.text ?? '{}')
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('AI search error:', errMsg)
      return NextResponse.json({ error: `AI search failed: ${errMsg}` }, { status: 500 })
    }
  }

  // ── Step 3: hydrate in AI order ───────────────────────────────────────────
  const byId = new Map(hybrid.bookmarks.map((b) => [b.id, b]))
  const seen = new Set<string>()
  const bookmarks: SearchHit[] = []
  for (const m of ai.matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    const b = byId.get(m.id)
    if (!b || seen.has(m.id)) continue
    seen.add(m.id)
    bookmarks.push({ ...b, aiScore: typeof m.score === 'number' ? m.score : 0, aiReason: typeof m.reason === 'string' ? m.reason : '' })
    if (bookmarks.length >= MAX_RESULTS) break
  }

  const response: SearchResponse = {
    ...base,
    bookmarks,
    explanation: ai.explanation || (bookmarks.length ? `Found ${bookmarks.length} matching posts.` : 'Nothing in your library clearly matches that.'),
  }
  setCache(cacheKey, response)
  return NextResponse.json(response)
}
