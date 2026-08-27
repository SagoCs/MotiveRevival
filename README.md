# MotiveRevival

A celestial-atlas music player for Windows. Browse your library as drifting constellations of album art, summon any song with a keystroke, and watch the interface breathe with the music.

---

## Vision

A local music frontend that feels **cosmic, aetherial, and fantastical** — built around three pillars:

- **Universal search, always on** — start typing anywhere; fuzzy, accent-blind matching across songs, artists, and albums. `Esc` cancels, `Enter` summons.
- **osu!-style browsing** — a momentum carousel of rounded art cards that breathe with scroll velocity; click an album to descend into its songs.
- **A living interface** — each album's dominant colors wash the stage; gradients and glows pulse with live bass/mid/treble energy; synced lyrics will complete the picture.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** | Native file access + Chromium audio decode (FLAC/MP3/OGG) in one runtime |
| Language | **TypeScript** (strict) | Compile-time guard against the ghost bugs of attempts #1–2 |
| Bundler | **esbuild** | Sub-second builds. No dev server, no HMR — every launch is a true cold start |
| UI | **Vanilla TS + DOM** | Zero framework magic; explicit singletons, bind-once listeners |
| Tags & art | **music-metadata** | Pure JS; no native modules |
| Fonts | Sora · IBM Plex Mono via Fontsource | Local woff2, fully offline |
| Storage | JSON index + settings in `%APPDATA%\MotiveRevival` | Instant boot for <5k-track libraries |

## Architecture Rules

These exist to permanently kill the failure modes of previous attempts:

1. **One immortal `<audio>` element.** `PlayerService` owns it from boot to quit; nothing in the app ever destroys it. Navigation is overlays sliding over playback — returning to the library cannot brick the player.
2. **`requestAnimationFrame` clock**, never `timeupdate`, drives timeline and lyric sync.
3. **Cold starts only.** `npm run build` then `npm start`. HMR-style staleness is structurally impossible.
4. **`media://` streaming protocol** with range-request support and path containment (music folder + art cache only).
5. **Event buses over teardown**: player events (`Bus`) and selection events (`appBus`) fan out to persistent views; views subscribe once at boot.

### Module map

```
src/
├── main/            Electron main process
│   ├── main.ts        window, IPC, scan orchestration
│   ├── media.ts       media:// protocol (range requests, root containment)
│   ├── library.ts     scanner: tags, art extraction, palette extraction, index cache
│   └── settings.ts    persisted settings
├── preload/         contextBridge — the entire IPC surface
├── shared/types.ts  contracts shared across processes
└── renderer/
    ├── core/          player, buses, search index, fuzzy matcher, palette, band reactivity
    └── ui/            carousel physics, browser orchestrator, detail stage, transport, overlay
```

## Running

```
npm install        # once
npm run build      # bundle main/preload/renderer → dist/
npm start          # build + launch (always a cold start)
npm run typecheck  # strict TS gate
```

Optional: set `MOTIVE_MUSIC_DIR` to override the music folder for a session. Default archive: `D:\Music` (changeable in-app via the sliders icon → Settings).

Keyboard: type anywhere = search · `/` focuses search · `Esc` steps back (search → overlay → detail) · `Space` play/pause · `Ctrl+R` cold reload · `F12` devtools.

## Roadmap — Movements

| # | Name | Contents | Status |
|---|---|---|---|
| I | Skeleton | Frameless window, media pipeline, immortal player, torture tests | ✅ Signed off |
| II | Data layer | Tag/artist/album/duration indexing, embedded-art extraction + folder fallback, cached index, background rescan | ✅ Signed off |
| III | The Browser | Universal always-on search, albums/artists/songs/playlists tabs, sorts, osu-style carousel v1, detail slide-in | ✅ Signed off |
| IV | Chromatic | Two-pane detail stage, palette engine, live audio-band reactivity, visualizer v2, queue + next/prev | ✅ Core signed off; display-toggles deferred |
| V | Voice | LRC parser (test-first), synced lyrics in stage and expanded views, lrclib.net fetch writing `.lrc` beside files | ✅ Signed off |
| VI | Pulse | Hover snippets w/ waveform-peak analysis, song-reactive theming, velocity spacing, parallax, morph transition, search oracle, remembered now-playing view | ✅ Signed off |
| VII | Playlists | Create/reorder/persist; playlist tab awakens | ✅ Signed off |
| VIII | Atmosphere & QOL | Deeper cosmic space, reactive constellations, refined motion, clearer states and everyday usability | Aspirational |

## Progress Ledger

Sign-off entries are added when changes are verified working in session.

- **2026-08-27 — Movement VII signed off.** Playlists support creation, rename/delete, persistence, context-menu additions, missing-track ghosts, drag and button reorder, session-only shuffle playback, play-all, playlist search, and detail-panel interaction. Queue and context-menu polish, transport alignment, normal-view default playback, synced lyric orb, detail-layer behavior, and reactive queue styling were also completed.

- **2026-08-26 — Movements I–III verified.** Playback pipeline, scrub-drag fix, transport wiring, numbering fix, borderless chrome, settings persistence, universal search relevance rewrite (word-boundary fuzzy), artist-card click fix (pointer-capture regression).
- **2026-08-26 — Movement IV verified.** Two-pane stage with staggered mini-cells; per-album queue context; auto-advance; prev/next; palette field throbbing confirmed; spectrum engine v2 confirmed "truly reflective" after fftSize 2048 rebuild; overlay color-wash pulse confirmed.
- **Deferred:** now-playing display toggles (Art/Visualizer/Metadata). Removed pending polished redesign — chips appeared inert against blank pre-selection targets; root cause not conclusively isolated. Re-imagined version planned for Movement VI.
- **Deferred:** custom folder-picker UI (frosted card style) — native dialog currently in use; queued for polish pass.

## Future Direction

The next major pass is QOL and cosmic-atmosphere polish: layered moving starfields, restrained palette-reactive constellations, mouse-parallax depth, optional cursor or trail effects, clearer loading and error states, first-run library guidance, stronger keyboard feedback, playlist duplicate protection, and more precise motion choreography. All visual effects should remain gated by the existing motion settings and preserve the artwork as the primary focus.

## Known Behaviors

- First launch after an update runs a background rescan; palettes/cards refresh moments after boot (cached index paints instantly meanwhile).
- Sorting chip labels adapt per tab but occupy fixed 96px slots so the control bar never shifts.
