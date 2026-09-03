import { NextRequest, NextResponse } from 'next/server'
import { importParsedBookmarks } from '@/lib/import-bookmarks'
import { tweetResultToParsed, type TweetResult } from '@/lib/tweet-normalize'

const ALLOWED_ORIGINS = new Set(['https://x.com', 'https://twitter.com', 'https://mobile.x.com', 'https://mobile.twitter.com'])

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('Origin') ?? ''
  // x.com pages (bookmarklet fallback) and the sortX Sync browser extension
  const allowed = ALLOWED_ORIGINS.has(origin) || /^(chrome|moz|safari-web)-extension:\/\//.test(origin) ? origin : 'https://x.com'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) })
}

/** Progress of the most recent direct import, polled by the Import page. */
export interface DirectImportProgress {
  sessionId: string | null
  source: 'bookmark' | 'like'
  received: number
  imported: number
  skipped: number
  batches: number
  done: boolean
  total: number | null
  startedAt: string | null
  updatedAt: string | null
  error: string | null
}

const g = globalThis as unknown as { __sortxDirectImport?: DirectImportProgress }
function getProgress(): DirectImportProgress {
  if (!g.__sortxDirectImport) {
    g.__sortxDirectImport = {
      sessionId: null, source: 'bookmark', received: 0, imported: 0, skipped: 0, batches: 0,
      done: false, total: null, startedAt: null, updatedAt: null, error: null,
    }
  }
  return g.__sortxDirectImport
}

/** GET — progress of the current/last direct import (same-origin, used by the Import page). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(getProgress())
}

/** POST — receives raw GraphQL tweet objects streamed from x.com by the direct-import script. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cors = corsHeaders(request)
  let body: { tweets?: TweetResult[]; source?: string; sessionId?: string; done?: boolean; total?: number } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const source = body.source === 'like' ? 'like' : 'bookmark'
  const tweets = Array.isArray(body.tweets) ? body.tweets : []
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 40) : null

  const progress = getProgress()
  if (sessionId && progress.sessionId !== sessionId) {
    // New run — reset counters
    Object.assign(progress, {
      sessionId, source, received: 0, imported: 0, skipped: 0, batches: 0,
      done: false, total: null, startedAt: new Date().toISOString(), updatedAt: null, error: null,
    })
  }

  let imported = 0
  let skipped = 0
  if (tweets.length > 0) {
    try {
      const parsed = tweets.map(tweetResultToParsed).filter((b): b is NonNullable<typeof b> => b !== null)
      const result = await importParsedBookmarks(parsed, source)
      imported = result.imported
      skipped = result.skipped
    } catch (err) {
      progress.error = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: progress.error }, { status: 500, headers: cors })
    }
  } else if (!body.done) {
    return NextResponse.json({ error: 'No tweets provided' }, { status: 400, headers: cors })
  }

  progress.received += tweets.length
  progress.imported += imported
  progress.skipped += skipped
  progress.batches += tweets.length > 0 ? 1 : 0
  progress.updatedAt = new Date().toISOString()
  if (body.done) {
    progress.done = true
    if (typeof body.total === 'number') progress.total = body.total
  }

  return NextResponse.json({ imported, skipped, sessionId }, { headers: cors })
}
