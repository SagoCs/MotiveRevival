# AGENTS.MD — Operational Contract

Living document for any agent instance working on MotiveRevival. Update it at every milestone stamp. Narrative history and the signed progress ledger live in `README.md`.

## Agent Conduct

- **Never launch subagents without the user's explicit prior approval** — in every session, for every task. All exploration, search, and implementation work happens directly in the main agent; if delegation seems useful, ask first.

## Project Snapshot

Electron + vanilla TypeScript music player ("Moonlit Drift" aesthetic). Movements I–VI signed off (skeleton, data layer, browse carousel, chromatic theming, lyrics/lrclib, pulse previews). Movement VII — Playlists is implemented and undergoing final interaction QA. Normal view is the default playback surface; expanded now-playing is explicitly toggled. First cosmic-atmosphere slice landed: a song-reactive "horizon haze" veil above the transport hosts the centered lyric preview. Next direction: QOL and remaining cosmic-atmosphere polish. Open riders: BPM tag in metadata, custom frosted folder-picker UI, minor visual tweaks from the VI review.

## Commands

```
npm install
npm run build      # esbuild → dist/ (main.js, preload.js, renderer iife + css/fonts)
npm start          # build + launch electron (ALWAYS a cold start)
npm run typecheck  # tsc --noEmit (strict)
npm test           # LRC parser suite → esbuild bundle → node --test (must stay 20/20)
```

Launch for verification from an agent shell: `Invoke-CimMethod Win32_Process Create` with `cmd /c cd /d <dir> && node_modules\.bin\electron.cmd . 1> "%TEMP%\mr-out.log" 2> "%TEMP%\mr-err.log"`. Plain Start-Process children get reaped by the sandbox.

## Non-Negotiable Invariants

1. One immortal `<audio>` element owned by `PlayerService` — created once, never destroyed. Views are overlays; navigation must never touch playback internals.
2. No dev server, no HMR. Every run is build + cold launch.
3. rAF clock drives sync; never rely on `timeupdate` alone.
4. Bind event listeners exactly once at boot. Views subscribe to buses (`player.bus`, `appBus`, `libraryStore`); nothing unbinds on navigation.
5. Strict TypeScript, zero comments in code, no emoji.
6. All IPC passes through `preload.ts` via typed `MrApi`; renderer has no Node access.
7. `media://` protocol serves ONLY whitelisted roots (settings.musicDirs + art cache dir) with path containment checks and Range support.
8. Custom properties that animate colors must be registered via CSS `@property` (see `--acc-*`).

## Module Map & Ownership Notes

- `src/main/` — main process: `main.ts` (window frame:false, IPC, scan scheduling), `media.ts` (protocol+Range), `library.ts` (multi-root scan, tags/art/palette extraction, index.json v3 w/ dedupe), `lyrics.ts` (lrclib fetch/write-beside), `settings.ts` (musicDirs[], migration from legacy single-dir), `storage.ts` (kv.json debounced persistence)
- `src/preload/preload.ts` — the entire bridge surface
- `src/shared/types.ts` — every cross-process contract. Change here first.
- `src/renderer/core/` — `player.ts` (immortal audio element, queue/context model, analyser graph, event bus), `lrc.ts` parser (pure, 20 tests in `tests/`), `fuzzy.ts` (word-boundary subsequence matcher), `searchIndex.ts` (songs/albums/artists entries + folded hay fields), `libraryStore.ts` (library snapshot store w/ `onChange`), `playlistsStore.ts` (KV-persisted playlist CRUD, id→path→ghost resolution), `peakAnalyzer.ts` (lazy+idle RMS decode → kv `waveformPeaks`), `preview.ts` (dwell/duck hover-audio service), `palette.ts` (hexToHsl, applyPalette, applyLyricsInk, deriveAccent), `uiTheme.ts` (--acc-* writer), `audioBands.ts` (--bass/--mid/--treble bridge); helpers: `bus.ts`, `appBus.ts`, `dom.ts`, `fold.ts`, `fx.ts`, `paths.ts`
- `src/renderer/ui/` — `browser.ts` (orchestrator: tabs/sorts/oracle/detail-stage/cards), `carousel.ts` (momentum physics, writes --cs/--py per card), `overlay.ts` (now-playing focus modes art-focus ⇄ split, lyric-gated), `lyrics.ts`, `transport.ts` (+ minimized lyric orb), `settings.ts`, `windowControls.ts`, `viz.ts`, `queuePanel.ts` (shared up-next panel, HTML5-drag reorder), `icons.ts` (inline SVG constants), `playlistsView.ts` (playlist cards, detail layer, search, song context menu)

## Conventions

- **Aesthetic Contract ("Moonlit Drift")** — `tokens.css` is the single source of truth:
  - Backgrounds are always near-black voids (`--void-0..2`); never pure black, never light.
  - Ink (text/lyrics) is always high-luminance (≥88%) tinted by the active song's hue — personality comes from hue + glow (`--lyric-glow`), never from dark ink or saturated fills.
  - Interactive accents flow through registered `@property` colors `--acc-a/b/glow`, crossfading ~700ms; priority chain: hovered song > playing song > moonlight defaults.
  - Hover states are *diluted* accent mixes (~55% toward white); selected/playing states use full-strength accent plus a solid left bar — hover ≠ selected by construction.
  - Typography: Sora for all display/body text (weights 300/400/600), IBM Plex Mono only for numerals/timestamps. Lyric sizes multiply `--lyric-scale`.
  - Motion: drift easing `cubic-bezier(0.16, 1, 0.3, 1)`, long durations (400–700ms); motion is flag-gated (`fx.motion/carousel/pulse/morph`) and writes only transforms/custom properties.
  - Forbidden: emoji as UI icons, glassmorphism cards, purple→blue gradient clichés, neon saturation, springy bounce easing.
