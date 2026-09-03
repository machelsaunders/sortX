import prisma from '@/lib/db'
import { buildImageContext } from '@/lib/image-context'
import { getCliAvailability, claudePrompt, modelNameToCliAlias } from '@/lib/claude-cli-auth'
import { getCodexCliAvailability, codexPrompt } from '@/lib/codex-cli'
import { getActiveModel, getProvider } from '@/lib/settings'
import { AIClient, resolveAIClient } from '@/lib/ai-client'

const BATCH_SIZE = 20

const DEFAULT_CATEGORIES = [
  {
    name: 'AI & Machine Learning',
    slug: 'ai-resources',
    color: '#8b5cf6',
    description:
      'Artificial intelligence, machine learning, LLMs, ChatGPT, Claude, Gemini, Grok, Midjourney, Sora, AI agents, RAG, fine-tuning, prompts, vector databases, model benchmarks, AI startups, AI safety, multimodal models',
    isAiGenerated: false,
  },
  {
    name: 'Crypto & Web3',
    slug: 'finance-crypto',
    color: '#f59e0b',
    description:
      'Cryptocurrency, Bitcoin, Ethereum, Solana, DeFi protocols, NFTs, on-chain activity, crypto trading, altcoins, airdrops, memecoin, Web3 development, smart contracts, DAOs, Layer 2, Uniswap, pump.fun, wallets, blockchain analytics',
    isAiGenerated: false,
  },
  {
    name: 'Dev Tools & Engineering',
    slug: 'dev-tools',
    color: '#06b6d4',
    description:
      'Software engineering, coding, GitHub, open source, frameworks, APIs, databases, DevOps, CI/CD, terminal tools, debugging, system design, backend, frontend, mobile dev, Rust, Go, TypeScript, Python, Vercel, Supabase, Docker',
    isAiGenerated: false,
  },
  {
    name: 'Finance & Investing',
    slug: 'finance-investing',
    color: '#10b981',
    description:
      'Stock market, equities, options trading, macroeconomics, Federal Reserve, interest rates, hedge funds, venture capital, private equity, earnings reports, portfolio management, real estate investing, commodities, forex, financial charts — NOT crypto',
    isAiGenerated: false,
  },
  {
    name: 'Startups & Business',
    slug: 'startups-business',
    color: '#f97316',
    description:
      'Startups, founders, entrepreneurship, SaaS, product-market fit, fundraising, VC, angel investing, growth hacking, B2B, marketing, sales, revenue, bootstrapping, Y Combinator, acquisition, company building, business strategy',
    isAiGenerated: false,
  },
  {
    name: 'News & Politics',
    slug: 'news',
    color: '#6366f1',
    description:
      'Breaking news, current events, US politics, global politics, geopolitics, government policy, elections, regulation, tech policy, AI regulation, crypto regulation, war and conflict, international relations, journalism, investigative reporting',
    isAiGenerated: false,
  },
  {
    name: 'Design & Product',
    slug: 'design',
    color: '#ec4899',
    description:
      'UI/UX design, product design, visual design, Figma, typography, design systems, motion design, brand identity, user research, product strategy, wireframes, creative tools, color theory, web design, app design',
    isAiGenerated: false,
  },
  {
    name: 'Health & Wellness',
    slug: 'health-wellness',
    color: '#14b8a6',
    description:
      'Fitness, nutrition, longevity, biohacking, sleep, mental health, supplements, workout routines, diet, weight loss, strength training, cognitive performance, stress management, meditation, gut health, lab results, wearables like Whoop and Oura',
    isAiGenerated: false,
  },
  {
    name: 'Security & Privacy',
    slug: 'security-privacy',
    color: '#ef4444',
    description:
      'Cybersecurity, hacking, exploits, vulnerabilities, OPSEC, privacy tools, VPNs, encryption, threat intelligence, social engineering, phishing, malware, zero-days, pen testing, CTF, data breaches, authentication, identity security',
    isAiGenerated: false,
  },
  {
    name: 'Science & Research',
    slug: 'science-research',
    color: '#3b82f6',
    description:
      'Scientific research, papers, discoveries, physics, biology, neuroscience, space exploration, climate, chemistry, medical breakthroughs, academic studies, emerging technology, robotics, quantum computing, energy, materials science',
    isAiGenerated: false,
  },
  {
    name: 'Productivity',
    slug: 'productivity',
    color: '#a855f7',
    description:
      'Productivity systems, time management, habits, focus techniques, note-taking, second brain, deep work, mental models, PKM tools like Obsidian and Notion, life optimization, workflows, automation, delegation',
    isAiGenerated: false,
  },
  {
    name: 'Funny & Memes',
    slug: 'funny-memes',
    color: '#eab308',
    description:
      'Memes, jokes, satire, humor, viral content, relatable posts, shitposts, funny screenshots, comedy threads, parody, ironic takes — content whose primary purpose is to be funny or entertaining',
    isAiGenerated: false,
  },
  {
    name: 'Sports & Football',
    slug: 'sports',
    color: '#22c55e',
    description:
      'Football/soccer (Premier League, Champions League, clubs like Manchester United, Arsenal, Real Madrid, national teams), players, managers, tactics, transfers, match footage and goals, stats and analytics, plus other sports: NBA, NFL, F1, boxing, UFC, tennis, golf, athletics, Olympics',
    isAiGenerated: false,
  },
  {
    name: 'Watches & Style',
    slug: 'watches-style',
    color: '#d4a373',
    description:
      'Watches and horology (Rolex, Patek, AP, Omega, references, movements, wrist shots), menswear and womenswear, tailoring, sneakers, luxury brands and craftsmanship (Brunello Cucinelli, Loro Piana), grooming, personal style, outfit posts',
    isAiGenerated: false,
  },
  {
    name: 'Music & Live Events',
    slug: 'music',
    color: '#f472b6',
    description:
      'Musicians, DJs and producers, concerts, festivals and club nights, album and song releases, live performance clips, hip-hop, electronic, Latin, R&B, music industry news, playlists',
    isAiGenerated: false,
  },
  {
    name: 'Movies & TV',
    slug: 'movies-tv',
    color: '#fb7185',
    description:
      'Films, TV series, streaming shows, anime, actors and directors, trailers, iconic scenes and clips, behind-the-scenes, reviews, cinematography, awards, nostalgia for classic films and shows',
    isAiGenerated: false,
  },
  {
    name: 'Inspiration & Self-improvement',
    slug: 'inspiration',
    color: '#facc15',
    description:
      'Motivational and inspirational posts, mindset, discipline, habits of successful people, life advice, relationships and dating advice, philosophy and stoicism, quotes, confidence, masculinity/femininity takes, personal growth stories',
    isAiGenerated: false,
  },
  {
    name: 'Culture & Society',
    slug: 'culture-society',
    color: '#a3a3a3',
    description:
      'Social and cultural commentary, viral moments and internet culture, relatable observations about everyday life, celebrity and pop-culture news, opinions on society, generational takes, history and nostalgia — content about people and culture that is not primarily a joke',
    isAiGenerated: false,
  },
  {
    name: 'Travel & Food',
    slug: 'travel-food',
    color: '#34d399',
    description:
      'Travel destinations, cities and hotels, flights and points, restaurants, cooking and recipes, food culture, coffee, nightlife, places to visit, vacation footage',
    isAiGenerated: false,
  },
  {
    name: 'Photography & Art',
    slug: 'art-photography',
    color: '#c084fc',
    description:
      'Photography, visual art, illustration, architecture and interiors, aesthetic imagery, cinematic footage and drone shots, museums and exhibitions, creative inspiration where the image itself is the point',
    isAiGenerated: false,
  },
  {
    name: 'Gaming',
    slug: 'gaming',
    color: '#60a5fa',
    description:
      'Video games, consoles and PC gaming, esports, game trailers and clips, game development and studios, retro gaming, gaming culture',
    isAiGenerated: false,
  },
  {
    name: 'General',
    slug: 'general',
    color: '#64748b',
    description: 'Last resort only: content that fits none of the other categories even loosely. Never combine with another category.',
    isAiGenerated: false,
  },
] as const

