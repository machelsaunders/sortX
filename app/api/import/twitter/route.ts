import { NextRequest, NextResponse } from 'next/server'
import { importParsedBookmarks } from '@/lib/import-bookmarks'
import { parseTimeline } from '@/lib/twitter-api'
import { tweetResultToParsed } from '@/lib/tweet-normalize'
import { getXQueryIds, TIMELINE_FEATURES, addMissingFeatures } from '@/lib/x-query-ids'

/**
 * One-shot cookie import of bookmarks or likes. Body: { authToken, ct0, source?, userId? }.
 * Query IDs change when X deploys; override with X_BOOKMARKS_QUERY_ID / X_LIKES_QUERY_ID.
 */

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const ENDPOINTS = {
  bookmark: {
    operationName: 'Bookmarks',
    referer: 'https://x.com/i/bookmarks',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getInstructions: (d: any): unknown[] => d?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [],
  },
  like: {
    // Find the current Likes query ID: open x.com/<you>/likes with the Network tab open,
    // filter "graphql", and copy the ID from the "Likes" request path.
    operationName: 'Likes',
    referer: 'https://x.com',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getInstructions: (d: any): unknown[] =>
      d?.data?.user?.result?.timeline_v2?.timeline?.instructions
      ?? d?.data?.liked_tweets_timeline?.timeline?.instructions
      ?? [],
  },
} as const

type Source = keyof typeof ENDPOINTS

const features: Record<string, boolean> = { ...TIMELINE_FEATURES }

async function fetchPage(authToken: string, ct0: string, source: Source, queryId: string, cursor?: string, userId?: string) {
  const cfg = ENDPOINTS[source]
  const variables = JSON.stringify({
    count: 100,
    includePromotedContent: false,
    ...(source === 'like' && userId ? { userId, withClientEventToken: false, withBirdwatchNotes: false, withVoice: true, withV2Timeline: true } : {}),
    ...(cursor ? { cursor } : {}),
  })
  const url = `https://x.com/i/api/graphql/${queryId}/${cfg.operationName}?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(JSON.stringify(features))}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'X-Csrf-Token': ct0,
      Cookie: `auth_token=${authToken}; ct0=${ct0}`,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: cfg.referer,
    },
  })
  const text = await res.text()
  if (res.status === 400 && addMissingFeatures(text, features).length > 0) {
    return fetchPage(authToken, ct0, source, queryId, cursor, userId)
  }
  if (!res.ok) throw new Error(`Twitter API ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { authToken?: string; ct0?: string; source?: string; userId?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { authToken, ct0 } = body
  const source: Source = body.source === 'like' ? 'like' : 'bookmark'
  const userId = body.userId?.trim()

  if (!authToken?.trim() || !ct0?.trim()) {
    return NextResponse.json({ error: 'authToken and ct0 are required' }, { status: 400 })
  }
  if (source === 'like' && !userId) {
    return NextResponse.json({ error: 'userId is required for importing likes' }, { status: 400 })
  }
  const ids = await getXQueryIds()
  const queryId = source === 'like' ? ids.likes : ids.bookmarks
  if (!queryId) {
    return NextResponse.json({ error: 'Could not determine the X query ID for likes. Set X_LIKES_QUERY_ID.' }, { status: 400 })
  }

  let imported = 0
  let skipped = 0
  let cursor: string | undefined
  const MAX_PAGES = 100

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await fetchPage(authToken.trim(), ct0.trim(), source, queryId, cursor, userId)
      const { tweets, nextCursor } = parseTimeline(ENDPOINTS[source].getInstructions(data))
      const parsed = tweets.map(tweetResultToParsed).filter((b): b is NonNullable<typeof b> => b !== null)
      const result = await importParsedBookmarks(parsed, source)
      imported += result.imported
      skipped += result.skipped
      if (!nextCursor || tweets.length === 0) break
      cursor = nextCursor
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch from Twitter' },
      { status: 500 },
    )
  }

  if (imported > 0 && process.env.AUTO_CATEGORIZE_AFTER_IMPORT === 'true') {
    const origin = request.nextUrl.origin
    void fetch(`${origin}/api/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: false }),
    }).catch(() => { /* best-effort */ })
  }

  return NextResponse.json({ imported, skipped })
}
