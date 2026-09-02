# sortX

Self-hosted X/Twitter bookmark manager: import → AI categorize → plain-English hybrid search. Fork of Siftly (viperrcrypto/Siftly); upstream remote is `upstream`, this repo is `origin` (machelsaunders/sortX), working branch `sortx`.

## Quick Setup

```bash
./start.sh            # installs deps, migrates DB, opens browser
```

Manual: `npm install && npx prisma generate && npx prisma migrate deploy && npx next dev` → http://localhost:3000

## AI Authentication — No API Key Needed

If the user is signed into Claude Code CLI, the app uses that subscription automatically (`lib/claude-cli-auth.ts` reads the OAuth token from the macOS keychain; text tasks prefer `claude -p` via `lib/claude-cli.ts`). Fallbacks: DB-saved API key → `ANTHROPIC_API_KEY` → `ANTHROPIC_BASE_URL` proxy. Check with `GET /api/settings/cli-status`.

Semantic search needs **no AI provider**: `lib/embeddings.ts` runs `Xenova/bge-small-en-v1.5` locally via transformers.js (downloaded once to `.cache/models`).

## Key Commands

```bash
npx next dev              # dev server
npm run typecheck         # tsc --noEmit
npm test                  # vitest (parser, query parser, ranking, tweet normalize)
npx prisma migrate dev --name <change>   # after editing schema.prisma
npx prisma studio
npm run build
npx tsx cli/siftly.ts search "memes about ai last month"
npx tsx cli/siftly.ts index --status
```

## How search works

1. `lib/query-parser.ts` (pure) turns the sentence into `terms` + filters: author, since/until, mediaType, category, sort. Filler like "show me that thread about" is stripped.
2. `lib/hybrid-search.ts` runs `ftsSearch` (FTS5, `bookmark_fts_v2`, BM25 column weights) and `vectorSearch` (brute-force cosine over `BookmarkEmbedding` rows, cached in memory) in parallel, fuses with RRF (`lib/rank.ts`), applies filters via Prisma, hydrates with `lib/serialize-bookmark.ts`.
3. `GET /api/search` returns that instantly. `POST /api/search/ai` takes the top 40 hybrid hits and asks the configured model to rerank + explain.
4. Indexing: `lib/import-bookmarks.ts` upserts FTS rows and schedules embeddings for new posts; the categorize pipeline ends with an `index` stage (`rebuildFts` + `embedBookmarks`); `POST /api/search/index` rebuilds on demand. Vectors are re-computed only when the document hash changes.

## Project Structure

```
app/
  search/               unified search page (replaces /ai-search, which redirects)
  api/search/           route.ts (hybrid), ai/route.ts (rerank), index/route.ts (vectors)
  api/import/           route.ts (JSON), bookmarklet/, twitter/ (cookie), live/ (scheduled), x-oauth/
  api/categorize/       pipeline: entities → parallel(vision, tags, categorize) → index
  api/bookmarks/        list/filter (q, author, category, mediaType, source, sort=newest|oldest|popular)
  import/ bookmarks/ categories/ categorize/ mindmap/ settings/ page.tsx
components/
  nav.tsx               sidebar on md+, top bar + drawer below md
  search-hero.tsx       dashboard search box
  command-palette.tsx   Cmd+K → /api/search
lib/
  query-parser.ts hybrid-search.ts embeddings.ts fts.ts rank.ts
  tweet-normalize.ts parser.ts import-bookmarks.ts serialize-bookmark.ts
  categorizer.ts vision-analyzer.ts rawjson-extractor.ts twitter-api.ts x-sync.ts
  ai-client.ts settings.ts claude-cli*.ts openai-auth.ts minimax-auth.ts codex-cli.ts
prisma/schema.prisma    Bookmark (+quotedText, like/retweet/reply/view counts, lang), BookmarkEmbedding, Category, BookmarkCategory, MediaItem, ImportJob, Setting
```

## Conventions

- Every import path must go through `importParsedBookmarks()` — it dedupes, writes media, extracts entities, and indexes.
- Pure modules (`query-parser`, `rank`, `parser`, `tweet-normalize`) must not import `@/lib/db` so they stay unit-testable.
- Model IDs: `claude-haiku-4-5` (default), `claude-sonnet-5`, `claude-opus-5`. Legacy dated IDs are normalised in `lib/settings.ts`.
- FTS5 table is `bookmark_fts_v2`, created at runtime by `ensureFtsTable()`; the old `bookmark_fts` is dropped automatically.
- Add a known tool: `KNOWN_TOOL_DOMAINS` in `lib/rawjson-extractor.ts`. Add a default category: `DEFAULT_CATEGORIES` in `lib/categorizer.ts`.
- No AI attribution in commits.