- Accent system: everything interactive consumes `--acc-a/b/glow`; settings modal sections mirror it too.
- Cards use `content-visibility:auto` + `contain-intrinsic-size`; motion writes only transform/custom props (`--cs` scale, `--py` drift).
- Focus modes require `hasLyrics`; cycle is art/title click, persisted as `nowPlayingView`.
- Search = oracle popup only. Browse render is never filtered by query state.
- Settings modal: two internal views (`#settings-home` ⇄ `#libraries-view` drill-down). Motion = master switch + three granular flags (`motionCarousel/Pulse/Morph`). Lyrics = auto-fetch, save-beside-gate on `.lrc` writes, S/M/L text scale (`--lyric-scale`).

## Environment Gotchas (this machine)

- NEVER write files via PowerShell `[IO.File]::WriteAllText` without `-Encoding utf8` — default encoding corrupts non-ASCII (en-dashes, middots) to `?`. Prefer the file-edit tool; if bash replace is required, keep payloads ASCII-only or add `-Encoding utf8`.
- PowerShell here-strings: `@'` must be immediately followed by a newline.
- Edit-tool anchors fail on invisible whitespace — retry with shorter unique substrings, then fall back to ASCII-only bash `.Replace()`.
- Substring surgery on `index.html` (IndexOf→Substring splices) has swallowed sibling elements before (`#search-oracle` vanished this way). After any structural HTML splice, grep for every known id before building.
- After killing electron: `Get-Process -Name electron | Stop-Process -Force; Start-Sleep 2` before relaunch.

## Current State / Open Tasks

- [x] Settings facelift: multi-archive libraries (add/remove + drill-down manage view), master+granular motion flags, lyrics save-beside gate, S/M/L lyric scale.
- [~] **Movement VII — Playlists (IMPLEMENTED, AWAITING SIGN-OFF)** — brief below.
  - **Storage**: renderer-owned via existing KV IPC (`storageGet/Set('playlists')`). No main-process changes.
  - **Shapes** (`shared/types.ts`, additive): `PlaylistTrackRef { trackId: string; absPath: string }`; `Playlist { id: string; name: string; createdAt: number; updatedAt: number; tracks: PlaylistTrackRef[] }`.
  - **New files**: `src/renderer/core/playlistsStore.ts` (CRUD + resolve-vs-libraryStore: id hit → live track; else absPath match; else ghost `{ ref, missing:true }`), `src/renderer/ui/playlistsView.ts` (tab cards incl. "+ New Playlist"; detail slide-in panel `#playlist-layer` mirroring `.detail-layer` styling; draggable mini-cells w/ ▲▼ reorder, per-row ✕, ghost rows dimmed/unplayable w/ ✕; header: shuffle/play/delete icons).
  - **Markup**: none in `index.html` — `#playlist-layer` is built in JS (`buildLayer()` in `playlistsView.ts`) and appended to `<body>` on first use. **CSS**: append-only block at end of `shell.css`, opened by the `/* PLAYLISTS */` marker.
  - **Interactions**: hover ⊕ on song cells is OUT of scope for the branch (integrated post-merge by primary). Play-all uses `player.setContext(resolvedTracks, 0)`; shuffle uses a session-only randomized context and does not mutate saved order.
  - **Verification**: typecheck + `npm test` + build MUST pass. Do NOT launch electron (single-instance lock is held by the primary session).
- **Playlist integration map:** all playlist logic lives in `playlistsStore.ts` / `playlistsView.ts`; `overlay.ts`, `settings.ts`, `carousel.ts`, and everything in `main/` / `preload/` remain playlist-free by design. `browser.ts` holds only the three dispatch hooks (Playlists mode tab, oracle search rows, song context-menu attach) and `index.html` only the Playlists tab button — extend those hooks, don't grow them.
- [ ] Riders: BPM tag display (music-metadata common.bpm), custom frosted folder-picker replacing native dialog, minor VI-review visual tweaks.
- [ ] **Next polish direction:** QOL and cosmic atmosphere. Priorities are clearer empty/loading/error states, first-run library guidance, playlist duplicate protection, stronger keyboard/focus feedback, layered moving starfields, restrained palette-reactive constellations, mouse-parallax depth, cursor/trail effects gated by motion settings, and more precise transition choreography.
- [x] Transport polish: minimized and expanded transport alignment, normal-view default playback, Escape/music-note view toggling, and synced lyric preview over the normal scrubber with an enlarged pointer hit area.
- [x] Horizon haze v1: `#bottom-bar::before` veil (`--horizon-h: clamp(112px, 16vh, 172px)`; structure 97% → 70% @38% → void-1 taper; hairline border retired in favor of the lit skyline). Registered `--hz-a/b/glow` colors derived in `palette.ts:deriveHorizon` (dark+saturated, lightness-capped), written by `uiTheme.setBase`, mirrored across `pushPreview/popPreview` so the floor follows the full hovered > playing chain. `.transport-lyric` de-boxed and viewport-centered (`position: fixed` under `#bottom-bar` scope only); veil + lyric hide via `body:has()` while detail/playlist layers are open. Expanded overlay untouched.
- [ ] Keep `README.md` ledger updated at each sign-off; bump this file's snapshot.

## Verification Ritual

1. `npm run typecheck` clean
2. `npm test` green (parser)
3. `npm run build` clean
4. Relaunch via WMI command above; confirm ≥3 electron processes and empty stderr log
5. Manual torture: Ctrl+R cold reload mid-playback · overlay open/close while playing · hover-preview duck/restore · fling carousel
