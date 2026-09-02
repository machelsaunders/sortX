/**
 * Cookie-based X bookmark fetcher (auth_token + ct0) used by the scheduled
 * sync in lib/x-sync.ts. Tweet parsing lives in lib/tweet-normalize.ts and
 * database writes in lib/import-bookmarks.ts so every import path behaves
 * the same way.
 */
import { importParsedBookmarks } from '@/lib/import-bookmarks'
import { tweetResultToParsed, unwrapTweet, type TweetResult } from '@/lib/tweet-normalize'
import { getXQueryIds, TIMELINE_FEATURES, addMissingFeatures } from '@/lib/x-query-ids'

export type { TweetResult } from '@/lib/tweet-normalize'
export { tweetFullText, extractMedia } from '@/lib/tweet-normalize'

// ── Constants ─────────────────────────────────────────────────────────────────

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// ── Fetch + Parse ─────────────────────────────────────────────────────────────

const features: Record<string, boolean> = { ...TIMELINE_FEATURES }

async function fetchOnce(authToken: string, ct0: string, queryId: string, cursor?: string): Promise<Response> {
  const variables = JSON.stringify({
    count: 100,
    includePromotedContent: false,
    ...(cursor ? { cursor } : {}),
  })
  const url = `https://x.com/i/api/graphql/${queryId}/Bookmarks?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(JSON.stringify(features))}`
  return fetch(url, {
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
      Referer: 'https://x.com/i/history',
    },
  })
}

/**
 * Fetch one page of bookmarks. Query IDs are discovered from X's public
 * bundles and refreshed automatically when X rotates them; newly required
 * feature flags are picked up from X's own 400 error and retried.
 */
export async function fetchPage(authToken: string, ct0: string, cursor?: string) {
  let ids = await getXQueryIds()
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetchOnce(authToken, ct0, ids.bookmarks, cursor)
    const text = await res.text()

    if (res.status === 400 && addMissingFeatures(text, features).length > 0) continue
    if ((res.status === 404 || res.status === 400) && attempt === 0) {
      // Likely a rotated query ID — rediscover once
      ids = await getXQueryIds(true)
      continue
    }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 60_000))
      continue
    }
    if (!res.ok) throw new Error(`Twitter API ${res.status}: ${text.slice(0, 300)}`)

    try {
      return JSON.parse(text)
    } catch {
      throw new Error('Twitter returned an invalid response (not JSON)')
    }
  }
  throw new Error('Twitter API: gave up after repeated errors')
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
