# promo-video

Films Niyom's promo videos. Drives the **real product** in headless Chromium
against a sample account, narrates it, and cuts the result to MP4.

Two films ship today:

| Film | Product | Audience | Sample login |
|---|---|---|---|
| `partner` | Partner (DSA) Portal | Prospective distribution partners | `NIYOM1234D` |
| `client` | Client Portal | Prospective investors | `NIYOM5678C` |

```bash
npm install                    # once; Playwright's Chromium is already cached
npm run smoke                  # partner: is the portal reachable, does it render?
npm run smoke:client           # client: same
npm run all -- client          # narrate → film → assemble → write SCRIPT-client.md
```

Each film produces two cuts in `out/` (gitignored):

- `niyom-<slug>-16x9-1080p.mp4` — ~1:49, LinkedIn / YouTube / site
- `niyom-<slug>-9x16-1080p.mp4` — ~1:00, WhatsApp Status / Reels / Shorts
- `SCRIPT-<film>.md` (package root) — shot list, narration, measured timecodes

## Prerequisites

- The dev server on `http://localhost:5173` (`niyom-dev` in `.claude/launch.json`).
  Override with `PROMO_BASE_URL`.
- `ffmpeg` and `ffprobe` on PATH.
- macOS, for `say`.

## How it works

| Step | File | Notes |
|---|---|---|
| Narrate | `voice.ts` | `say` → AAC, measured with ffprobe. **Every scene's length is derived from its narration**, so picture and voice cannot drift. |
| Film | `capture.ts` | One context per aspect ratio, signed in once. |
| Script | `films/*.ts` | A film is its scenes **and** its acts in one file — the narration describes what the act does, and splitting them lets the two drift apart. |
| Record | `recorder.ts` | CDP screencast, not Playwright's `recordVideo`, so recording starts and stops around each scene and the sign-in never reaches the film. |
| Point | `cursor.ts` | Headless Chromium draws no cursor; a gold dot tracks real mouse events. |
| Caption | `captions.ts` | Transparent PNGs rendered in Chromium, so captions are set in the product's own Space Grotesk / Inter. |
| Cut | `build.ts` | Hard cuts with a short fade-up. Per-scene audio is padded to its own scene length, so A/V sync holds by construction. |

`film.ts` holds the types; `films/index.ts` holds the registry (keeping the two
apart is what stops an import cycle). Brand values in `brand.ts` mirror
`src/theme/tokens.css`.

## Adding a film

1. Write `src/films/<key>.ts` exporting a `Film`: scenes, acts, login path and
   credentials, and the `signedInMarker` that proves the product loaded.
2. Register it in `src/films/index.ts`.
3. `npm run all -- <key>`.

## Notes

- **Nothing real is filmed.** Both sample accounts are front-end only — no auth
  user, no database rows — every security is invented, the portals' own "Sample
  portal" banner stays visible throughout, and scenes showing money carry an
  illustrative-figures notice.
- **No music.** No licensed track ships with the repo. The mix leaves room.
- **UI scenes are not zoomed or pushed.** A slow Ken Burns move on a screen
  recording shimmers fine UI text; the motion comes from the cursor instead.
