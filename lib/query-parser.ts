/**
 * Turns a plain-English search box query into topic terms plus structured
 * filters. Pure and deterministic so it can run on every keystroke and is
 * easy to unit test.
 *
 *   "memes about AI from last month"        → terms "memes AI", since = 1 month ago
 *   "videos from @karpathy about tokenizers" → terms "tokenizers", author karpathy, mediaType video
 *   "most liked crypto charts this year"      → terms "crypto charts", sort popular, since Jan 1
 */

export type SortIntent = 'newest' | 'oldest' | 'popular'

export interface ParsedQuery {
  /** Original query, trimmed */
  raw: string
  /** Topic text with filters and filler removed — what we search for */
  terms: string
  /** Keywords extracted from `terms` for FTS */
  keywords: string[]
  author?: string
  since?: Date
  until?: Date
  mediaType?: 'photo' | 'video'
  /** Category slug */
  category?: string
  sort?: SortIntent
  /** Human-readable labels of the filters that were understood, for chips */
  filters: string[]
}

export interface CategoryRef {
  name: string
  slug: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'of', 'is', 'it', 'about',
  'that', 'with', 'by', 'this', 'my', 'me', 'i', 'something', 'anything', 'some', 'any',
  'show', 'find', 'get', 'use', 'regarding', 'context', 'would', 'could', 'should', 'want',
  'need', 'looking', 'related', 'using', 'used', 'based', 'tweet', 'tweets', 'bookmark',
  'bookmarks', 'post', 'posts', 'one', 'where', 'was', 'were', 'are', 'saw', 'thing',
  'stuff', 'please', 'can', 'you', 'all', 'from', 'like', 'those', 'these', 'what', 'which',
])

