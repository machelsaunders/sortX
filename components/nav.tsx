'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import ThemeToggle from './theme-toggle'
import {
  LayoutDashboard,
  Upload,
  Search,
  Tag,
  GitBranch,
  Settings,
  ChevronRight,
  Command,
  Bookmark,
  Menu,
  X,
  Sparkles,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/bookmarks', label: 'Browse', icon: Bookmark },
  { href: '/mindmap', label: 'Mindmap', icon: GitBranch },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/settings', label: 'Settings', icon: Settings },
]

function CreditFooter() {
  return (
    <div className="mx-3 mt-auto mb-3 pt-3 border-t border-zinc-800/50">
      <a
        href="https://github.com/viperrcrypto/Siftly"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all"
      >
        <span className="text-[11px]">Built on Siftly by @viperr</span>
      </a>
    </div>
  )
}

interface CategoryItem {
  name: string
  slug: string
  color: string
  bookmarkCount: number
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

interface PipelineStatus {
  status: 'idle' | 'running' | 'stopping'
  stage: string | null
  done: number
  total: number
}

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  vision: 'Analyzing images',
  entities: 'Extracting entities',
  enrichment: 'Generating tags',
  categorize: 'Categorizing',
  parallel: 'Processing in parallel',
  index: 'Indexing for search',
}

function subscribeToStorage(callback: () => void): () => void {
  window.addEventListener('storage', callback)
  window.addEventListener('sortx:storage', callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener('sortx:storage', callback)
  }
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 min-w-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="sortX" className="w-8 h-8 shrink-0" />
      <span className="text-zinc-100 font-bold text-[17px] tracking-tight">
        sort<span style={{ color: '#F5A623' }}>X</span>
      </span>
    </Link>
  )
}

