import { NextRequest, NextResponse } from 'next/server'
import { getXQueryIds } from '@/lib/x-query-ids'

function cors(request: NextRequest) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = /^(chrome|moz|safari-web)-extension:\/\//.test(origin) || /^https:\/\/(x|twitter)\.com$/.test(origin) ? origin : '*'
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) })
}

/** GET — X's current GraphQL query IDs (auto-discovered, cached 24h). Add ?refresh=1 to force. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const force = request.nextUrl.searchParams.get('refresh') === '1'
  const ids = await getXQueryIds(force)
  return NextResponse.json(ids, { headers: cors(request) })
}