/** Conversational filler that carries no topic signal. Order matters: longer phrases first. */
const FILLER_PATTERNS: RegExp[] = [
  /\b(?:can you |could you |please )?(?:show|find|get|give|pull up|search for|search|look up|look for)\s+(?:me\s+)?(?:all\s+|the\s+|some\s+|any\s+)?(?:of\s+)?(?:my\s+)?/gi,
  /\b(?:that|the|a|an)\s+(?:tweet|post|thread|bookmark|one|thing)s?\s+(?:about|on|where|that|which|regarding|re)\b/gi,
  /\b(?:tweets?|posts?|threads?|bookmarks?)\s+(?:about|on|regarding|re)\b/gi,
  /\b(?:something|anything|stuff|things?)\s+(?:about|on|regarding|related to)\b/gi,
  /\bi\s+(?:saved|bookmarked|saw|remember|think)\b/gi,
  /\b(?:related to|regarding|about|on the topic of)\b/gi,
]

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4,
  june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractKeywords(terms: string, max = 12): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms.toLowerCase().replace(/[^a-z0-9#@.+\-\s]/g, ' ').split(/\s+/)) {
    const w = raw.replace(/^[#@.\-]+|[.\-]+$/g, '')
    if (w.length < 2 || STOP_WORDS.has(w) || seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= max) break
  }
  return out
}

export function parseQuery(input: string, categories: CategoryRef[] = [], now: Date = new Date()): ParsedQuery {
  const raw = input.trim()
  let q = ` ${raw} `
  const filters: string[] = []
  const parsed: ParsedQuery = { raw, terms: '', keywords: [], filters }

  // ── Author ────────────────────────────────────────────────────────────────
  q = q.replace(/\b(?:from|by|author):\s*@?([a-z0-9_]{1,15})\b/i, (_, h: string) => {
    parsed.author = h.toLowerCase(); return ' '
  })
  if (!parsed.author) {
    q = q.replace(/\b(?:from|by)\s+@([a-z0-9_]{1,15})\b/i, (_, h: string) => {
      parsed.author = h.toLowerCase(); return ' '
    })
  }
  if (!parsed.author) {
    q = q.replace(/(?:^|\s)@([a-z0-9_]{1,15})\b/i, (_, h: string) => {
      parsed.author = h.toLowerCase(); return ' '
    })
  }
  if (parsed.author) filters.push(`from @${parsed.author}`)

  // ── Media type ────────────────────────────────────────────────────────────
  if (/\b(?:has|with|type):\s*(?:video|videos|vid|clip|clips)\b/i.test(q) || /\b(?:with|has|containing|including)\s+(?:a\s+)?(?:video|videos|clip|clips)\b/i.test(q) || /\b(?:videos?|clips?)\b/i.test(q)) {
    parsed.mediaType = 'video'
    q = q.replace(/\b(?:has|with|type):\s*(?:video|videos|vid|clip|clips)\b/gi, ' ')
         .replace(/\b(?:with|has|containing|including)\s+(?:a\s+)?(?:video|videos|clip|clips)\b/gi, ' ')
         .replace(/\b(?:videos?|clips?)\b/gi, ' ')
    filters.push('videos')
  } else if (/\b(?:has|with|type):\s*(?:image|images|photo|photos|pic|pics|picture|pictures|screenshot|screenshots)\b/i.test(q) || /\b(?:with|has|containing|including)\s+(?:an?\s+)?(?:image|images|photo|photos|pic|pics|picture|pictures|screenshot|screenshots)\b/i.test(q)) {
    parsed.mediaType = 'photo'
    q = q.replace(/\b(?:has|with|type):\s*(?:image|images|photo|photos|pic|pics|picture|pictures|screenshot|screenshots)\b/gi, ' ')
         .replace(/\b(?:with|has|containing|including)\s+(?:an?\s+)?(?:image|images|photo|photos|pic|pics|picture|pictures|screenshot|screenshots)\b/gi, ' ')
    filters.push('images')
  }

  // ── Sort intent ───────────────────────────────────────────────────────────
  if (/\b(?:most (?:liked|popular|viral|retweeted)|top|popular|best|viral)\b/i.test(q)) {
    parsed.sort = 'popular'
    q = q.replace(/\b(?:most (?:liked|popular|viral|retweeted)|popular|viral)\b/gi, ' ').replace(/\b(?:top|best)\s+(?=\S)/gi, ' ')
    filters.push('most liked')
  } else if (/\b(?:oldest|earliest|first)\b/i.test(q)) {
    parsed.sort = 'oldest'
    q = q.replace(/\b(?:oldest|earliest)\b/gi, ' ')
    filters.push('oldest first')
  } else if (/\b(?:latest|newest|most recent|recent|recently)\b/i.test(q)) {
    parsed.sort = 'newest'
    q = q.replace(/\b(?:latest|newest|most recent|recent|recently)\b/gi, ' ')
    filters.push('newest first')
  }

  // ── Time ranges ───────────────────────────────────────────────────────────
  const today = startOfDay(now)
  const setRange = (since: Date | undefined, until: Date | undefined, label: string) => {
    parsed.since = since
    parsed.until = until
    filters.push(label)
  }

  let m: RegExpMatchArray | null
  if ((m = q.match(/\b(?:in the )?(?:last|past|previous)\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(day|week|month|year)s?\b/i))) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
    const n = words[m[1].toLowerCase()] ?? parseInt(m[1], 10)
    const unit = m[2].toLowerCase()
    const since = unit === 'day' ? addDays(today, -n) : unit === 'week' ? addDays(today, -7 * n) : unit === 'month' ? addMonths(today, -n) : addMonths(today, -12 * n)
    setRange(since, undefined, `last ${n} ${unit}${n === 1 ? '' : 's'}`)
    q = q.replace(m[0], ' ')
  } else if ((m = q.match(/\b(?:since|after|from)\s+(20\d{2})\b/i))) {
    setRange(new Date(parseInt(m[1], 10), 0, 1), undefined, `since ${m[1]}`)
    q = q.replace(m[0], ' ')
  } else if ((m = q.match(/\b(?:before|until|up to)\s+(20\d{2})\b/i))) {
    setRange(undefined, new Date(parseInt(m[1], 10), 0, 1), `before ${m[1]}`)
    q = q.replace(m[0], ' ')
  } else if ((m = q.match(/\b(?:in|from|during)?\s*(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(20\d{2})\b/i))) {
    const month = MONTHS[m[1].toLowerCase()]
    const year = parseInt(m[2], 10)
    setRange(new Date(year, month, 1), new Date(year, month + 1, 1), `${m[1]} ${year}`)
    q = q.replace(m[0], ' ')
  } else if ((m = q.match(/\b(?:in|from|during)\s+(20\d{2})\b/i))) {
    const year = parseInt(m[1], 10)
    setRange(new Date(year, 0, 1), new Date(year + 1, 0, 1), `in ${year}`)
    q = q.replace(m[0], ' ')
  } else if (/\btoday\b/i.test(q)) {
    setRange(today, undefined, 'today'); q = q.replace(/\btoday\b/gi, ' ')
  } else if (/\byesterday\b/i.test(q)) {
    setRange(addDays(today, -1), today, 'yesterday'); q = q.replace(/\byesterday\b/gi, ' ')
  } else if (/\bthis week\b/i.test(q)) {
    setRange(addDays(today, -today.getDay()), undefined, 'this week'); q = q.replace(/\bthis week\b/gi, ' ')
  } else if (/\blast week\b/i.test(q)) {
    const start = addDays(today, -today.getDay() - 7)
    setRange(start, addDays(start, 7), 'last week'); q = q.replace(/\blast week\b/gi, ' ')
  } else if (/\bthis month\b/i.test(q)) {
    setRange(new Date(today.getFullYear(), today.getMonth(), 1), undefined, 'this month'); q = q.replace(/\bthis month\b/gi, ' ')
  } else if (/\blast month\b/i.test(q)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    setRange(start, new Date(today.getFullYear(), today.getMonth(), 1), 'last month'); q = q.replace(/\blast month\b/gi, ' ')
  } else if (/\bthis year\b/i.test(q)) {
    setRange(new Date(today.getFullYear(), 0, 1), undefined, 'this year'); q = q.replace(/\bthis year\b/gi, ' ')
  } else if (/\blast year\b/i.test(q)) {
    setRange(new Date(today.getFullYear() - 1, 0, 1), new Date(today.getFullYear(), 0, 1), 'last year'); q = q.replace(/\blast year\b/gi, ' ')
  }

  // ── Category ──────────────────────────────────────────────────────────────
  if ((m = q.match(/\b(?:category|in|cat):\s*([a-z0-9-]+)\b/i))) {
    const slug = m[1].toLowerCase()
    const cat = categories.find((c) => c.slug === slug || c.name.toLowerCase() === slug)
    if (cat) { parsed.category = cat.slug; filters.push(cat.name); q = q.replace(m[0], ' ') }
  }
  if (!parsed.category) {
    // Every phrase a user might call a category by: full name, "and" variant,
    // each half of "A & B", and the slug with hyphens as spaces. Longest first
    // so "AI & Machine Learning" wins over "AI".
    const candidates: { phrase: string; cat: CategoryRef }[] = []
    for (const cat of categories) {
      const name = cat.name.toLowerCase().trim()
      const phrases = new Set<string>([
        name.replace(/\s*&\s*/g, ' & '),
        name.replace(/\s*&\s*/g, ' and '),
        cat.slug.replace(/-/g, ' '),
      ])
      for (const part of name.split(/\s*(?:&|,|\band\b)\s*/)) if (part.length >= 3) phrases.add(part)
      for (const phrase of phrases) candidates.push({ phrase, cat })
    }
    candidates.sort((a, b) => b.phrase.length - a.phrase.length)
    for (const { phrase, cat } of candidates) {
      const re = new RegExp(`\\b(?:in|under|from|within)\\s+(?:the\\s+|my\\s+)?${escapeRegExp(phrase)}(?:\\s+category|\\s+collection|\\s+section)?\\b`, 'i')
      const hit = q.match(re)
      if (hit) { parsed.category = cat.slug; filters.push(cat.name); q = q.replace(hit[0], ' '); break }
    }
  }

  // ── Filler & terms ────────────────────────────────────────────────────────
  for (const re of FILLER_PATTERNS) q = q.replace(re, ' ')
  // Drop prepositions left dangling once a filter phrase was removed ("memes about ai from ▁")
  const DANGLING = /^(?:\s*\b(?:from|in|during|since|about|on|of|by|with|for|the|a|an|and|or)\b)+|(?:\b(?:from|in|during|since|about|on|of|by|with|for|the|a|an|and|or)\b\s*)+$/gi
  let terms = q.replace(/\s+/g, ' ').trim()
  let prev = ''
  while (prev !== terms) { prev = terms; terms = terms.replace(DANGLING, '').trim() }
  terms = terms.replace(/^[\s,.:;-]+|[\s,.:;?!-]+$/g, '').trim()
  parsed.terms = terms
  parsed.keywords = extractKeywords(terms)
  return parsed
}
