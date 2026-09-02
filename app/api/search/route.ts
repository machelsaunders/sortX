import { NextRequest, NextResponse } from 'next/server'
import { hybridSearch, toParsedInfo } from '@/lib/hybrid-search'
import { warmEmbeddingModel } from '@/lib/embeddings'
import type { SearchResponse } from '@/lib/types'

/**
 * Instant hybrid search. No AI calls — keyword (FTS5) + local semantic
 * vectors fused together, with filters parsed from plain English.
 *
 *   GET /api/search?q=memes+about+ai+last+month&limit=30&category=&typing=1
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl
  const q = searchParams.get('q')?.trim() ?? ''
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10) || 30, 100)
  const category = searchParams.get('category')?.trim() || undefined
  const asYouType = searchParams.get('typing') === '1'

  if (!q) return NextResponse.json({ error: 'Query required' }, { status: 400 })

  warmEmbeddingModel()

  try {
    const result = await hybridSearch(q, { limit, category, asYouType })
    const body: SearchResponse = {
      bookmarks: result.bookmarks,
      total: result.total,
      parsed: toParsedInfo(result.parsed),
      usedSemantic: result.usedSemantic,
      tookMs: result.tookMs,
    }
    return NextResponse.json(body)
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json({ error: `Search failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
