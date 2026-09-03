'use client'

import { type NodeProps } from '@xyflow/react'
import { categoryDiameter } from '@/lib/mindmap-layout'

interface CategoryNodeData {
  name: string
  slug: string
  color: string
  count: number
  description?: string
  [key: string]: unknown
}

interface CategoryNodeProps extends NodeProps {
  onExpand?: (slug: string) => void
}

function darkenColor(hex: string, factor: number): string {
  const clean = hex.replace('#', '')
  const r = Math.round(parseInt(clean.slice(0, 2), 16) * factor)
  const g = Math.round(parseInt(clean.slice(2, 4), 16) * factor)
  const b = Math.round(parseInt(clean.slice(4, 6), 16) * factor)
  return `rgb(${r},${g},${b})`
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export default function CategoryNode({ data }: CategoryNodeProps) {
  const { name, color, count } = data as CategoryNodeData

  const mid = darkenColor(color, 0.75)
  const dark = darkenColor(color, 0.42)
  // Area grows with the number of posts; empty categories are small and translucent
  const isEmpty = count === 0
  const size = (data as { diameter?: number }).diameter ?? categoryDiameter(count)
  const nodeOpacity = isEmpty ? 0.5 : 1
  const nameSize = Math.max(10, Math.min(15, Math.round(size / 11)))
  const countSize = Math.max(9, Math.min(13, Math.round(size / 14)))

  return (
    <div
      className="relative flex flex-col items-center justify-center rounded-full select-none cursor-pointer transition-transform hover:scale-105 active:scale-95"
      style={{ width: size, height: size, opacity: nodeOpacity }}
    >
      {/* Outer pulse ring */}
      <div
        className="absolute inset-0 rounded-full animate-ping"
        style={{
          background: 'transparent',
          border: `1px solid ${hexToRgba(color, 0.22)}`,
          animationDuration: '3.5s',
        }}
      />

      {/* Mid orbit ring */}
      <div
        className="absolute rounded-full"
        style={{
          inset: -6,
          border: `1px solid ${hexToRgba(color, 0.12)}`,
          borderRadius: '50%',
        }}
      />

      {/* Main sphere */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 38% 35%, ${color}, ${mid} 55%, ${dark})`,
          boxShadow: `0 0 0 1.5px ${hexToRgba(color, 0.85)}, 0 0 28px ${hexToRgba(color, 0.45)}, inset 0 1px 0 rgba(255,255,255,0.2)`,
        }}
      />

      {/* Glint highlight */}
      <div
        className="absolute rounded-full"
        style={{
          top: size * 0.12, left: size * 0.16, width: size * 0.25, height: size * 0.11,
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.25) 0%, transparent 70%)',
        }}
      />

      {/* Text */}
      <div className="relative z-10 flex flex-col items-center gap-0.5 px-3">
        <span
          className="text-white font-bold text-center leading-tight"
          style={{ fontSize: nameSize, textShadow: '0 1px 4px rgba(0,0,0,0.65)', letterSpacing: '-0.01em' }}
        >
          {name}
        </span>
        <span
          className="text-white/65 font-medium tabular-nums"
          style={{ fontSize: countSize, textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}
        >
          {count.toLocaleString()}
        </span>
      </div>
    </div>
  )
}
