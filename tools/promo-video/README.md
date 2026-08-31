# promo-video

Films the Partner Portal promo. Drives the **real portal** in headless Chromium
against the demo partner account, narrates it, and cuts the result to MP4.

```bash
npm install                 # once; Playwright's Chromium is already cached
npm run smoke               # is the portal reachable and does the shelf render?
npm run all                 # narrate → film → assemble → write SCRIPT.md
```

Outputs land in `out/` (gitignored):

- `niyom-partner-portal-16x9-1080p.mp4` — ~1:49, LinkedIn / YouTube / site
- `niyom-partner-portal-9x16-1080p.mp4` — ~1:00, WhatsApp Status / Reels / Shorts
- `SCRIPT.md` (package root) — shot list, narration and measured timecodes

## Prerequisites

- The dev server running on `http://localhost:5173` (`niyom-dev` in
  `.claude/launch.json`). Override with `PROMO_BASE_URL`.
- `ffmpeg` and `ffprobe` on PATH.
- macOS, for `say`.

## How it works

| Step | File | Notes |
|---|---|---|
| Narrate | `voice.ts` | `say` → AAC, measured with ffprobe. **Every scene's length is derived from its narration**, so picture and voice cannot drift. |
| Film | `capture.ts`, `acts.ts` | One context per aspect ratio, signed in once. `acts.ts` holds what happens on screen. |
| Record | `recorder.ts` | CDP screencast, not Playwright's `recordVideo`, so recording starts and stops around each scene and the sign-in never reaches the film. |
| Point | `cursor.ts` | Headless Chromium draws no cursor; a gold dot tracks real mouse events. |
| Caption | `captions.ts` | Transparent PNGs rendered in Chromium, so captions are set in the portal's own Space Grotesk / Inter. |
| Cut | `build.ts` | Hard cuts with a short fade-up. Per-scene audio is padded to its own scene length, so A/V sync holds by construction. |

Scenes and copy live in `narration.ts`; brand values in `brand.ts` mirror
`src/theme/tokens.css`.

## Notes

- **Nothing real is filmed.** The demo account has no Supabase session and no
  database rows; the portal's "Sample portal" banner stays visible throughout,
  and scenes showing money carry an illustrative-figures notice.
- **No music.** No licensed track ships with the repo. The mix leaves room for
  one.
- **UI scenes are not zoomed or pushed.** A slow Ken Burns move on a screen
  recording shimmers fine UI text; the motion comes from the cursor instead.
