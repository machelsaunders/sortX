'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowRight } from 'lucide-react'

const HINTS = ['memes about AI', 'videos from @karpathy', 'most liked this year', 'that thread about pricing']

export default function SearchHero() {
  const [q, setQ] = useState('')
  const router = useRouter()

  function go(value: string) {
    const v = value.trim()
    router.push(v ? `/search?q=${encodeURIComponent(v)}` : '/search')
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5">
      <form
        onSubmit={(e) => { e.preventDefault(); go(q) }}
        className="relative"
      >
        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your bookmarks in plain English…"
          className="w-full pl-12 pr-14 py-3.5 rounded-xl bg-zinc-950 border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-base focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          title="Search"
        >
          <ArrowRight size={16} />
        </button>
      </form>
      <div className="flex flex-wrap gap-2 mt-3">
        {HINTS.map((h) => (
          <button
            key={h}
            onClick={() => go(h)}
            className="px-2.5 py-1 rounded-md bg-zinc-800/60 border border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-zinc-200 text-xs transition-all"
          >
            {h}
          </button>
        ))}
      </div>
    </div>
  )
}