// Default slugs only used for seeding — all runtime categorization uses DB slugs
const DEFAULT_SLUGS = DEFAULT_CATEGORIES.map((c) => c.slug)

interface BookmarkForCategorization {
  tweetId: string
  text: string
  imageTags?: string
  semanticTags?: string[]
  hashtags?: string[]
  tools?: string[]
}

interface CategoryAssignment {
  category: string
  confidence: number
}

interface CategorizationResult {
  tweetId: string
  assignments: CategoryAssignment[]
}

export async function seedDefaultCategories(): Promise<void> {
  const existing = await prisma.category.findMany({ select: { slug: true } })
  const existingSlugs = new Set(existing.map((c) => c.slug))

  for (const cat of DEFAULT_CATEGORIES) {
    if (existingSlugs.has(cat.slug)) {
      // Sync name, color, and description so renames/updates propagate to existing DBs
      await prisma.category.update({
        where: { slug: cat.slug },
        data: { name: cat.name, color: cat.color, description: cat.description },
      })
    } else {
      await prisma.category.create({ data: { ...cat } })
    }
  }
}

function buildCategorizationPrompt(
  bookmarks: BookmarkForCategorization[],
  categoryDescriptions: Record<string, string>,
  allSlugs: string[],
): string {
  const categoriesList = allSlugs.map(
    (slug) => `- ${slug}: ${categoryDescriptions[slug] ?? slug.replace(/-/g, ' ')}`,
  ).join('\n')

  const tweetData = bookmarks.map((b) => {
    const entry: Record<string, unknown> = { id: b.tweetId, text: b.text.slice(0, 400) }
    const imgCtx = buildImageContext(b.imageTags)
    if (imgCtx) entry.images = imgCtx
    if (b.semanticTags?.length) entry.aiTags = b.semanticTags.slice(0, 20).join(', ')
    if (b.hashtags?.length) entry.hashtags = b.hashtags.slice(0, 10).join(', ')
    if (b.tools?.length) entry.tools = b.tools.join(', ')
    return entry
  })

  return `You are an expert librarian categorizing Twitter/X bookmarks into a personal knowledge base. Your categorizations directly power search and discovery — accuracy is critical.

AVAILABLE CATEGORIES:
${categoriesList}

CATEGORIZATION RULES:
- Assign 1-3 categories per bookmark — only what CLEARLY applies
- Confidence 0.5-1.0: use 0.9+ for obvious fits, 0.6-0.8 for plausible, 0.5 for borderline
- Priority: specific categories beat "general" — only use "general" when truly nothing else fits
- Use ALL signals: tweet text, image analysis, OCR text inside images, hashtags, detected tools, semantic AI tags

SIGNAL WEIGHTING (use all, not just text):
- Image shows financial chart, price action, wallet UI → finance-crypto (even if tweet text is vague)
- Image shows code, terminal, GitHub, a dev tool UI → dev-tools
- Image is clearly a meme format or labeled as humor/satire → funny-memes with high confidence
- Tools field mentions GitHub/Vercel/React/etc → dev-tools likely applies
- aiTags field is pre-computed context — trust it heavily for category signals
- Hashtags like #bitcoin #eth → finance-crypto; #buildinpublic #saas → dev-tools/productivity

AVOID:
- "general" is a LAST RESORT: use it only when no other category fits at 0.5 or above, and never alongside another category. A football clip is sports, a wrist shot is watches-style, a viral clip of everyday life is culture-society, a motivational quote is inspiration — none of these are general
- Non-English posts: categorize by meaning exactly as you would English ones
- Conflating news about AI with AI resources (a news thread about OpenAI is "news", not "ai-resources")
- Assigning categories based only on passing mentions (a dev tweet that mentions a price = dev-tools, not finance)

Return ONLY valid JSON — no markdown, no explanation:
[{
  "tweetId": "123",
  "assignments": [
    {"category": "ai-resources", "confidence": 0.92},
    {"category": "dev-tools", "confidence": 0.71}
  ]
}]

BOOKMARKS:
${JSON.stringify(tweetData, null, 1)}`
}

