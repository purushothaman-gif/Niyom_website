# Rebuild backup — 2026-07-24

Pre-rebuild snapshot of the **Learning**, **News**, **MF Research**, and **Calculator**
public pages plus their backend, taken before the full rewrite requested on 2026-07-24.

## Contents
- `pages/` — original `Learning.tsx`, `News.tsx`, `MFResearch.tsx`, `Calculator.tsx`
- `functions/` — original edge functions `fetch-financial-news`, `update-mutual-funds`,
  `update-commodity-prices`
- `migrations/` — original SQL that created/altered the `news`, `mutual_funds`, and
  `commodity_prices` tables

## Restore
To revert the frontend:
```bash
cp backups/rebuild-20260724/pages/*.tsx src/pages/
cp -R backups/rebuild-20260724/functions/* supabase/functions/
```
The original tables can be recreated by re-applying the SQL in `migrations/` (they use
`CREATE TABLE IF NOT EXISTS`, so drop the rebuilt tables first if you need a clean restore).

> This folder lives outside `src/`, so it is not bundled by Vite or compiled by `tsc`.
