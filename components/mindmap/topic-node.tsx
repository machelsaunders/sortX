'use client'

import { type NodeProps } from '@xyflow/react'
import { topicDiameter } from '@/lib/mindmap-layout'

interface TopicNodeData {
  name: string
  size: number
  color: string
  diameter?: number
  [key: string]: unknown
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** A topic cluster inside a category. Area follows the number of posts; click to see them. */
export default function TopicNode({ data }: NodeProps) {
  const { name, size, color, diameter } = data as TopicNodeData
  const d = diameter ?? topicDiameter(size)
  const fontSize = Math.max(9.5, Math.min(13, d / 10))
  return (
    <div
      className="relative flex flex-col items-center justify-center rounded-full select-none cursor-pointer transition-transform hover:scale-105 active:scale-95 text-center"
      style={{
        width: d,
        height: d,
        background: `radial-gradient(circle at 40% 35%, ${hexToRgba(color, 0.5)}, ${hexToRgba(color, 0.18)} 70%)`,
        border: `1.5px solid ${hexToRgba(color, 0.7)}`,
        boxShadow: `0 0 0 4px ${hexToRgba(color, 0.08)}, 0 6px 24px ${hexToRgba(color, 0.22)}`,
      }}
      title={`${name} · ${size} posts`}
    >
      <span className="font-semibold text-zinc-50 leading-tight px-2" style={{ fontSize, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
        {name}
      </span>
      <span className="text-zinc-200/70 tabular-nums mt-0.5" style={{ fontSize: Math.max(9, fontSize - 2.5) }}>
        {size.toLocaleString()}
      </span>
    </div>
  )
}