function parseCategorizationResponse(text: string, validSlugs: Set<string>): CategorizationResult[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('No JSON array found in AI response')

  const parsed: unknown = JSON.parse(jsonMatch[0])
  if (!Array.isArray(parsed)) throw new Error('Claude response is not an array')

  return (parsed as Record<string, unknown>[]).map((item): CategorizationResult => {
    const tweetId = String(item.tweetId ?? '')
    const rawAssignments = Array.isArray(item.assignments) ? item.assignments : []

    let assignments: CategoryAssignment[] = (rawAssignments as Record<string, unknown>[])
      .map((a) => ({
        category: String(a.category ?? ''),
        confidence: typeof a.confidence === 'number' ? Math.min(1, Math.max(0.5, a.confidence)) : 0.8,
      }))
      .filter((a) => validSlugs.has(a.category))
    // "general" is a fallback, never a co-category
    if (assignments.length > 1) assignments = assignments.filter((a) => a.category !== 'general')

    return { tweetId, assignments }
  })
}

export async function categorizeBatch(
  bookmarks: BookmarkForCategorization[],
  client: AIClient | null,
  categoryDescriptions: Record<string, string> = {},
  allSlugs: string[] = DEFAULT_SLUGS,
): Promise<CategorizationResult[]> {
  if (bookmarks.length === 0) return []

  const prompt = buildCategorizationPrompt(bookmarks, categoryDescriptions, allSlugs)
  const provider = await getProvider()
  const model = await getActiveModel()

  // SDK first: one HTTP call, no process spawn, ~1s on Haiku. The CLI path
  // (claude -p / codex exec) is the fallback for setups without SDK auth.
  if (client) {
    try {
      const response = await client.createMessage({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      })
      if (!response.text) throw new Error('No text content in AI response')
      return parseCategorizationResponse(response.text, new Set(allSlugs))
    } catch (err) {
      console.warn('[categorize] SDK call failed, trying CLI:', err instanceof Error ? err.message.slice(0, 160) : err)
    }
  }

  if (provider === 'openai') {
    if (await getCodexCliAvailability()) {
      const result = await codexPrompt(prompt, { timeoutMs: 60_000 })
      if (result.success && result.data) return parseCategorizationResponse(result.data, new Set(allSlugs))
      throw new Error(`Codex CLI failed: ${result.error ?? 'unknown error'}`)
    }
  } else if (await getCliAvailability()) {
    const result = await claudePrompt(prompt, { model: modelNameToCliAlias(model), timeoutMs: 60_000 })
    if (result.success && result.data) return parseCategorizationResponse(result.data, new Set(allSlugs))
    throw new Error(`Claude CLI failed: ${result.error ?? 'unknown error'}`)
  }

  throw new Error('No AI available: add an API key in Settings or sign in to Claude CLI.')
}

