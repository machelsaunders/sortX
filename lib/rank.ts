/**
 * Pure ranking helpers shared by hybrid search and the CLI. No I/O.
 */

export interface RankedList {
  /** IDs ordered best-first */
  ids: string[]
  /** Relative weight of this list (default 1) */
  weight?: number
  /** Label recorded on each fused hit so the UI can show why it matched */
  label: string
}

export interface FusedHit {
  id: string
  score: number
  matchedBy: string[]
}

/**
 * Reciprocal Rank Fusion. Combines several ranked ID lists into one ordering
 * without needing comparable scores. k=60 is the standard constant.
 */
export function rrfFuse(lists: RankedList[], k = 60): FusedHit[] {
  const scores = new Map<string, FusedHit>()
  for (const list of lists) {
    const weight = list.weight ?? 1
    list.ids.forEach((id, rank) => {
      const contribution = weight / (k + rank + 1)
      const existing = scores.get(id)
      if (existing) {
        existing.score += contribution
        if (!existing.matchedBy.includes(list.label)) existing.matchedBy.push(list.label)
      } else {
        scores.set(id, { id, score: contribution, matchedBy: [list.label] })
      }
    })
  }
  return Array.from(scores.values()).sort((a, b) => b.score - a.score)
}

/** Cosine similarity of two L2-normalised vectors is just the dot product. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Keep the top-n items by score using a simple partial sort (n is small). */
export function topN<T extends { score: number }>(items: T[], n: number): T[] {
  return items.sort((a, b) => b.score - a.score).slice(0, n)
}
