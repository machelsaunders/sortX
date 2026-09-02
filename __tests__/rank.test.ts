import { describe, it, expect } from 'vitest'
import { rrfFuse, dot, topN } from '@/lib/rank'

describe('rrfFuse', () => {
  it('ranks items present in both lists above items in one list', () => {
    const fused = rrfFuse([
      { ids: ['a', 'b', 'c'], label: 'keyword' },
      { ids: ['c', 'd'], label: 'semantic' },
    ])
    expect(fused[0].id).toBe('c')
    expect(fused[0].matchedBy).toEqual(['keyword', 'semantic'])
    expect(fused.map((f) => f.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('respects list weights', () => {
    const fused = rrfFuse([
      { ids: ['a'], label: 'keyword', weight: 0.1 },
      { ids: ['b'], label: 'semantic', weight: 1 },
    ])
    expect(fused[0].id).toBe('b')
  })

  it('handles empty input', () => {
    expect(rrfFuse([])).toEqual([])
    expect(rrfFuse([{ ids: [], label: 'x' }])).toEqual([])
  })
})

describe('vector helpers', () => {
  it('dot product of normalised vectors is cosine similarity', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([Math.SQRT1_2, Math.SQRT1_2])
    expect(dot(a, a)).toBeCloseTo(1)
    expect(dot(a, b)).toBeCloseTo(Math.SQRT1_2)
  })

  it('topN keeps the highest scores', () => {
    const items = [{ score: 0.1 }, { score: 0.9 }, { score: 0.5 }]
    expect(topN(items, 2).map((i) => i.score)).toEqual([0.9, 0.5])
  })
})
