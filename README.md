<div align="center">
  <img src="public/logo.svg" alt="sortX" width="80" height="80" />

  <h1>sortX</h1>

  <p><strong>Your X/Twitter bookmarks — sorted, categorized, and searchable in plain English.</strong></p>

  <p>Self-hosted · runs on your machine · nothing leaves except the AI calls you choose</p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16" />
    <img src="https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/SQLite-FTS5-green?style=flat-square&logo=sqlite" alt="SQLite" />
    <img src="https://img.shields.io/badge/search-hybrid%20keyword%20%2B%20vectors-6366f1?style=flat-square" alt="Hybrid search" />
    <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="MIT License" />
  </p>
</div>

---

sortX is a fork of [Siftly](https://github.com/viperrcrypto/Siftly) by [@viperr](https://x.com/viperr), rebuilt around one goal: **type what you remember, get the post back.**

```
"that thread about pricing pages from last month"
"videos from @karpathy"
"most liked crypto charts this year"
"memes about AI replacing developers"
```

Each of those is understood, not just keyword-matched: authors, time ranges, media types, categories, and sort intent are parsed out of the sentence, then the remaining topic is searched two ways at once — a BM25 keyword index and a local semantic vector index — and the two rankings are fused. Results appear as you type. Press **⌘↵** to have Claude rerank the best candidates and explain each match.

## What changed from Siftly

| Area | Siftly | sortX |
|---|---|---|
| Search | Keyword LIKE queries, or an AI search that sent ~150 rows to Claude per query | **Hybrid search**: FTS5 + local sentence embeddings (bge-small, on-device, ~35MB), fused with Reciprocal Rank Fusion. Instant, free, works offline. |
| Plain-English filters | — | `from @handle`, `last month`, `in 2024`, `videos`, `with screenshots`, `most liked`, `in dev tools` are understood and shown as chips |
| Ask AI | Rerank 150 loosely selected rows | Rerank the top 40 hybrid candidates, with per-result reasons. Cheaper and more accurate. Falls back gracefully when no AI is configured. |
| Search-as-you-type | Cmd+K did substring matching on tweet text | Cmd+K and the Search page use hybrid search with prefix matching |
| Import speed | One SELECT + one INSERT per bookmark | Bulk dedupe, transactional writes, entities extracted on import, and new posts are indexed for search immediately |
| Import method | Bookmarklet that sniffed network traffic while auto-scrolling; broke when X moved bookmarks to the new History page | **Direct import**: calls X's Bookmarks/Likes API with cursors from inside x.com, auto-discovers X's rotating query IDs, streams to sortX over postMessage |
| Import data | Text, author, media | Also **long-form post text**, **quoted tweets**, like / repost / reply / view counts, language |
| Sorting | Newest / oldest | Plus **most liked**, and filter by author |
| Pipeline | 4 stages | 5 stages — a final indexing stage keeps the search indexes in sync with new tags and categories |
| Mobile | Fixed desktop sidebar | Responsive: top bar + slide-out drawer on phones and tablets |
| Build | `next build` failed on `main` (two type errors) | Builds clean; CLI and tests cover the parser, ranking, and query understanding |
| Models | Dated Claude 4.x IDs | Current IDs (Haiku 4.5, Sonnet 5, Opus 5); old saved values still work |

Everything else Siftly does — the bookmarklet importer, vision analysis, semantic tagging, categorization, mindmap, exports, Obsidian, multi-provider AI — is still here.

## Quick start

Requirements: [Node.js 18+](https://nodejs.org). If you use [Claude Code](https://claude.ai/code) and are signed in, AI features work with no API key.

```bash
git clone https://github.com/machelsaunders/sortX.git
cd sortX
./start.sh
```

That installs dependencies, creates the SQLite database, and opens http://localhost:3000.

Manual equivalent:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npx next dev
```

## Import your bookmarks

Go to **Import** in the app. **Direct import** is the reliable path: it calls X's own bookmarks API from inside your logged-in x.com tab and pages through everything with cursors. No scrolling, no network sniffing, and it copes with X rotating its internal query IDs (sortX looks the current IDs up from X's public JS bundles).

1. On the Import page, drag **Import X Bookmarks → sortX** to your bookmarks bar (or copy the link and add it as a bookmark manually).
2. Click **Open X in a new tab** on the Import page. Opening X from sortX gives the X tab a handle back to sortX.
3. On the X tab, click the bookmarklet. A small sortX panel appears and counts up as it fetches, 100 posts per page.
4. Posts stream into sortX as they arrive. When the panel says Done, sortX starts AI categorization automatically.

Notes:

- x.com's Content Security Policy blocks pages from calling other origins, so the script hands posts to the sortX window with `postMessage` instead of a direct request. If it cannot reach a sortX window it downloads a JSON file you can upload on the Import page.
- Switch the toggle to **Likes** to pull your liked posts the same way.
- Re-running is safe: duplicates are skipped, only new posts are added. Imported posts are keyword-searchable immediately and get semantic vectors in the background within seconds.
- If bookmarklets are blocked in your browser, expand "Run it from the browser console instead" for a paste-able version.

Other paths: upload a JSON export (from the fallback above, an older Siftly export, or twitter-web-exporter), cookie-based scheduled sync (API only: `POST /api/import/live`), and the official X OAuth flow (needs a paid X API tier).

## Search

Open **Search** (or press **⌘K** anywhere). Results update as you type.

What the query parser understands:

| You type | Understood as |
|---|---|
| `from @karpathy`, `by @karpathy`, `@karpathy` | author filter |
| `videos`, `clips`, `with screenshots`, `with images` | media type |
| `today`, `last week`, `last month`, `this year`, `last 10 days`, `in 2024`, `march 2025`, `since 2023`, `before 2024` | date range |
| `most liked`, `popular`, `top` / `oldest` / `latest` | sort |
| `in dev tools`, `category:funny-memes`, `in the AI category` | category |
| `show me`, `that thread about`, `something about` … | ignored filler |

Whatever is left is the topic. It is matched by keyword (BM25 over text, quoted text, author, AI tags, hashtags, tools, and text read out of images) and by meaning (vector similarity), then fused. **Ask AI** (⌘↵) sends the top candidates to your configured model for reranking and a one-line reason per result.

The semantic index builds itself: after import, after the AI pipeline, and on demand from the Search page (**Index now**). The first search downloads the model once into `.cache/models`. Set `EMBEDDINGS_DISABLED=true` to run keyword-only.

## AI categorization

Import starts the pipeline automatically. Stages:

1. **Entities** — hashtags, links, mentions, known tools (free, no API)
2. **Vision** — text, objects, scene, meme template for every image and video thumbnail
3. **Semantic tags** — 25–35 search tags per post plus sentiment, people, companies
4. **Categorize** — 1–3 categories per post with confidence scores
5. **Index** — refresh keyword index and re-embed anything whose text, tags, or categories changed

The pipeline is incremental. Interrupt it and it picks up where it stopped.

## AI providers

Detected in this order: Claude Code CLI session (macOS keychain) → API key saved in Settings → `ANTHROPIC_API_KEY` → `ANTHROPIC_BASE_URL` proxy. OpenAI (GPT-4.1 family, Codex CLI) and MiniMax are also supported.

Default model is Haiku 4.5 for bulk work; switch to Sonnet 5 or Opus 5 in Settings.

## CLI

```bash
npx tsx cli/siftly.ts search "memes about ai from last month"   # hybrid search, JSON out
npx tsx cli/siftly.ts index                                       # build semantic vectors
npx tsx cli/siftly.ts index --status
npx tsx cli/siftly.ts list --sort oldest --category dev-tools
npx tsx cli/siftly.ts stats
```

## Configuration

| Setting | Env var | Notes |
|---|---|---|
| Database | `DATABASE_URL` | default `file:./prisma/dev.db` |
| Anthropic key / base URL | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | optional with Claude CLI |
| OpenAI / MiniMax | `OPENAI_API_KEY`, `MINIMAX_API_KEY` | alternative providers |
| Embedding model | `EMBEDDINGS_MODEL` | default `Xenova/bge-small-en-v1.5` |
| Model cache dir | `EMBEDDINGS_CACHE_DIR` | default `./.cache/models` |
| Disable vectors | `EMBEDDINGS_DISABLED=true` | keyword-only search |
| Basic auth | `SIFTLY_USERNAME`, `SIFTLY_PASSWORD` | when exposing the app publicly |
| X GraphQL query IDs | `X_BOOKMARKS_QUERY_ID`, `X_LIKES_QUERY_ID` | cookie import only; change when X deploys |

See `.env.example` for the full list.

## Architecture

```
app/
  search/                 Search page (instant hybrid results + Ask AI)
  api/search/             GET  hybrid search
  api/search/ai/          POST rerank top candidates with the configured model
  api/search/index/       GET status · POST build vectors · DELETE stop
  api/import/*            JSON upload, direct import receiver (+progress), x-ids, cookie sync, OAuth — all use lib/import-bookmarks
  api/categorize/         5-stage pipeline with live progress
lib/
  query-parser.ts         plain English → terms + author/date/media/category/sort filters (pure)
  hybrid-search.ts        FTS5 + vectors → RRF → filtered, hydrated results
  embeddings.ts           local sentence embeddings, vector store, background indexer
  fts.ts                  FTS5 index with cleaned text columns and BM25 column weights
  rank.ts                 Reciprocal Rank Fusion, cosine helpers (pure)
  tweet-normalize.ts      X GraphQL tweet → ParsedBookmark (pure)
  x-query-ids.ts          discovers X's current GraphQL query IDs from public bundles (cached 24h)
  x-direct-import-script.ts  builds the in-page importer (bookmarklet / console)
  parser.ts               every JSON export format → ParsedBookmark (pure)
  import-bookmarks.ts     bulk dedupe + transactional writes + immediate indexing
  serialize-bookmark.ts   one shape for bookmark JSON across routes
prisma/schema.prisma      Bookmark (+ counts, quotedText), BookmarkEmbedding, Category, MediaItem …
```

Tests: `npm test` (vitest) covers the query parser, ranking, JSON parsing, and tweet normalization. `npm run typecheck` for TypeScript.

## Docker

The included `docker/` setup works unchanged. Mount a volume at `/app/.cache` if you want the embedding model to persist between container rebuilds; otherwise it re-downloads once per fresh container.

## Credits

Built on [Siftly](https://github.com/viperrcrypto/Siftly) by [@viperr](https://x.com/viperr) (MIT). The import tooling, AI pipeline, mindmap, and most of the UI come from there. sortX adds the search layer, the shared import path, engagement data, and the mobile layout.

## License

MIT — see [LICENSE](LICENSE).
