'use client'

import { type NodeProps } from '@xyflow/react'

interface TopicNodeData {
  name: string
  size: number
  color: string
  [key: string]: unknown
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** A topic cluster inside a category: click to see its posts. */
export default function TopicNode({ data }: NodeProps) {
  const { name, size, color } = data as TopicNodeData
  const scale = Math.min(1.35, 0.85 + Math.log10(Math.max(size, 1)) * 0.25)
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl select-none cursor-pointer transition-transform hover:scale-105 active:scale-95 px-3 py-2 text-center"
      style={{
        minWidth: 120 * scale,
        maxWidth: 170,
        background: `linear-gradient(135deg, ${hexToRgba(color, 0.28)}, ${hexToRgba(color, 0.12)})`,
        border: `1px solid ${hexToRgba(color, 0.55)}`,
        boxShadow: `0 4px 20px ${hexToRgba(color, 0.18)}`,
      }}
    >
      <span className="text-[12px] font-semibold text-zinc-100 leading-tight">{name}</span>
      <span className="text-[10px] text-zinc-400 mt-0.5 tabular-nums">{size} posts</span>
    </div>
  )
}
