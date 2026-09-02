import { NextRequest, NextResponse } from 'next/server'
import { importParsedBookmarks } from '@/lib/import-bookmarks'
import { tweetResultToParsed, type TweetResult } from '@/lib/tweet-normalize'

const ALLOWED_ORIGINS = new Set(['https://x.com', 'https://twitter.com'])

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://x.com'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

/** Receives raw GraphQL tweet objects posted directly from x.com. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cors = corsHeaders(request)
  let body: { tweets?: TweetResult[]; source?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const source = body.source === 'like' ? 'like' : 'bookmark'
  const tweets = body.tweets ?? []
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return NextResponse.json({ error: 'No tweets provided' }, { status: 400, headers: cors })
  }

  const parsed = tweets.map(tweetResultToParsed).filter((b): b is NonNullable<typeof b> => b !== null)
  const result = await importParsedBookmarks(parsed, source)
  return NextResponse.json({ imported: result.imported, skipped: result.skipped }, { headers: cors })
}
