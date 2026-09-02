import { NextRequest, NextResponse } from 'next/server'
import { importParsedBookmarks } from '@/lib/import-bookmarks'
import { parseTimeline } from '@/lib/twitter-api'
import { tweetResultToParsed } from '@/lib/tweet-normalize'

/**
 * One-shot cookie import of bookmarks or likes. Body: { authToken, ct0, source?, userId? }.
 * Query IDs change when X deploys; override with X_BOOKMARKS_QUERY_ID / X_LIKES_QUERY_ID.
 */

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

const FEATURES = JSON.stringify({
  graphql_timeline_v2_bookmark_timeline: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
})

const ENDPOINTS = {
  bookmark: {
    queryId: process.env.X_BOOKMARKS_QUERY_ID ?? 'xLjCVTqYWz8CGSprLU349w',
    operationName: 'Bookmarks',
    referer: 'https://x.com/i/bookmarks',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getInstructions: (d: any): unknown[] => d?.data?.bookmark_timeline_v2?.timeline?.instructions ?? [],
  },
  like: {
    // Find the current Likes query ID: open x.com/<you>/likes with the Network tab open,
    // filter "graphql", and copy the ID from the "Likes" request path.
    queryId: process.env.X_LIKES_QUERY_ID ?? '',
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

async function fetchPage(authToken: string, ct0: string, source: Source, cursor?: string, userId?: string) {
  const cfg = ENDPOINTS[source]
  const variables = JSON.stringify({
    count: 100,
    includePromotedContent: false,
    ...(source === 'like' && userId ? { userId } : {}),
    ...(cursor ? { cursor } : {}),
  })
  const url = `https://x.com/i/api/graphql/${cfg.queryId}/${cfg.operationName}?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(FEATURES)}`

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
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitter API ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
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
  if (source === 'like' && !ENDPOINTS.like.queryId) {
    return NextResponse.json({ error: 'Set X_LIKES_QUERY_ID in your environment to import likes' }, { status: 400 })
  }

  let imported = 0
  let skipped = 0
  let cursor: string | undefined
  const MAX_PAGES = 100

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await fetchPage(authToken.trim(), ct0.trim(), source, cursor, userId)
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
