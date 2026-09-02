'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search, Sparkles, Loader2, X, AlertCircle, BookMarked, Zap, Database, Filter } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia, SearchResponse } from '@/lib/types'

const EXAMPLES = [
  'memes about AI replacing developers',
  'videos from @karpathy',
  'that thread about pricing pages',
  'most liked crypto charts this year',
  'productivity tips from last month',
  'terminal tools with screenshots',
]

interface IndexStatus {
  enabled: boolean
  modelStatus: 'disabled' | 'unloaded' | 'loading' | 'ready' | 'error'
  modelError: string | null
  indexing: boolean
  done: number
  total: number
  embedded: number
  bookmarks: number
  error: string | null
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function IndexStrip() {
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [starting, setStarting] = useState(false)

  const refresh = useCallback(() => {
    fetch('/api/search/index')
      .then((r) => r.json())
      .then((d: IndexStatus) => setStatus(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [refresh])

  async function build() {
    setStarting(true)
    try {
      await fetch('/api/search/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      refresh()
    } finally {
      setStarting(false)
    }
  }

  if (!status || !status.enabled || status.bookmarks === 0) return null

  const missing = status.bookmarks - status.embedded
  const covered = status.bookmarks > 0 ? Math.round((status.embedded / status.bookmarks) * 100) : 0

  if (status.indexing) {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-400">
        <Loader2 size={13} className="animate-spin text-indigo-400 shrink-0" />
        <span className="flex-1">
          Building semantic index — {status.done.toLocaleString()} / {status.total.toLocaleString()} posts
        </span>
      </div>
    )
  }

  if (status.modelStatus === 'error') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300">
        <AlertCircle size={13} className="shrink-0" />
        <span className="flex-1 truncate">Semantic model unavailable — keyword search still works. {status.modelError}</span>
      </div>
    )
  }

  if (missing <= 0) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-400">
      <Database size={13} className="text-zinc-500 shrink-0" />
      <span className="flex-1">
        Semantic index covers <span className="text-zinc-200 font-medium">{covered}%</span> of your posts
        <span className="text-zinc-600"> · {missing.toLocaleString()} still keyword-only</span>
      </span>
      <button
        onClick={() => void build()}
        disabled={starting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium transition-colors shrink-0"
      >
        {starting ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
        Index now
      </button>
    </div>
  )
}

function SearchPageInner() {
  const searchParams = useSearchParams()
  const initialQ = searchParams.get('q') ?? ''
  const [query, setQuery] = useState(initialQ)
  const debouncedQuery = useDebounced(query, 220)
  const [instant, setInstant] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [ai, setAi] = useState<SearchResponse | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Keep the URL shareable without adding history entries on every keystroke
  useEffect(() => {
    const url = debouncedQuery ? `/search?q=${encodeURIComponent(debouncedQuery)}` : '/search'
    window.history.replaceState(null, '', url)
  }, [debouncedQuery])

  useEffect(() => {
    const q = debouncedQuery.trim()
    setAi(null)
    if (!q) {
      setInstant(null)
      setLoading(false)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    setError('')
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=40&typing=1`)
      .then(async (r) => {
        const data = (await r.json()) as SearchResponse & { error?: string }
        if (!r.ok) throw new Error(data.error ?? 'Search failed')
        if (id === requestId.current) setInstant(data)
      })
      .catch((e) => {
        if (id === requestId.current) setError(e instanceof Error ? e.message : 'Search failed')
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false)
      })
  }, [debouncedQuery])

  const askAi = useCallback(async () => {
    const q = query.trim()
    if (!q || aiLoading) return
    setAiLoading(true)
    setError('')
    try {
      const res = await fetch('/api/search/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const data = (await res.json()) as SearchResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'AI search failed')
      setAi(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI search failed')
    } finally {
      setAiLoading(false)
    }
  }, [query, aiLoading])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void askAi()
    }
    if (e.key === 'Escape') {
      setQuery('')
      setInstant(null)
      setAi(null)
    }
  }

  const showing = ai ?? instant
  const results = showing?.bookmarks ?? []
  const hasQuery = query.trim().length > 0

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 tracking-tight">Search</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Describe what you remember. Try an author, a time (&ldquo;last month&rdquo;), or a type (&ldquo;videos&rdquo;).
        </p>
      </div>

      {/* Search box */}
      <div className="relative mb-3">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. that thread about pricing pages from last month"
          autoComplete="off"
          spellCheck={false}
          className="w-full pl-12 pr-28 sm:pr-44 py-4 rounded-2xl bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 text-base focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Clear"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => void askAi()}
            disabled={!hasQuery || aiLoading}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 ${
              ai ? 'bg-indigo-600 text-white' : 'bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white border border-zinc-700 hover:border-indigo-500'
            }`}
            title="Rerank and explain with AI (⌘↵)"
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            <span className="hidden sm:inline">Ask AI</span>
          </button>
        </div>
      </div>

      {/* Understood filters + meta */}
      {showing && hasQuery && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          {showing.parsed.filters.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 text-zinc-500">
              <Filter size={11} />
              {showing.parsed.filters.map((f) => (
                <span key={f} className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">{f}</span>
              ))}
            </span>
          )}
          <span className="text-zinc-600 ml-auto">
            {ai ? `${results.length} AI-picked` : `${showing.total.toLocaleString()} result${showing.total === 1 ? '' : 's'}`}
            {' · '}{showing.tookMs}ms
            {' · '}{showing.usedSemantic ? 'keyword + semantic' : 'keyword'}
            {ai && (
              <button onClick={() => setAi(null)} className="ml-2 text-indigo-400 hover:text-indigo-300">show all matches</button>
            )}
          </span>
        </div>
      )}

      <div className="mb-6">
        <IndexStrip />
      </div>

      {/* AI explanation */}
      {ai && (
        <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl mb-6 text-sm ${
          ai.aiUnavailable ? 'bg-amber-500/5 border border-amber-500/20 text-amber-200' : 'bg-indigo-500/5 border border-indigo-500/20 text-indigo-200'
        }`}>
          <Sparkles size={15} className="shrink-0 mt-0.5" />
          <div>
            <p>{ai.explanation}</p>
            {ai.aiUnavailable && (
              <p className="text-xs mt-1 text-amber-300/70">
                Sign in to Claude CLI or add an API key in <Link href="/settings" className="underline">Settings</Link> to enable AI reranking.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-6">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Examples */}
      {!hasQuery && (
        <div className="mb-8">
          <p className="text-xs text-zinc-600 mb-3 uppercase tracking-wider">Try</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => { setQuery(ex); inputRef.current?.focus() }}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 text-xs transition-all"
              >
                {ex}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-6">
            Results update as you type. Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-mono">⌘↵</kbd> to have AI rerank and explain the matches.
          </p>
        </div>
      )}

      {/* Empty */}
      {hasQuery && !loading && showing && results.length === 0 && !error && (
        <div className="text-center py-16 text-zinc-600">
          <BookMarked size={36} className="mx-auto mb-3 opacity-30" />
          <p>Nothing matched. Try fewer words, or run the AI pipeline so posts have tags and categories.</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="masonry-grid">
          {results.map((b) => (
            <div key={b.id} className="masonry-item">
              {b.aiReason && (
                <div className="flex items-start gap-1.5 mb-2 px-1">
                  <Sparkles size={10} className="text-indigo-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-indigo-300/80 leading-relaxed">{b.aiReason}</span>
                </div>
              )}
              <BookmarkCard bookmark={b as BookmarkWithMedia} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-500 text-sm">Loading…</div>}>
      <SearchPageInner />
    </Suspense>
  )
}
