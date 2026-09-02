import { describe, it, expect } from 'vitest'
import { parseBookmarksJson } from '@/lib/parser'

describe('parseBookmarksJson', () => {
  it('parses the bookmarklet/console export format including counts and quoted text', () => {
    const json = JSON.stringify({
      source: 'bookmark',
      bookmarks: [
        {
          id: '1234567890',
          author: 'Andrej',
          handle: '@karpathy',
          timestamp: 'Wed Aug 20 10:00:00 +0000 2025',
          text: 'Tokenizers are underrated',
          media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/x.jpg' }, { type: 'video', url: 'https://video.twimg.com/v.mp4' }],
          hashtags: ['llm'],
          urls: ['https://github.com/karpathy/minbpe'],
          likes: 1200,
          retweets: 300,
          replies: 45,
          views: '98000',
          lang: 'en',
          quoted: { text: 'BPE explained', handle: 'someone' },
        },
      ],
    })
    const [b] = parseBookmarksJson(json)
    expect(b.tweetId).toBe('1234567890')
    expect(b.authorHandle).toBe('karpathy')
    expect(b.authorName).toBe('Andrej')
    expect(b.tweetCreatedAt?.getUTCFullYear()).toBe(2025)
    expect(b.media.map((m) => m.type)).toEqual(['photo', 'video'])
    expect(b.hashtags).toEqual(['llm'])
    expect(b.urls).toEqual(['https://github.com/karpathy/minbpe'])
    expect(b.likeCount).toBe(1200)
    expect(b.retweetCount).toBe(300)
    expect(b.replyCount).toBe(45)
    expect(b.viewCount).toBe(98000)
    expect(b.lang).toBe('en')
    expect(b.quotedText).toBe('@someone: BPE explained')
  })

  it('parses a sortX/Siftly re-export and preserves counts', () => {
    const json = JSON.stringify([
      { tweetId: '42', text: 'hello', authorHandle: 'a', authorName: 'A', tweetCreatedAt: '2025-01-01T00:00:00Z', mediaItems: [], likeCount: 7, quotedText: '@b: quoted' },
    ])
    const [b] = parseBookmarksJson(json)
    expect(b.tweetId).toBe('42')
    expect(b.likeCount).toBe(7)
    expect(b.quotedText).toBe('@b: quoted')
  })

  it('parses a raw v1-style tweet array', () => {
    const json = JSON.stringify([
      { id_str: '9', full_text: 'raw', user: { screen_name: 'u', name: 'U' }, favorite_count: 3, quoted_status: { full_text: 'q', user: { screen_name: 'qq' } } },
    ])
    const [b] = parseBookmarksJson(json)
    expect(b.text).toBe('raw')
    expect(b.likeCount).toBe(3)
    expect(b.quotedText).toBe('@qq: q')
  })

  it('rejects empty and invalid input', () => {
    expect(() => parseBookmarksJson('')).toThrow()
    expect(() => parseBookmarksJson('{not json')).toThrow()
    expect(parseBookmarksJson('[]')).toEqual([])
  })
})
