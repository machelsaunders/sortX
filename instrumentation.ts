/**
 * Runs once when the Next.js server boots. Restores the scheduled X sync
 * (if configured in Settings) so it survives restarts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startScheduler } = await import('@/lib/x-sync')
  await startScheduler().catch((err) => console.warn('[x-sync] could not start scheduler:', err))
}
