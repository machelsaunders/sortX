import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { relatedByVector } from '@/lib/embeddings'
import { BOOKMARK_LIST_SELECT, serializeBookmark } from '@/lib/serialize-bookmark'

/** GET — posts semantically closest to this one (local vectors, no AI call). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '6', 10) || 6, 20)
  const hits = await relatedByVector(id, limit)
  if (hits.length === 0) return NextResponse.json({ bookmarks: [] })
  const rows = await prisma.bookmark.findMany({ where: { id: { in: hits.map((h) => h.id) } }, select: BOOKMARK_LIST_SELECT })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const bookmarks = hits
    .filter((h) => byId.has(h.id))
    .map((h) => ({ ...serializeBookmark(byId.get(h.id)!), score: Number(h.score.toFixed(3)) }))
  return NextResponse.json({ bookmarks })
}
