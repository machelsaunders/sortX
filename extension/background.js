// sortX Sync — service worker.
// Fetches your X bookmarks with your logged-in session (no cookies to copy)
// and posts them to your local sortX. Runs on an alarm and on demand.

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
const DEFAULTS = { sortxUrl: 'http://localhost:3000', intervalMin: 60, likes: false }
const FEATURES = {
  graphql_timeline_v2_bookmark_timeline: true, responsive_web_graphql_exclude_directive_enabled: true, verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true, responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false, tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true, graphql_is_translatable_rweb_tweet_is_translatable_enabled: true, view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true, responsive_web_twitter_article_tweet_consumption_enabled: true, tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true, standardized_nudges_misinfo: true, tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true, longform_notetweets_inline_media_enabled: true, responsive_web_enhance_cards_enabled: false,
}

async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS)
  return { ...DEFAULTS, ...s }
}

async function setStatus(patch) {
  const { status = {} } = await chrome.storage.local.get('status')
  await chrome.storage.local.set({ status: { ...status, ...patch, updatedAt: Date.now() } })
}

async function scheduleAlarm() {
  const { intervalMin } = await getSettings()
  await chrome.alarms.clear('sortx-sync')
  if (intervalMin > 0) chrome.alarms.create('sortx-sync', { periodInMinutes: intervalMin, delayInMinutes: 1 })
}

chrome.runtime.onInstalled.addListener(scheduleAlarm)
chrome.runtime.onStartup.addListener(scheduleAlarm)
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'sortx-sync') void runSync({ full: false }) })
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'sync') { runSync({ full: !!msg.full }).then(reply).catch((e) => reply({ error: String(e) })); return true }
  if (msg?.type === 'reschedule') { scheduleAlarm().then(() => reply({ ok: true })); return true }
  return false
})

function unwrap(t) { return t && (t.__typename === 'TweetWithVisibilityResults' || t.__typename === 'TweetWithVisibilityResult') && t.tweet ? t.tweet : t }

function parsePage(d, likes) {
  const root = likes ? d?.data?.user?.result?.timeline_v2 : d?.data?.bookmark_timeline_v2
  const ins = root?.timeline?.instructions ?? []
  const tweets = []; let cursor = null
  for (const i of ins) {
    for (const e of i.entries ?? []) {
      const c = e.content ?? {}
      if (c.entryType === 'TimelineTimelineItem') { const t = unwrap(c.itemContent?.tweet_results?.result); if (t?.rest_id) tweets.push(t) }
      else if (c.entryType === 'TimelineTimelineModule') { for (const it of c.items ?? []) { const t = unwrap(it.item?.itemContent?.tweet_results?.result); if (t?.rest_id) tweets.push(t) } }
      else if (c.entryType === 'TimelineTimelineCursor' && c.cursorType === 'Bottom') cursor = c.value ?? null
    }
  }
  return { tweets, cursor }
}

let running = false
async function runSync({ full }) {
  if (running) return { skipped: true, reason: 'already running' }
  running = true
  const started = Date.now()
  let imported = 0, skipped = 0, pages = 0
  try {
    const { sortxUrl, likes } = await getSettings()
    const base = sortxUrl.replace(/\/$/, '')
    await setStatus({ state: 'running', error: null })

    const ct0 = (await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' }))?.value
    if (!ct0) throw new Error('Not logged in to X in this browser')
    const twid = (await chrome.cookies.get({ url: 'https://x.com', name: 'twid' }))?.value
    const userId = twid ? decodeURIComponent(twid).replace(/^u=/, '') : null

    const idsRes = await fetch(`${base}/api/import/x-ids`)
    if (!idsRes.ok) throw new Error(`sortX not reachable at ${base}`)
    const ids = await idsRes.json()
    const queryId = likes ? ids.likes : ids.bookmarks
    const op = likes ? 'Likes' : 'Bookmarks'
    if (!queryId) throw new Error('No query id for ' + op)
    const features = { ...FEATURES }
    const sessionId = 'ext' + Date.now().toString(36)

    let cursor = null, knownPages = 0
    const seen = new Set()
    for (pages = 0; pages < 600; pages++) {
      const vars = likes
        ? { userId, count: 100, includePromotedContent: false, withClientEventToken: false, withBirdwatchNotes: false, withVoice: true, withV2Timeline: true }
        : { count: 100, includePromotedContent: false }
      if (cursor) vars.cursor = cursor
      const url = `https://x.com/i/api/graphql/${queryId}/${op}?variables=${encodeURIComponent(JSON.stringify(vars))}&features=${encodeURIComponent(JSON.stringify(features))}`
      let res = await fetch(url, { credentials: 'include', headers: { authorization: 'Bearer ' + BEARER, 'x-csrf-token': ct0, 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes', 'content-type': 'application/json' } })
      let text = await res.text()
      if (res.status === 400) {
        const m = text.match(/features cannot be null:\s*([A-Za-z0-9_,\s]+)/)
        if (m) { for (const f of m[1].split(',')) features[f.trim()] = true; pages--; continue }
      }
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 60000)); pages--; continue }
      if (!res.ok) throw new Error(`X returned ${res.status}`)
      const { tweets, cursor: next } = parsePage(JSON.parse(text), likes)
      const fresh = tweets.filter((t) => !seen.has(t.rest_id) && seen.add(t.rest_id))
      if (fresh.length) {
        const r = await fetch(`${base}/api/import/bookmarklet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tweets: fresh, source: likes ? 'like' : 'bookmark', sessionId }) })
        if (!r.ok) throw new Error(`sortX rejected batch (${r.status})`)
        const j = await r.json()
        imported += j.imported || 0; skipped += j.skipped || 0
        // Newest first: once two consecutive pages are all known, we have caught up
        if (!full) { if ((j.imported || 0) === 0) { knownPages++; if (knownPages >= 2) break } else knownPages = 0 }
      }
      await setStatus({ state: 'running', imported, skipped, pages: pages + 1 })
      if (!next || tweets.length === 0) break
      cursor = next
    }
    await fetch(`${base}/api/import/bookmarklet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tweets: [], source: likes ? 'like' : 'bookmark', sessionId, done: true, total: imported + skipped }) }).catch(() => {})
    if (imported > 0) fetch(`${base}/api/categorize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
    await setStatus({ state: 'idle', imported, skipped, pages, lastSync: Date.now(), error: null, ms: Date.now() - started })
    return { imported, skipped, pages }
  } catch (e) {
    await setStatus({ state: 'error', error: String(e.message || e) })
    return { error: String(e.message || e) }
  } finally {
    running = false
  }
}
