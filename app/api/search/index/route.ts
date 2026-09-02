import { NextRequest, NextResponse } from 'next/server'
import { getEmbeddingStatus, runIndex, abortIndex, warmEmbeddingModel } from '@/lib/embeddings'

/** GET — semantic index status */
export async function GET(): Promise<NextResponse> {
  const status = await getEmbeddingStatus()
  return NextResponse.json(status)
}

/** POST — (re)build the semantic index in the background. Body: { force?: boolean } */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let force = false
  try {
    const body = await request.json()
    force = body?.force === true
  } catch { /* empty body */ }

  const status = await getEmbeddingStatus()
  if (!status.enabled) {
    return NextResponse.json({ error: 'Semantic search is disabled (EMBEDDINGS_DISABLED=true)' }, { status: 400 })
  }
  if (status.indexing) {
    return NextResponse.json({ error: 'Indexing is already running' }, { status: 409 })
  }

  warmEmbeddingModel()
  void runIndex(null, force).catch((err) => console.error('[embeddings] index run failed:', err))
  return NextResponse.json({ started: true, total: status.bookmarks })
}

/** DELETE — stop a running index build */
export async function DELETE(): Promise<NextResponse> {
  abortIndex()
  return NextResponse.json({ stopping: true })
}
