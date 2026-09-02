import { NextRequest, NextResponse } from 'next/server'
import { getXQueryIds } from '@/lib/x-query-ids'

/** GET — X's current GraphQL query IDs (auto-discovered, cached 24h). Add ?refresh=1 to force. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const ids = await getXQueryIds(force)
  return NextResponse.json(ids)
}
