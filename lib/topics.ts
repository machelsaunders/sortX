/**
 * Topic clusters inside a category, computed from the local embeddings.
 * k-means over the category's vectors, then one model call to name the
 * clusters. Cached per category in the Setting table and recomputed when the
 * category's membership changes.
 */
import { createHash } from 'crypto'
import prisma from '@/lib/db'
import { EMBEDDING_MODEL } from '@/lib/embeddings'
import { resolveAIClient } from '@/lib/ai-client'
import { getActiveModel, getProvider } from '@/lib/settings'

export interface Topic {
  index: number
  name: string
  size: number
  ids: string[]
}

export interface CategoryTopics {
  hash: string
  computedAt: string
  topics: Topic[]
}

const MIN_FOR_TOPICS = 30

function fromBuffer(buf: Uint8Array, dim: number): Float32Array {
  const ab = new ArrayBuffer(dim * 4)
  new Uint8Array(ab).set(buf.subarray(0, dim * 4))
  return new Float32Array(ab)
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (let i = 0; i < v.length; i++) n += v[i] * v[i]
  n = Math.sqrt(n) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n
  return out
}

/** Spherical k-means with k-means++ seeding. Vectors must be unit length. Pure. */
export function kmeans(vectors: Float32Array[], k: number, iterations = 15, seed = 42): number[] {
  const n = vectors.length
  if (n === 0) return []
  k = Math.min(k, n)
  let rnd = seed
  const rand = () => { rnd = (rnd * 1664525 + 1013904223) % 4294967296; return rnd / 4294967296 }

  // k-means++ init
  const centroids: Float32Array[] = [vectors[Math.floor(rand() * n)]]
  const dist = new Float64Array(n).fill(Infinity)
  while (centroids.length < k) {
    let total = 0
    for (let i = 0; i < n; i++) {
      const d = 1 - dot(vectors[i], centroids[centroids.length - 1])
      if (d < dist[i]) dist[i] = d
      total += dist[i]
    }
    let r = rand() * total
    let chosen = n - 1
    for (let i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { chosen = i; break } }
    centroids.push(vectors[chosen])
  }

  const assign = new Array<number>(n).fill(0)
  for (let iter = 0; iter < iterations; iter++) {
    let changed = 0
    for (let i = 0; i < n; i++) {
      let best = 0, bestScore = -Infinity
      for (let c = 0; c < centroids.length; c++) {
        const s = dot(vectors[i], centroids[c])
        if (s > bestScore) { bestScore = s; best = c }
      }
      if (assign[i] !== best) { assign[i] = best; changed++ }
    }
    const dim = vectors[0].length
    const sums = centroids.map(() => new Float32Array(dim))
    const counts = new Array<number>(centroids.length).fill(0)
    for (let i = 0; i < n; i++) {
      const v = vectors[i]; const s = sums[assign[i]]
      for (let d = 0; d < dim; d++) s[d] += v[d]
      counts[assign[i]]++
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] > 0) centroids[c] = normalize(sums[c])
    }
    if (changed === 0) break
  }
  return assign
}

function chooseK(n: number): number {
  return Math.max(3, Math.min(12, Math.round(Math.sqrt(n / 4))))
}

function topTags(rows: { semanticTags: string | null }[], limit = 8): string[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    let tags: string[] = []
    try { tags = JSON.parse(r.semanticTags ?? '[]') } catch { /* ignore */ }
    for (const t of new Set(tags.map((x) => String(x).toLowerCase()))) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t)
}

async function nameClusters(clusters: { tags: string[]; samples: string[] }[], categoryName: string): Promise<string[]> {
  const fallback = clusters.map((c) => c.tags.slice(0, 2).map((t) => t.replace(/\b\w/g, (m) => m.toUpperCase())).join(' & ') || 'Misc')
  try {
    const provider = await getProvider()
    const keyName = provider === 'openai' ? 'openaiApiKey' : provider === 'minimax' ? 'minimaxApiKey' : 'anthropicApiKey'
    const setting = await prisma.setting.findUnique({ where: { key: keyName } })
    const client = await resolveAIClient({ dbKey: setting?.value })
    const model = await getActiveModel()
    const prompt = `These are topic clusters found inside the "${categoryName}" section of someone's saved X/Twitter posts. Give each a short, specific name (2-4 words, Title Case) that distinguishes it from the others. No numbering, no quotes.

Return ONLY JSON: [{"i":0,"name":"..."}, ...]

CLUSTERS:
${JSON.stringify(clusters.map((c, i) => ({ i, tags: c.tags, samples: c.samples })), null, 1)}`
    const res = await client.createMessage({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    const m = res.text.match(/\[[\s\S]*\]/)
    if (!m) return fallback
    const parsed = JSON.parse(m[0]) as { i?: number; name?: string }[]
    const names = [...fallback]
    for (const p of parsed) if (typeof p.i === 'number' && typeof p.name === 'string' && p.name.trim() && names[p.i] !== undefined) names[p.i] = p.name.trim().slice(0, 40)
    return names
  } catch (err) {
    console.warn('[topics] naming failed, using tag names:', err instanceof Error ? err.message : err)
    return fallback
  }
}

export async function getCategoryTopics(slug: string, force = false): Promise<CategoryTopics | null> {
  const category = await prisma.category.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!category) return null

  const rows = await prisma.bookmark.findMany({
    where: { categories: { some: { categoryId: category.id } } },
    select: { id: true, text: true, semanticTags: true, embedding: { select: { vector: true, dim: true, model: true } } },
  })
  const withVec = rows.filter((r) => r.embedding && r.embedding.model === EMBEDDING_MODEL)
  if (withVec.length < MIN_FOR_TOPICS) return null

  const hash = createHash('sha1').update(EMBEDDING_MODEL).update(withVec.map((r) => r.id).sort().join(',')).digest('hex')
  const key = `topics_${slug}`
  if (!force) {
    const cached = await prisma.setting.findUnique({ where: { key } })
    if (cached?.value) {
      try {
        const parsed = JSON.parse(cached.value) as CategoryTopics
        if (parsed.hash === hash) return parsed
      } catch { /* recompute */ }
    }
  }

  const vectors = withVec.map((r) => fromBuffer(r.embedding!.vector, r.embedding!.dim))
  const k = chooseK(withVec.length)
  const assign = kmeans(vectors, k)

  const groups: number[][] = Array.from({ length: k }, () => [])
  assign.forEach((c, i) => groups[c].push(i))
  const nonEmpty = groups.filter((g) => g.length > 0)

  const clusterInfo = nonEmpty.map((g) => ({
    tags: topTags(g.map((i) => withVec[i])),
    samples: g.slice(0, 5).map((i) => withVec[i].text.replace(/\s+/g, ' ').slice(0, 120)),
  }))
  const names = await nameClusters(clusterInfo, category.name)

  const topics: Topic[] = nonEmpty
    .map((g, idx) => ({ index: idx, name: names[idx], size: g.length, ids: g.map((i) => withVec[i].id) }))
    .sort((a, b) => b.size - a.size)
    .map((t, idx) => ({ ...t, index: idx }))

  const result: CategoryTopics = { hash, computedAt: new Date().toISOString(), topics }
  await prisma.setting.upsert({ where: { key }, update: { value: JSON.stringify(result) }, create: { key, value: JSON.stringify(result) } })
  return result
}
