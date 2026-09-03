import { NextRequest, NextResponse } from 'next/server'
import { translateBookmark } from '@/lib/translate'

/** POST — translate a bookmark to English (cached). Add ?force=1 to redo. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params
  const force = request.nextUrl.searchParams.get('force') === '1'
  try {
    const translatedText = await translateBookmark(id, force)
    if (!translatedText) return NextResponse.json({ error: 'Nothing to translate or translation failed' }, { status: 422 })
    return NextResponse.json({ translatedText })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Translation failed' }, { status: 500 })
  }
}
