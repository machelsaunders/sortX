import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getCategoryTopics } from '@/lib/topics'
import { invalidateCategoryRefs } from '@/lib/hybrid-search'
import { scheduleEmbedding } from '@/lib/embeddings'

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

const PALETTE = ['#f97316', '#84cc16', '#06b6d4', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#3b82f6', '#f43f5e', '#8b5cf6']

/**
 * POST — promote a topic cluster to its own category and move its posts there.
 * Body: { slug: parentCategorySlug, topicIndex: number, name?: string }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { slug?: string; topicIndex?: number; name?: string } = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { slug, topicIndex } = body
  if (!slug || typeof topicIndex !== 'number') {
    return NextResponse.json({ error: 'slug and topicIndex are required' }, { status: 400 })
  }

  const parent = await prisma.category.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!parent) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const topics = await getCategoryTopics(slug)
  const topic = topics?.topics.find((t) => t.index === topicIndex)
  if (!topic) return NextResponse.json({ error: 'Topic not found (it may have been recomputed — reopen the category)' }, { status: 404 })

  const name = (body.name?.trim() || topic.name).slice(0, 60)
  let newSlug = slugify(name)
  if (!newSlug) return NextResponse.json({ error: 'Could not derive a slug from that name' }, { status: 400 })
  if (await prisma.category.findUnique({ where: { slug: newSlug } })) newSlug = `${newSlug}-${Date.now().toString(36).slice(-4)}`
  if (await prisma.category.findUnique({ where: { name } })) {
    return NextResponse.json({ error: `A category named "${name}" already exists` }, { status: 409 })
  }

  // Describe the new category from the posts' most common tags so future categorization understands it
  const rows = await prisma.bookmark.findMany({ where: { id: { in: topic.ids } }, select: { semanticTags: true } })
  const counts = new Map<string, number>()
  for (const r of rows) {
    let tags: string[] = []
    try { tags = JSON.parse(r.semanticTags ?? '[]') } catch { /* ignore */ }
    for (const t of new Set(tags.map(String))) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const topTags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t]) => t)
  const description = `${name} (split from ${parent.name}): ${topTags.join(', ')}`
  const count = await prisma.category.count()
  const color = PALETTE[count % PALETTE.length]

  const category = await prisma.category.create({
    data: { name, slug: newSlug, color, description, isAiGenerated: true },
  })

  await prisma.$transaction([
    prisma.bookmarkCategory.deleteMany({ where: { categoryId: parent.id, bookmarkId: { in: topic.ids } } }),
    ...topic.ids.map((bookmarkId) =>
      prisma.bookmarkCategory.upsert({
        where: { bookmarkId_categoryId: { bookmarkId, categoryId: category.id } },
        update: { confidence: 0.8 },
        create: { bookmarkId, categoryId: category.id, confidence: 0.8 },
      }),
    ),
  ])

  invalidateCategoryRefs()
  scheduleEmbedding(topic.ids) // category names are part of the embedded document

  return NextResponse.json({ category: { id: category.id, name: category.name, slug: category.slug, color: category.color }, moved: topic.ids.length })
}
