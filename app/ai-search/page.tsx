import { redirect } from 'next/navigation'

/** The old AI Search page now lives at /search (instant + optional Ask AI). */
export default async function AISearchRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  redirect(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
}
