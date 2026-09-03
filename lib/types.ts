export interface MediaItem {
  id: string
  type: string
  url: string
  thumbnailUrl: string | null
  imageTags?: string | null
}

export interface BookmarkCategory {
  id: string
  name: string
  slug: string
  color: string
  confidence: number | null
}

export interface BookmarkWithMedia {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  source?: string
  tweetCreatedAt: string | null
  importedAt?: string
  quotedText?: string | null
  likeCount?: number | null
  retweetCount?: number | null
  replyCount?: number | null
  viewCount?: number | null
  lang?: string | null
  translatedText?: string | null
  mediaItems: MediaItem[]
  categories: BookmarkCategory[]
}

export type MatchSource = 'keyword' | 'semantic' | 'filter'

/** A bookmark returned by hybrid search, with ranking metadata. */
export interface SearchHit extends BookmarkWithMedia {
  score: number
  matchedBy: MatchSource[]
  /** Set by the "Ask AI" rerank */
  aiReason?: string
  aiScore?: number
}

export interface ParsedQueryInfo {
  terms: string
  author?: string
  since?: string | null
  until?: string | null
  mediaType?: 'photo' | 'video'
  category?: string
  sort?: 'newest' | 'oldest' | 'popular'
  filters: string[]
}

export interface SearchResponse {
  bookmarks: SearchHit[]
  total: number
  parsed: ParsedQueryInfo
  usedSemantic: boolean
  tookMs: number
  explanation?: string
  aiUnavailable?: boolean
}

export interface Category {
  id: string
  name: string
  slug: string
  color: string
  description: string | null
  isAiGenerated: boolean
  createdAt: string
  bookmarkCount: number
}

export interface StatsResponse {
  totalBookmarks: number
  totalCategories: number
  totalMedia: number
  recentBookmarks: BookmarkWithMedia[]
  topCategories: { name: string; slug: string; color: string; count: number }[]
}

export interface BookmarksResponse {
  bookmarks: BookmarkWithMedia[]
  total: number
  page: number
  limit: number
}