export async function writeCategoryResults(
  results: CategorizationResult[],
  options: { replace?: boolean } = {},
): Promise<void> {
  if (results.length === 0) return

  const tweetIds = results.map((r) => r.tweetId).filter(Boolean)
  if (tweetIds.length === 0) return

  // Batch-fetch all categories and bookmarks at once (eliminates N+1 queries)
  const [categories, bookmarks] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true } }),
    prisma.bookmark.findMany({
      where: { tweetId: { in: tweetIds } },
      select: { id: true, tweetId: true },
    }),
  ])

  const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]))
  const bookmarkByTweetId = new Map(bookmarks.map((b) => [b.tweetId, b.id]))
  const now = new Date()

  // Collect all operations then execute in a single transaction (eliminates sequential await overhead)
  const upsertOps: ReturnType<typeof prisma.bookmarkCategory.upsert>[] = []
  const bookmarkIdsToUpdate: string[] = []

  for (const result of results) {
    if (!result.tweetId || result.assignments.length === 0) continue
    const bookmarkId = bookmarkByTweetId.get(result.tweetId)
    if (!bookmarkId) continue

    for (const { category: slug, confidence } of result.assignments) {
      const categoryId = categoryBySlug.get(slug)
      if (!categoryId) continue
      upsertOps.push(
        prisma.bookmarkCategory.upsert({
          where: { bookmarkId_categoryId: { bookmarkId, categoryId } },
          update: { confidence },
          create: { bookmarkId, categoryId, confidence },
        }),
      )
    }
    bookmarkIdsToUpdate.push(bookmarkId)
  }

  if (upsertOps.length === 0) return

  await prisma.$transaction([
    // Re-categorization: drop the old assignments first so stale ones (e.g. "general") disappear
    ...(options.replace
      ? [prisma.bookmarkCategory.deleteMany({ where: { bookmarkId: { in: bookmarkIdsToUpdate } } })]
      : []),
    ...upsertOps,
    prisma.bookmark.updateMany({
      where: { id: { in: bookmarkIdsToUpdate } },
      data: { enrichedAt: now },
    }),
  ])
}

