/**
 * Pure conversion of X/Twitter GraphQL `TweetResult` objects (what the
 * bookmarklet, the cookie sync, and the live import all receive) into the
 * app's ParsedBookmark shape. No database access here so it is testable.
 */
import type { ParsedBookmark, ParsedMedia } from '@/lib/parser'

interface MediaVariant {
  content_type?: string
  bitrate?: number
  url?: string
}

interface MediaEntity {
  type?: string
  media_url_https?: string
  video_info?: { variants?: MediaVariant[] }
}

interface TweetLegacy {
  full_text?: string
  text?: string
  created_at?: string
  favorite_count?: number
  retweet_count?: number
  reply_count?: number
  quote_count?: number
  lang?: string
  entities?: { hashtags?: unknown[]; urls?: unknown[]; media?: MediaEntity[]; user_mentions?: unknown[] }
  extended_entities?: { media?: MediaEntity[] }
  quoted_status_id_str?: string
}

interface UserLegacy {
  screen_name?: string
  name?: string
}

interface ArticleBlock {
  text?: string
  type?: string
}

interface ArticleResult {
  title?: string
  preview_image?: { url?: string }
  cover_media?: { media_info?: { original_img_url?: string } }
  content?: string
  content_state?: { blocks?: ArticleBlock[] }
}

export interface TweetResult {
  __typename?: string
  rest_id?: string
  legacy?: TweetLegacy
  core?: { user_results?: { result?: { legacy?: UserLegacy; core?: { screen_name?: string; name?: string } } } }
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } }
  article?: { article_results?: { result?: ArticleResult } }
  views?: { count?: string | number }
  quoted_status_result?: { result?: TweetResult }
  tweet?: TweetResult
}

export function unwrapTweet(t: TweetResult | undefined | null): TweetResult | null {
  if (!t) return null
  if ((t.__typename === 'TweetWithVisibilityResults' || t.__typename === 'TweetWithVisibilityResult') && t.tweet) {
    return t.tweet
  }
  return t
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

function articleBlocksText(article: ArticleResult): string {
  const blocks = article.content_state?.blocks ?? []
  return blocks
    .map((b) => (b.text ?? '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n\n')
}

/** Longest available text: long-form note, article, or the plain tweet. */
export function tweetFullText(tweet: TweetResult): string {
  if (tweet.note_tweet?.note_tweet_results?.result?.text) {
    return decodeHtmlEntities(tweet.note_tweet.note_tweet_results.result.text)
  }
  const article = tweet.article?.article_results?.result
  if (article) {
    const parts: string[] = []
    if (article.title) parts.push(article.title)
    if (article.content) parts.push(article.content)
    if (parts.length === 0) {
      const blocks = articleBlocksText(article)
      if (blocks) parts.push(blocks)
    }
    if (parts.length > 0) return decodeHtmlEntities(parts.join('\n\n'))
  }
  return decodeHtmlEntities(tweet.legacy?.full_text ?? tweet.legacy?.text ?? '')
}

function bestVideoUrl(variants: MediaVariant[]): string | null {
  const mp4 = variants
    .filter((v) => v.content_type === 'video/mp4' && v.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
  return mp4[0]?.url ?? null
}

export function extractMedia(tweet: TweetResult): ParsedMedia[] {
  const entities = tweet.legacy?.extended_entities?.media ?? tweet.legacy?.entities?.media ?? []
  const results: ParsedMedia[] = []
  for (const m of entities) {
    const thumb = m.media_url_https ?? ''
    if (m.type === 'video' || m.type === 'animated_gif') {
      const url = bestVideoUrl(m.video_info?.variants ?? []) ?? thumb
      if (!url) continue
      results.push({ type: m.type === 'animated_gif' ? 'gif' : 'video', url, thumbnailUrl: thumb || undefined })
      continue
    }
    if (!thumb) continue
    results.push({ type: 'photo', url: thumb, thumbnailUrl: thumb })
  }

  if (results.length === 0) {
    const article = tweet.article?.article_results?.result
    const coverUrl = article?.cover_media?.media_info?.original_img_url ?? article?.preview_image?.url
    if (coverUrl) results.push({ type: 'photo', url: coverUrl, thumbnailUrl: coverUrl })
  }
  return results
}

function authorOf(tweet: TweetResult): { handle: string; name: string } {
  const result = tweet.core?.user_results?.result
  const legacy = result?.legacy ?? {}
  // Newer payloads moved screen_name/name under `core`
  const core = result?.core ?? {}
  return {
    handle: legacy.screen_name ?? core.screen_name ?? 'unknown',
    name: legacy.name ?? core.name ?? legacy.screen_name ?? core.screen_name ?? 'Unknown',
  }
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10)
  return null
}

/** "@handle: quoted text" for a quote tweet, else null. */
export function quotedTextOf(tweet: TweetResult): string | null {
  const quoted = unwrapTweet(tweet.quoted_status_result?.result)
  if (!quoted) return null
  const text = tweetFullText(quoted).trim()
  if (!text) return null
  const { handle } = authorOf(quoted)
  return handle && handle !== 'unknown' ? `@${handle}: ${text}` : text
}

export function tweetResultToParsed(input: TweetResult): ParsedBookmark | null {
  const tweet = unwrapTweet(input)
  if (!tweet?.rest_id) return null
  const legacy = tweet.legacy ?? {}
  const { handle, name } = authorOf(tweet)

  let tweetCreatedAt: Date | null = null
  if (legacy.created_at) {
    const d = new Date(legacy.created_at)
    if (!isNaN(d.getTime())) tweetCreatedAt = d
  }

  const hashtags = ((legacy.entities?.hashtags ?? []) as { text?: string }[])
    .map((h) => h.text ?? '')
    .filter(Boolean)
  const urls = ((legacy.entities?.urls ?? []) as { expanded_url?: string; url?: string }[])
    .map((u) => u.expanded_url ?? u.url ?? '')
    .filter(Boolean)

  return {
    tweetId: tweet.rest_id,
    text: tweetFullText(tweet),
    authorHandle: handle,
    authorName: name,
    tweetCreatedAt,
    hashtags,
    urls,
    media: extractMedia(tweet),
    quotedText: quotedTextOf(tweet),
    likeCount: toInt(legacy.favorite_count),
    retweetCount: toInt(legacy.retweet_count),
    replyCount: toInt(legacy.reply_count),
    viewCount: toInt(tweet.views?.count),
    lang: typeof legacy.lang === 'string' ? legacy.lang : null,
    rawJson: JSON.stringify(tweet),
  }
}
