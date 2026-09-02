# Deferred / v2

Items consciously left out of the `sortx` branch. Revisit when needed.

- **Vector index at scale** — brute-force cosine is fine to ~100k bookmarks. Beyond that, load `sqlite-vec` and store vectors in a virtual table.
- **Cloud embeddings option** — allow OpenAI / Voyage embeddings as an alternative to the local model for machines that cannot run ONNX (e.g. very small Docker hosts).
- **Removable filter chips** — chips on the Search page show what was understood but are not clickable; removing one means editing the query text.
- **Query understanding with the LLM** — for ambiguous sentences ("that guy who writes about rust") an optional model-assisted parse could suggest author/category filters. Rule-based parser covers the common cases today.
- **Per-bookmark delete** — the API only supports clearing the whole library. Add `DELETE /api/bookmarks/[id]` that also removes FTS + embedding rows.
- **Likes import via cookie** — needs `X_LIKES_QUERY_ID`; the value changes with X deploys and is not auto-discovered.
- **Docker model cache** — document/mount `/app/.cache` so the embedding model persists across rebuilds; consider baking it into the image.
- **Upstream lint errors** — `react-hooks/set-state-in-effect` in `theme-toggle.tsx`, `command-palette.tsx`, `bookmarks/page.tsx`, `import/page.tsx` predate the fork; they do not block the build.
- **Search analytics** — remember recent queries per browser for quick re-run.
- **Contribute back** — the shared importer, engagement counts, and build fix are candidates for an upstream PR to viperrcrypto/Siftly.