export function mapBookmarkForCategorization(b: {
  tweetId: string
  text: string
  semanticTags: string | null
  entities: string | null
  mediaItems: { imageTags: string | null }[]
}): BookmarkForCategorization {
  const allImageTags = b.mediaItems
    .map((m) => m.imageTags)
    .filter((t): t is string => t !== null && t !== '')
    .join(' | ')

  let semanticTags: string[] | undefined
  if (b.semanticTags) {
    try { semanticTags = JSON.parse(b.semanticTags) as string[] } catch { /* ignore */ }
  }

  let hashtags: string[] | undefined
  let tools: string[] | undefined
  if (b.entities) {
    try {
      const ent = JSON.parse(b.entities) as { hashtags?: string[]; tools?: string[] }
      hashtags = ent.hashtags
      tools = ent.tools
    } catch { /* ignore */ }
  }

  return {
    tweetId: b.tweetId,
    text: b.text,
    imageTags: allImageTags || undefined,
    semanticTags,
    hashtags,
    tools,
  }
}

export const BOOKMARK_SELECT = {
  id: true,
  tweetId: true,
  text: true,
  semanticTags: true,
  entities: true,
  mediaItems: { select: { imageTags: true } },
} as const

export async function categorizeAll(
  bookmarkIds: string[],
  onProgress?: (done: number, total: number) => void,
  force = false,
  shouldAbort?: () => boolean,
): Promise<void> {
  await seedDefaultCategories()

  // Resolve auth once — avoids re-resolving inside every batch call
  const provider = await getProvider()
  const keyName = provider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey'
  const apiKeySetting = await prisma.setting.findUnique({ where: { key: keyName } })
  let client: AIClient | null = null
  try {
    client = await resolveAIClient({ dbKey: apiKeySetting?.value })
  } catch {
    // CLI might still work — client stays null
  }

  // Load ALL categories (default + custom) for the prompt
  const dbCategories = await prisma.category.findMany({ select: { slug: true, name: true, description: true } })
  const allSlugs = dbCategories.map((c) => c.slug)
  const categoryDescriptions = Object.fromEntries(
    dbCategories.map((c) => [c.slug, c.description?.trim() || c.name]),
  )

  // Get total count for progress reporting (without loading all rows)
  let total = 0
  if (bookmarkIds.length > 0) {
    total = bookmarkIds.length
  } else if (force) {
    total = await prisma.bookmark.count()
  } else {
    total = await prisma.bookmark.count({ where: { enrichedAt: null } })
  }

  let done = 0

  if (bookmarkIds.length > 0) {
    // Specific bookmark IDs — fetch in BATCH_SIZE chunks
    for (let i = 0; i < bookmarkIds.length; i += BATCH_SIZE) {
      if (shouldAbort?.()) break
      const batchIds = bookmarkIds.slice(i, i + BATCH_SIZE)
      const rows = await prisma.bookmark.findMany({
        where: { id: { in: batchIds } },
        select: BOOKMARK_SELECT,
      })
      const batch = rows.map(mapBookmarkForCategorization)
      try {
        const results = await categorizeBatch(batch, client, categoryDescriptions, allSlugs)
        await writeCategoryResults(results)
      } catch (err) {
        console.error(`Error categorizing batch at index ${i}:`, err)
      }
      done = Math.min(i + BATCH_SIZE, total)
      onProgress?.(done, total)
    }
  } else {
    // Cursor-based pagination — never loads all bookmarks into memory
    let cursor: string | undefined
    const where = force ? {} : { enrichedAt: null }

    while (true) {
      if (shouldAbort?.()) break

      const rows = await prisma.bookmark.findMany({
        where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: BOOKMARK_SELECT,
      })

      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id

      const batch = rows.map(mapBookmarkForCategorization)
      try {
        const results = await categorizeBatch(batch, client, categoryDescriptions, allSlugs)
        await writeCategoryResults(results)
      } catch (err) {
        console.error('Error categorizing batch:', err)
      }

      done += rows.length
      onProgress?.(Math.min(done, total), total)

      if (rows.length < BATCH_SIZE) break
    }
  }
}
