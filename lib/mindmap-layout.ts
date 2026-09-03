/**
 * Size and layout rules for the mindmap. Pure, shared by the API (initial
 * category positions) and the canvas (topic / post rings).
 *
 * Node area grows with the count it represents (sqrt scale so a 2,000-post
 * category is big but not absurd), and ring layouts give each node an arc
 * proportional to its diameter so big and small nodes never overlap.
 */

export interface Point { x: number; y: number }

export function categoryDiameter(count: number): number {
  if (count <= 0) return 56
  return Math.round(Math.min(210, 64 + 3.4 * Math.sqrt(count)))
}

export function topicDiameter(size: number): number {
  return Math.round(Math.min(170, Math.max(60, 60 + 4.2 * Math.sqrt(Math.max(size, 0)))))
}

/** Posts scale with engagement (log): 44px for nothing, ~88px for a million likes. */
export function tweetDiameter(likes: number | null | undefined): number {
  const l = Math.max(0, likes ?? 0)
  return Math.round(Math.min(88, 44 + 7 * Math.log10(l + 1)))
}

export interface RingOptions {
  /** Centre of the ring (the parent node's centre) */
  center: Point
  gap?: number
  minRadius?: number
}

/**
 * Lay nodes of the given diameters on one ring around `center`. Returns the
 * top-left position of each node (React Flow anchors nodes at the top-left).
 */
export function ringLayout(diameters: number[], options: RingOptions): Point[] {
  const { center, gap = 40, minRadius = 220 } = options
  const n = diameters.length
  if (n === 0) return []
  const perimeter = diameters.reduce((sum, d) => sum + d + gap, 0)
  const radius = Math.max(minRadius, perimeter / (2 * Math.PI))
  let angle = -Math.PI / 2
  return diameters.map((d) => {
    const arc = ((d + gap) / perimeter) * 2 * Math.PI
    const a = angle + arc / 2
    angle += arc
    return {
      x: Math.round(center.x + radius * Math.cos(a) - d / 2),
      y: Math.round(center.y + radius * Math.sin(a) - d / 2),
    }
  })
}

/**
 * Sunflower (golden-angle) spiral for many small nodes around a centre.
 * Spacing adapts to the largest node so big posts don't overlap.
 */
export function spiralLayout(diameters: number[], center: Point, innerRadius: number): Point[] {
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
  const n = diameters.length
  if (n === 0) return []
  const maxD = Math.max(...diameters)
  const spacing = maxD + 22
  // Area needed ≈ n * spacing², so the outer radius grows with sqrt(n)
  const outer = innerRadius + Math.max(spacing * 2, spacing * Math.sqrt(n) * 0.62)
  return diameters.map((d, i) => {
    const t = n > 1 ? (i + 0.5) / n : 0.5
    const r = innerRadius + (outer - innerRadius) * Math.sqrt(t)
    const a = i * GOLDEN_ANGLE
    return {
      x: Math.round(center.x + r * Math.cos(a) - d / 2),
      y: Math.round(center.y + r * Math.sin(a) - d / 2),
    }
  })
}
