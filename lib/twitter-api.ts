/**
 * Cookie-based X bookmark fetcher (auth_token + ct0) used by the scheduled
 * sync in lib/x-sync.ts. Tweet parsing lives in lib/tweet-normalize.ts and
 * database writes in lib/import-bookmarks.ts so every import path behaves
 * the same way.
 */
import { importParsedBookmarks } from '@/lib/import-bookmarks'
import { tweetResultToParsed, unwrapTweet, type TweetResult } from '@/lib/tweet-normalize'

export type { TweetResult } from '@/lib/tweet-normalize'
export { tweetFullText, extractMedia } from '@/lib/tweet-normalize'

// ── Constants ─────────────────────────────────────────────────────────────────

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

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

// Query ID for X's internal Bookmarks GraphQL endpoint.
// It changes when X deploys — update if you get 400/404 errors. Override with X_BOOKMARKS_QUERY_ID.
const QUERY_ID = process.env.X_BOOKMARKS_QUERY_ID ?? 'xLjCVTqYWz8CGSprLU349w'

// ── Fetch + Parse ─────────────────────────────────────────────────────────────

export async function fetchPage(authToken: string, ct0: string, cursor?: string) {
  const variables = JSON.stringify({
    count: 100,
    includePromotedContent: false,
    ...(cursor ? { cursor } : {}),
  })

  const url = `https://x.com/i/api/graphql/${QUERY_ID}/Bookmarks?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(FEATURES)}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'X-Csrf-Token': ct0,
      Cookie: `auth_token=${authToken}; ct0=${ct0}`,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      'X-Twitter-Client-Language': 'en',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://x.com/i/bookmarks',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twitter API ${res.status}: ${text.slice(0, 300)}`)
  }

  try {
    return await res.json()
  } catch {
    throw new Error('Twitter returned an invalid response (not JSON)')
  }
}

/** Walk timeline instructions and pull out tweets + the bottom cursor. */
export function parseTimeline(instructions: unknown[]): { tweets: TweetResult[]; nextCursor: string | null } {
  const tweets: TweetResult[] = []
  let nextCursor: string | null = null

  for (const instruction of instructions as Array<Record<string, unknown>>) {
    if (instruction.type !== 'TimelineAddEntries') continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const entry of ((instruction as any).entries ?? []) as Array<Record<string, any>>) {
      const content = entry.content
      if (content?.entryType === 'TimelineTimelineItem') {
        const tweet = unwrapTweet(content?.itemContent?.tweet_results?.result)
        if (tweet?.rest_id) tweets.push(tweet)
      } else if (content?.entryType === 'TimelineTimelineCursor' && content?.cursorType === 'Bottom') {
        nextCursor = content.value ?? null
      }
    }
  }
  return { tweets, nextCursor }
}

export function parsePage(data: unknown): { tweets: TweetResult[]; nextCursor: string | null } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instructions = (data as any)?.data?.bookmark_timeline_v2?.timeline?.instructions ?? []
  return parseTimeline(instructions)
}

// ── Import tweets to DB ───────────────────────────────────────────────────────

export async function importTweets(
  tweets: TweetResult[],
  source: 'bookmark' | 'like' = 'bookmark',
): Promise<{ imported: number; skipped: number }> {
  const parsed = tweets.map(tweetResultToParsed).filter((b): b is NonNullable<typeof b> => b !== null)
  const result = await importParsedBookmarks(parsed, source)
  return { imported: result.imported, skipped: result.skipped }
}
