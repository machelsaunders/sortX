'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, ArrowLeft , RefreshCw } from 'lucide-react'
import BookmarkCard from '@/components/bookmark-card'
import type { BookmarkWithMedia, Category } from '@/lib/types'

const PAGE_SIZE = 24

interface CategoryPageData {
  category: Category
  bookmarks: BookmarkWithMedia[]
  total: number
}

function Pagination({ page, total, limit, onChange }: {
  page: number
  total: number
  limit: number
  onChange: (p: number) => void
}) {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-3 mt-8">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={16} />
        Previous
      </button>
      <span className="text-sm text-zinc-500">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next
        <ChevronRight size={16} />
      </button>
    </div>
  )
}


interface TopicChip { name: string; size: number; index: number }

function TopicsSection({ slug, onChanged }: { slug: string; onChanged: () => void }) {
  const [topics, setTopics] = useState<TopicChip[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setTopics(null)
    fetch(`/api/mindmap?category=${slug}`)
      .then((r) => r.json())
      .then((d: { mode?: string; nodes?: { type: string; data: TopicChip }[] }) => {
        if (cancelled) return
        if (d.mode !== 'topics') { setTopics([]); return }
        setTopics((d.nodes ?? []).filter((n) => n.type === 'topic').map((n) => n.data))
      })
      .catch(() => { if (!cancelled) setTopics([]) })
    return () => { cancelled = true }
  }, [slug])

  async function promote(t: TopicChip) {
    const name = window.prompt(`Create a category from "${t.name}" (${t.size} posts). Name:`, t.name)
    if (!name) return
    setBusy(t.index)
    try {
      const res = await fetch('/api/categories/from-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, topicIndex: t.index, name }),
      })
      const d = (await res.json()) as { error?: string; moved?: number }
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      onChanged()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not create the category')
    } finally {
      setBusy(null)
    }
  }

  if (topics === null || topics.length === 0) return null

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Topics inside this category</p>
          <p className="text-xs text-zinc-600 mt-0.5">Found from the posts&apos; meaning. Promote one to give it its own category.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {topics.map((t) => (
          <div key={t.index} className="group flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-zinc-800/70 border border-zinc-700/60 text-sm">
            <span className="text-zinc-200">{t.name}</span>
            <span className="text-xs text-zinc-500 tabular-nums">{t.size}</span>
            <button
              onClick={() => void promote(t)}
              disabled={busy !== null}
              title="Make this topic its own category"
              className="ml-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-600/0 text-indigo-400 hover:bg-indigo-600 hover:text-white disabled:opacity-50 transition-colors"
            >
              {busy === t.index ? '…' : 'Make category'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CategoryPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [data, setData] = useState<CategoryPageData | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [recategorizing, setRecategorizing] = useState(false)

  async function handleRecategorize() {
    if (!confirm(`Re-run AI categorization for every post in this category? Their current assignment will be replaced.`)) return
    setRecategorizing(true)
    try {
      const res = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: slug, replaceCategories: true }),
      })
      if (!res.ok && res.status !== 409) {
        const d = (await res.json()) as { error?: string }
        throw new Error(d.error ?? 'Failed to start')
      }
      router.push('/categorize')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start re-categorization')
      setRecategorizing(false)
    }
  }

  const fetchData = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const [catRes, bookmarksRes] = await Promise.all([
        fetch(`/api/categories/${slug}`),
        fetch(`/api/bookmarks?category=${slug}&page=${p}&limit=${PAGE_SIZE}`),
      ])

      if (!catRes.ok) {
        router.push('/categories')
        return
      }

      const catData = await catRes.json()
      const bmData = await bookmarksRes.json()

      setData({
        category: catData.category,
        bookmarks: bmData.bookmarks ?? [],
        total: bmData.total ?? 0,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [slug, router])

  useEffect(() => {
    fetchData(page)
  }, [fetchData, page])

  function handleExport() {
    window.location.href = `/api/export?type=zip&category=${slug}`
  }

  if (loading && !data) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const category = data?.category
  const bookmarks = data?.bookmarks ?? []
  const total = data?.total ?? 0

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <button
        onClick={() => router.push('/categories')}
        className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        <ArrowLeft size={14} />
        All Categories
      </button>

      {category && (
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full shrink-0"
              style={{ backgroundColor: category.color }}
            />
            <div>
              <h1 className="text-2xl font-bold text-zinc-100">{category.name}</h1>
              {category.description && (
                <p className="text-zinc-400 text-sm mt-0.5">{category.description}</p>
              )}
              <p className="text-zinc-500 text-sm mt-1">{total.toLocaleString()} bookmark{total !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void handleRecategorize()}
              disabled={recategorizing}
              title="Re-run AI categorization for these posts (replaces current assignment)"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 text-sm font-medium transition-colors"
            >
              <RefreshCw size={15} className={recategorizing ? 'animate-spin' : ''} />
              Re-categorize
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
            >
              <Download size={15} />
              Export ZIP
            </button>
          </div>
        </div>
      )}

      {category && <TopicsSection slug={slug} onChanged={() => window.location.reload()} />}

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl h-48 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && bookmarks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-xl font-semibold text-zinc-400">No bookmarks in this category</p>
        </div>
      )}

      {!loading && bookmarks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {bookmarks.map((bookmark) => (
            <BookmarkCard key={bookmark.id} bookmark={bookmark} />
          ))}
        </div>
      )}

      <Pagination page={page} total={total} limit={PAGE_SIZE} onChange={setPage} />
    </div>
  )
}
