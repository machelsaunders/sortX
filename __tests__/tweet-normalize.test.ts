import { describe, it, expect } from 'vitest'
import { tweetResultToParsed, tweetFullText, type TweetResult } from '@/lib/tweet-normalize'

const base: TweetResult = {
  __typename: 'Tweet',
  rest_id: '111',
  legacy: {
    full_text: 'short text &amp; stuff',
    created_at: 'Mon Sep 01 09:00:00 +0000 2025',
    favorite_count: 10,
    retweet_count: 2,
    reply_count: 1,
    lang: 'en',
    entities: { hashtags: [{ text: 'x' }], urls: [{ expanded_url: 'https://example.com' }] },
    extended_entities: {
      media: [
        { type: 'photo', media_url_https: 'https://pbs.twimg.com/a.jpg' },
        { type: 'video', media_url_https: 'https://pbs.twimg.com/thumb.jpg', video_info: { variants: [
          { content_type: 'video/mp4', bitrate: 100, url: 'https://v/low.mp4' },
          { content_type: 'video/mp4', bitrate: 900, url: 'https://v/high.mp4' },
          { content_type: 'application/x-mpegURL', url: 'https://v/playlist.m3u8' },
        ] } },
      ],
    },
  },
  core: { user_results: { result: { legacy: { screen_name: 'someone', name: 'Some One' } } } },
  views: { count: '5000' },
}

describe('tweetResultToParsed', () => {
  it('converts a GraphQL tweet with media, counts, and entities', () => {
    const p = tweetResultToParsed(base)!
    expect(p.tweetId).toBe('111')
    expect(p.text).toBe('short text & stuff')
    expect(p.authorHandle).toBe('someone')
    expect(p.likeCount).toBe(10)
    expect(p.viewCount).toBe(5000)
    expect(p.media).toEqual([
      { type: 'photo', url: 'https://pbs.twimg.com/a.jpg', thumbnailUrl: 'https://pbs.twimg.com/a.jpg' },
      { type: 'video', url: 'https://v/high.mp4', thumbnailUrl: 'https://pbs.twimg.com/thumb.jpg' },
    ])
    expect(p.hashtags).toEqual(['x'])
    expect(p.urls).toEqual(['https://example.com'])
    expect(p.quotedText).toBeNull()
  })

  it('unwraps TweetWithVisibilityResults and captures quoted tweets', () => {
    const wrapped: TweetResult = {
      __typename: 'TweetWithVisibilityResults',
      tweet: {
        ...base,
        rest_id: '222',
        quoted_status_result: {
          result: {
            rest_id: '333',
            legacy: { full_text: 'the quoted one' },
            core: { user_results: { result: { core: { screen_name: 'quoted_user', name: 'Q' } } } },
          },
        },
      },
    }
    const p = tweetResultToParsed(wrapped)!
    expect(p.tweetId).toBe('222')
    expect(p.quotedText).toBe('@quoted_user: the quoted one')
  })

  it('prefers long-form note text and article content over the truncated tweet', () => {
    expect(tweetFullText({ ...base, note_tweet: { note_tweet_results: { result: { text: 'long note' } } } })).toBe('long note')
    expect(tweetFullText({ rest_id: '1', article: { article_results: { result: { title: 'T', content: 'C' } } } })).toBe('T\n\nC')
  })

  it('returns null without an id', () => {
    expect(tweetResultToParsed({ legacy: { full_text: 'x' } })).toBeNull()
  })
})