export default function Nav() {
  const pathname = usePathname()
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [showAllCats, setShowAllCats] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Read the persisted preference without a hydration mismatch: the server
  // snapshot is always "open", the client snapshot comes from localStorage.
  const collectionsOpen = useSyncExternalStore(
    subscribeToStorage,
    () => { try { return localStorage.getItem('nav-collections-open') !== 'false' } catch { return true } },
    () => true,
  )
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null)

  function toggleCollections() {
    try { localStorage.setItem('nav-collections-open', String(!collectionsOpen)) } catch { /* ignore */ }
    window.dispatchEvent(new Event('sortx:storage'))
  }

  function openSearch() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
  }

  useEffect(() => {
    function handleCleared() {
      setCategories([])
    }
    window.addEventListener('siftly:cleared', handleCleared)
    return () => window.removeEventListener('siftly:cleared', handleCleared)
  }, [])

  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d: { categories: CategoryItem[] }) => setCategories(d.categories ?? []))
      .catch(() => {})

    function pollPipeline() {
      fetch('/api/categorize')
        .then((r) => r.json())
        .then((d: PipelineStatus) => setPipeline(d))
        .catch(() => {})
    }
    pollPipeline()
    const interval = setInterval(pollPipeline, 3000)
    return () => clearInterval(interval)
  }, [])

  const visibleCats = showAllCats ? categories : categories.slice(0, 8)
  const pipelineRunning = pipeline && (pipeline.status === 'running' || pipeline.status === 'stopping')

  return (
    <>
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 flex items-center gap-2 h-14 px-3 bg-zinc-900/95 backdrop-blur border-b border-zinc-800/60">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <Brand />
        <div className="ml-auto flex items-center gap-1">
          {pipelineRunning && (
            <Link href="/categorize" className="p-2 rounded-lg text-indigo-400" title="AI pipeline running">
              <Sparkles size={16} className="animate-pulse" />
            </Link>
          )}
          <Link href="/search" className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors" aria-label="Search">
            <Search size={18} />
          </Link>
        </div>
      </header>

      {/* Backdrop for the mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar (drawer on mobile, sticky column on desktop) */}
      <aside
        className={`fixed md:sticky inset-y-0 left-0 md:top-0 z-50 md:z-auto flex flex-col bg-zinc-900 border-r border-zinc-800/50 shrink-0 h-screen overflow-y-auto w-[270px] md:w-[228px] transform transition-transform duration-200 md:transform-none ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-zinc-800/50">
          <Brand />
          <div className="shrink-0 flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Pipeline running indicator — hidden on /categorize and /import */}
        {pipelineRunning && pathname !== '/categorize' && pathname !== '/import' && (
          <Link
            href="/categorize"
            className="mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/15 transition-colors"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
            </span>
            <span className="text-[11px] font-medium text-indigo-300 truncate">
              {pipeline!.stage ? (PIPELINE_STAGE_LABELS[pipeline!.stage] ?? pipeline!.stage) : 'AI pipeline'}
              {pipeline!.total > 0 ? ` ${pipeline!.done}/${pipeline!.total}` : '…'}
            </span>
          </Link>
        )}

        {/* Ctrl+K search trigger */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={openSearch}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/40 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 hover:border-zinc-600/60 transition-all text-xs"
          >
            <Search size={12} className="shrink-0" />
            <span className="flex-1 text-left">Quick search…</span>
            <kbd className="flex items-center gap-0.5 text-[10px] text-zinc-600 font-mono">
              <Command size={9} />K
            </kbd>
          </button>
        </div>

        {/* Main nav — any link click closes the mobile drawer */}
        <nav className="flex flex-col gap-px px-2 py-2" onClick={() => setMobileOpen(false)}>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  active
                    ? 'bg-blue-500/12 text-blue-400'
                    : 'text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="mx-3 border-t border-zinc-800/50" />

        {/* Categories */}
        {categories.length > 0 && (
          <div className="px-2 py-3 flex-1 min-h-0 flex flex-col">
            <button
              onClick={toggleCollections}
              className="flex items-center justify-between px-2 mb-2 w-full group"
            >
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">
                Collections
              </p>
              <div className="flex items-center gap-1.5">
                <Link
                  href="/categories"
                  onClick={(e) => e.stopPropagation()}
                  className="text-zinc-700 hover:text-zinc-400 transition-colors p-0.5 rounded"
                  title="Manage categories"
                >
                  <Tag size={11} />
                </Link>
                <ChevronRight
                  size={10}
                  className={`text-zinc-600 transition-transform duration-200 ${collectionsOpen ? 'rotate-90' : ''}`}
                />
              </div>
            </button>

            {collectionsOpen && (
              <>
                <div className="flex flex-col gap-px overflow-y-auto flex-1 min-h-0" onClick={() => setMobileOpen(false)}>
                  {visibleCats.map((cat) => {
                    const catActive = pathname === `/categories/${cat.slug}`
                    return (
                      <Link
                        key={cat.slug}
                        href={`/categories/${cat.slug}`}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px] font-medium transition-all group ${
                          catActive
                            ? 'bg-zinc-800 text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                        }`}
                      >
                        <Bookmark
                          size={12}
                          className="flex-shrink-0 transition-colors"
                          style={{ color: cat.color, fill: cat.color }}
                        />
                        <span className="truncate flex-1">{cat.name}</span>
                        <span className="text-[11px] text-zinc-600 group-hover:text-zinc-500 tabular-nums font-normal">
                          {cat.bookmarkCount}
                        </span>
                      </Link>
                    )
                  })}
                </div>

                {categories.length > 8 && (
                  <button
                    onClick={() => setShowAllCats((v) => !v)}
                    className="flex items-center gap-1.5 px-2 mt-1.5 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    <ChevronRight
                      size={10}
                      className={`transition-transform ${showAllCats ? 'rotate-90' : ''}`}
                    />
                    {showAllCats ? 'Show less' : `${categories.length - 8} more`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <CreditFooter />
      </aside>
    </>
  )
}
