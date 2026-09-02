import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { parseBookmarksJson } from '@/lib/parser'
import { importParsedBookmarks } from '@/lib/import-bookmarks'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

/** JSON file upload (bookmarklet / console export, twitter-web-exporter, or a sortX re-export). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Failed to parse form data' }, { status: 400 })
  }

  const sourceParam = (formData.get('source') as string | null)?.trim()
  const file = formData.get('file')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing required field: file' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 200MB)' }, { status: 413 })
  }

  const filename = file instanceof File ? file.name : 'bookmarks.json'

  let jsonString: string
  try {
    jsonString = await file.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read file content' }, { status: 400 })
  }

  const importJob = await prisma.importJob.create({
    data: { filename, status: 'processing', totalCount: 0, processedCount: 0 },
  })

  let parsedBookmarks
  try {
    parsedBookmarks = parseBookmarksJson(jsonString)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.importJob.update({ where: { id: importJob.id }, data: { status: 'error', errorMessage: message } })
    return NextResponse.json({ error: `Failed to parse bookmarks JSON: ${message}` }, { status: 422 })
  }

  // Source: form param > "source" field inside the JSON > bookmark
  let jsonSource: string | undefined
  try {
    const parsed = JSON.parse(jsonString)
    if (typeof parsed?.source === 'string') jsonSource = parsed.source
  } catch { /* already parsed above */ }
  const source = sourceParam === 'like' || sourceParam === 'bookmark'
    ? sourceParam
    : jsonSource === 'like' ? 'like' : 'bookmark'

  await prisma.importJob.update({ where: { id: importJob.id }, data: { totalCount: parsedBookmarks.length } })

  let result
  try {
    result = await importParsedBookmarks(parsedBookmarks, source, (done) => {
      void prisma.importJob.update({ where: { id: importJob.id }, data: { processedCount: done } }).catch(() => {})
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.importJob.update({ where: { id: importJob.id }, data: { status: 'error', errorMessage: message } })
    return NextResponse.json({ error: `Import failed: ${message}` }, { status: 500 })
  }

  await prisma.importJob.update({
    where: { id: importJob.id },
    data: { status: 'done', processedCount: result.imported },
  })

  return NextResponse.json({
    jobId: importJob.id,
    imported: result.imported,
    skipped: result.skipped,
    parsed: parsedBookmarks.length,
  })
}
