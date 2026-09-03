/**
 * One place that turns Prisma bookmark rows into the JSON shape the UI uses.
 */
import type { BookmarkWithMedia } from '@/lib/types'

export const BOOKMARK_LIST_SELECT = {
  id: true,
  tweetId: true,
  text: true,
  authorHandle: true,
  authorName: true,
  source: true,
  tweetCreatedAt: true,
  importedAt: true,
  quotedText: true,
  likeCount: true,
  retweetCount: true,
  replyCount: true,
  viewCount: true,
  lang: true,
  translatedText: true,
  mediaItems: { select: { id: true, type: true, url: true, thumbnailUrl: true, imageTags: true } },
  categories: {
    select: {
      confidence: true,
      category: { select: { id: true, name: true, slug: true, color: true } },
    },
    orderBy: { confidence: 'desc' as const },
  },
} as const

export interface BookmarkListRow {
  id: string
  tweetId: string
  text: string
  authorHandle: string
  authorName: string
  source?: string
  tweetCreatedAt: Date | null
  importedAt: Date
  quotedText?: string | null
  likeCount?: number | null
  retweetCount?: number | null
  replyCount?: number | null
  viewCount?: number | null
  lang?: string | null
  translatedText?: string | null
  mediaItems: { id: string; type: string; url: string; thumbnailUrl: string | null; imageTags?: string | null }[]
  categories: { confidence: number; category: { id: string; name: string; slug: string; color: string } }[]
}

export function serializeBookmark(b: BookmarkListRow): BookmarkWithMedia {
  return {
    id: b.id,
    tweetId: b.tweetId,
    text: b.text,
    authorHandle: b.authorHandle,
    authorName: b.authorName,
    source: b.source,
    tweetCreatedAt: b.tweetCreatedAt?.toISOString() ?? null,
    importedAt: b.importedAt.toISOString(),
    quotedText: b.quotedText ?? null,
    likeCount: b.likeCount ?? null,
    retweetCount: b.retweetCount ?? null,
    replyCount: b.replyCount ?? null,
    viewCount: b.viewCount ?? null,
    lang: b.lang ?? null,
    translatedText: b.translatedText ?? null,
    mediaItems: b.mediaItems.map((m) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      thumbnailUrl: m.thumbnailUrl,
      imageTags: m.imageTags ?? null,
    })),
    categories: b.categories.map((bc) => ({
      id: bc.category.id,
      name: bc.category.name,
      slug: bc.category.slug,
      color: bc.category.color,
      confidence: bc.confidence,
    })),
  }
}
