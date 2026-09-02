/**
 * Discovers X's internal GraphQL query IDs from its public JS bundles.
 *
 * X rotates these IDs on every deploy, which is what breaks hardcoded
 * importers. The IDs are embedded in bundles served without authentication
 * from abs.twimg.com, so we can look them up on demand: fetch the x.com HTML,
 * read the chunk-name → hash map, fetch the chunks that contain the
 * operations we care about, and regex the IDs out. Results are cached in the
 * Setting table for a day and refreshed early when a call fails.
 */
import prisma from '@/lib/db'

export interface XQueryIds {
  bookmarks: string
  likes: string | null
  bookmarkFolderTimeline: string | null
  discoveredAt: string
  source: 'discovered' | 'fallback' | 'env'
}

// Last known-good values (checked 2026-09-02). Used only if discovery fails.
export const FALLBACK_IDS = {
  bookmarks: 'iblrFnKr6PZUR-dWpfXG6g',
  likes: 'xA8fDIbrJfy4ojjjXmSR-A',
  bookmarkFolderTimeline: 'U16iHLDthyj_mXaEbCuaaQ',
}

const SETTING_KEY = 'x_query_ids'
const TTL_MS = 24 * 60 * 60 * 1000
const CDN = 'https://abs.twimg.com/responsive-web/client-web/'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

const WANTED = ['Bookmarks', 'Likes', 'BookmarkFolderTimeline'] as const
type Wanted = (typeof WANTED)[number]

/** Pull `queryId:"…",operationName:"X"` pairs out of bundle source. Pure. */
export function extractQueryIds(js: string, wanted: readonly string[] = WANTED): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /queryId:"([A-Za-z0-9_-]{15,30})",operationName:"([A-Za-z]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(js))) {
    if (wanted.includes(m[2]) && !out[m[2]]) out[m[2]] = m[1]
  }
  return out
}

/**
 * From x.com HTML, build the list of bundle URLs worth scanning: main.js plus
 * every chunk whose name mentions History/Bookmarks. Pure.
 */
export function bundleUrlsFromHtml(html: string): string[] {
  const urls = new Set<string>()
  const main = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-f0-9]+\.js/)
  if (main) urls.add(main[0])

  // Chunk map: `12345:"bundle.History"` and, elsewhere, `12345:"<hash>"`
  const names = new Map<string, string>()
  const nameRe = /(\d+):"((?:shared~|bundle\.|ondemand\.)[^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = nameRe.exec(html))) {
    if (/History|Bookmark/.test(m[2])) names.set(m[1], m[2])
  }
  for (const [id, name] of names) {
    const hash = new RegExp(`[^0-9]${id}:"([a-f0-9]{12,})"`).exec(html)?.[1]
    if (hash) urls.add(`${CDN}${name}.${hash}a.js`)
  }
  return Array.from(urls)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
  return res.text()
}

/** Scan X's public bundles. Throws if nothing usable was found. */
export async function discoverQueryIds(): Promise<Partial<Record<Wanted, string>>> {
  const html = await fetchText('https://x.com/i/history')
  const urls = bundleUrlsFromHtml(html)
  if (urls.length === 0) throw new Error('Could not find X bundle URLs in page HTML')

  const found: Partial<Record<Wanted, string>> = {}
  const results = await Promise.allSettled(urls.map(fetchText))
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const [op, id] of Object.entries(extractQueryIds(r.value))) {
      if (!found[op as Wanted]) found[op as Wanted] = id
    }
  }
  if (!found.Bookmarks) throw new Error(`Bookmarks query ID not found in ${urls.length} bundles`)
  return found
}

let inflight: Promise<XQueryIds> | null = null

/**
 * Current query IDs: env override → cached discovery (≤24h) → fresh discovery → fallback.
 * Pass `force` after a 404/400 from X to refresh immediately.
 */
export async function getXQueryIds(force = false): Promise<XQueryIds> {
  if (process.env.X_BOOKMARKS_QUERY_ID) {
    return {
      bookmarks: process.env.X_BOOKMARKS_QUERY_ID,
      likes: process.env.X_LIKES_QUERY_ID ?? FALLBACK_IDS.likes,
      bookmarkFolderTimeline: FALLBACK_IDS.bookmarkFolderTimeline,
      discoveredAt: new Date().toISOString(),
      source: 'env',
    }
  }

  if (!force) {
    const cached = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
    if (cached?.value) {
      try {
        const parsed = JSON.parse(cached.value) as XQueryIds
        if (Date.now() - new Date(parsed.discoveredAt).getTime() < TTL_MS) return parsed
      } catch { /* re-discover */ }
    }
  }

  if (inflight) return inflight
  inflight = (async () => {
    try {
      const found = await discoverQueryIds()
      const ids: XQueryIds = {
        bookmarks: found.Bookmarks!,
        likes: found.Likes ?? FALLBACK_IDS.likes,
        bookmarkFolderTimeline: found.BookmarkFolderTimeline ?? FALLBACK_IDS.bookmarkFolderTimeline,
        discoveredAt: new Date().toISOString(),
        source: 'discovered',
      }
      await prisma.setting.upsert({
        where: { key: SETTING_KEY },
        update: { value: JSON.stringify(ids) },
        create: { key: SETTING_KEY, value: JSON.stringify(ids) },
      })
      return ids
    } catch (err) {
      console.warn('[x-query-ids] discovery failed, using fallback IDs:', err instanceof Error ? err.message : err)
      return { ...FALLBACK_IDS, discoveredAt: new Date().toISOString(), source: 'fallback' as const }
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Feature flags X currently requires on timeline queries. If X adds a new
 * mandatory flag it answers 400 "The following features cannot be null: …";
 * `addMissingFeatures` parses that so callers can retry once.
 */
export const TIMELINE_FEATURES: Record<string, boolean> = {
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
}

export function addMissingFeatures(errorBody: string, features: Record<string, boolean>): string[] {
  const m = errorBody.match(/features cannot be null:\s*([A-Za-z0-9_,\s]+)/)
  if (!m) return []
  const added: string[] = []
  for (const f of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(f in features)) { features[f] = true; added.push(f) }
  }
  return added
}
