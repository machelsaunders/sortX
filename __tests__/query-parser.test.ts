import { describe, it, expect } from 'vitest'
import { parseQuery, extractKeywords } from '@/lib/query-parser'

const NOW = new Date('2026-09-02T12:00:00')
const CATS = [
  { name: 'Dev Tools & Engineering', slug: 'dev-tools' },
  { name: 'Funny & Memes', slug: 'funny-memes' },
  { name: 'AI & Machine Learning', slug: 'ai-resources' },
]

describe('parseQuery', () => {
  it('extracts an author from from:@handle, by @handle, and bare @handle', () => {
    expect(parseQuery('from:@karpathy tokenizers', CATS, NOW).author).toBe('karpathy')
    expect(parseQuery('tokenizers by @Karpathy', CATS, NOW).author).toBe('karpathy')
    expect(parseQuery('@karpathy tokenizers', CATS, NOW).author).toBe('karpathy')
    expect(parseQuery('from:@karpathy tokenizers', CATS, NOW).terms).toBe('tokenizers')
  })

  it('detects media type intent and removes it from the terms', () => {
    const v = parseQuery('videos about rust', CATS, NOW)
    expect(v.mediaType).toBe('video')
    expect(v.terms).toBe('rust')
    const p = parseQuery('crypto charts with screenshots', CATS, NOW)
    expect(p.mediaType).toBe('photo')
    expect(p.terms).toBe('crypto charts')
  })

  it('understands relative time phrases', () => {
    const lastMonth = parseQuery('memes about ai from last month', CATS, NOW)
    expect(lastMonth.since?.toISOString().slice(0, 10)).toBe('2026-08-01')
    expect(lastMonth.until?.toISOString().slice(0, 10)).toBe('2026-09-01')
    expect(lastMonth.terms).toBe('memes ai')

    const thisYear = parseQuery('most liked crypto charts this year', CATS, NOW)
    expect(thisYear.since?.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(thisYear.until).toBeUndefined()
    expect(thisYear.sort).toBe('popular')
    expect(thisYear.terms).toBe('crypto charts')

    const lastDays = parseQuery('rust in the last 10 days', CATS, NOW)
    expect(lastDays.since?.toISOString().slice(0, 10)).toBe('2026-08-23')

    const year = parseQuery('design systems in 2024', CATS, NOW)
    expect(year.since?.getFullYear()).toBe(2024)
    expect(year.until?.getFullYear()).toBe(2025)

    const month = parseQuery('launches from march 2025', CATS, NOW)
    expect(month.since?.toISOString().slice(0, 10)).toBe('2025-03-01')
    expect(month.until?.toISOString().slice(0, 10)).toBe('2025-04-01')
  })

  it('maps category names and slugs', () => {
    expect(parseQuery('cursor in dev tools', CATS, NOW).category).toBe('dev-tools')
    expect(parseQuery('cursor in the dev tools and engineering category', CATS, NOW).category).toBe('dev-tools')
    expect(parseQuery('category:funny-memes cats', CATS, NOW).category).toBe('funny-memes')
    expect(parseQuery('category:funny-memes cats', CATS, NOW).terms).toBe('cats')
  })

  it('strips conversational filler', () => {
    expect(parseQuery('show me that thread about pricing pages', CATS, NOW).terms).toBe('pricing pages')
    expect(parseQuery('find tweets about react hooks', CATS, NOW).terms).toBe('react hooks')
    expect(parseQuery('something about focus', CATS, NOW).terms).toBe('focus')
  })

  it('reports human-readable filter labels', () => {
    const p = parseQuery('videos from @karpathy last week', CATS, NOW)
    expect(p.filters).toEqual(['from @karpathy', 'videos', 'last week'])
    expect(p.keywords).toEqual([])
  })

  it('keeps short but meaningful keywords', () => {
    expect(extractKeywords('AI KYC c++ rules')).toEqual(['ai', 'kyc', 'c++', 'rules'])
  })
})
