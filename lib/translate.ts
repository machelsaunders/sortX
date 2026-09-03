/**
 * English translations for non-English posts, cached on the bookmark row.
 * Runs batched inside the pipeline and on demand from a card.
 */
import prisma from '@/lib/db'
import { AIClient, resolveAIClient } from '@/lib/ai-client'
import { getActiveModel, getProvider } from '@/lib/settings'
import { upsertFtsRows } from '@/lib/fts'

/** X language codes that mean "no language" or already English */
const SKIP_LANGS = new Set(['en', 'und', 'zxx', 'qme', 'qam', 'qht', 'qst', 'qct', 'art', 'in'])

export const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish', fr: 'French', pt: 'Portuguese', ja: 'Japanese', de: 'German', it: 'Italian',
  ar: 'Arabic', ru: 'Russian', ko: 'Korean', zh: 'Chinese', tr: 'Turkish', hi: 'Hindi',
  id: 'Indonesian', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', th: 'Thai', vi: 'Vietnamese',
  uk: 'Ukrainian', fa: 'Persian', he: 'Hebrew', el: 'Greek', cs: 'Czech', ro: 'Romanian',
  da: 'Danish', fi: 'Finnish', no: 'Norwegian', hu: 'Hungarian', tl: 'Filipino', ca: 'Catalan',
}

export function needsTranslation(lang: string | null | undefined, text: string): boolean {
  if (!lang || SKIP_LANGS.has(lang)) return false
  // Posts that are only a link/emoji have nothing to translate
  return text.replace(/https?:\/\/\S+/g, '').replace(/[\s\p{Emoji}\p{P}]/gu, '').length >= 3
}

export interface TranslatableRow {
  id: string
  text: string
  lang: string | null
}

async function getClient(): Promise<AIClient> {
  const provider = await getProvider()
  const keyName = provider === 'openai' ? 'openaiApiKey' : provider === 'minimax' ? 'minimaxApiKey' : 'anthropicApiKey'
  const setting = await prisma.setting.findUnique({ where: { key: keyName } })
  return resolveAIClient({ dbKey: setting?.value })
}

/** One model call for up to ~20 posts. Returns id → English text. */
export async function translateBatch(rows: TranslatableRow[], client: AIClient): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (rows.length === 0) return out
  const model = await getActiveModel()
  const items = rows.map((r) => ({ id: r.id, lang: r.lang, text: r.text.slice(0, 2000) }))
  const prompt = `Translate each social-media post below into natural, fluent English.
Rules: keep @handles, #hashtags, URLs, numbers and emoji as they are; keep the tone (casual stays casual); no commentary, no notes.
Return ONLY a JSON array: [{"id":"...","en":"..."}]

POSTS:
${JSON.stringify(items, null, 1)}`

  const response = await client.createMessage({ model, max_tokens: 8192, messages: [{ role: 'user', content: prompt }] })
  const match = response.text.match(/\[[\s\S]*\]/)
  if (!match) return out
  let parsed: unknown
  try { parsed = JSON.parse(match[0]) } catch { return out }
  if (!Array.isArray(parsed)) return out
  for (const item of parsed as { id?: unknown; en?: unknown }[]) {
    if (typeof item?.id === 'string' && typeof item?.en === 'string' && item.en.trim()) out.set(item.id, item.en.trim())
  }
  return out
}

/** Translate and store the given rows (skips ones that don't need it). Returns how many were stored. */
export async function translateAndStore(rows: TranslatableRow[], client?: AIClient | null): Promise<number> {
  const todo = rows.filter((r) => needsTranslation(r.lang, r.text))
  if (todo.length === 0) return 0
  const ai = client ?? (await getClient())
  let stored = 0
  const BATCH = 20
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    let translations: Map<string, string>
    try {
      translations = await translateBatch(batch, ai)
    } catch (err) {
      console.warn('[translate] batch failed:', err instanceof Error ? err.message : err)
      continue
    }
    const updates = batch.filter((r) => translations.has(r.id))
    if (updates.length === 0) continue
    await prisma.$transaction(
      updates.map((r) => prisma.bookmark.update({ where: { id: r.id }, data: { translatedText: translations.get(r.id)! } })),
    )
    await upsertFtsRows(updates.map((r) => r.id)).catch(() => {})
    stored += updates.length
  }
  return stored
}

/** Translate one bookmark on demand (cached). */
export async function translateBookmark(id: string, force = false): Promise<string | null> {
  const b = await prisma.bookmark.findUnique({ where: { id }, select: { id: true, text: true, lang: true, translatedText: true } })
  if (!b) return null
  if (b.translatedText && !force) return b.translatedText
  const client = await getClient()
  const translations = await translateBatch([{ id: b.id, text: b.text, lang: b.lang }], client)
  const en = translations.get(b.id)
  if (!en) return null
  await prisma.bookmark.update({ where: { id: b.id }, data: { translatedText: en } })
  await upsertFtsRows([b.id]).catch(() => {})
  return en
}
