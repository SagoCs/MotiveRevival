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
npm test           # LRC parser suite (20 cases)
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
| V | Voice | LRC parser (test-first), synced lyrics in stage rail + expanded panel, lrclib.net fetch writing `.lrc` beside files, lyric-focus/art-focus cycling | ✅ Signed off |
| VI | Pulse | Hover snippet previews w/ waveform-peak pipeline, song-reactive UI theming, velocity spacing + art parallax, card→fullscreen morph, search oracle, remembered now-playing view | ✅ Signed off (minor polish riders) |
| VII | Playlists | Create/reorder/persist; playlist tab awakens | Implemented; final QA pending |
| VIII | Atmosphere & QOL | Deeper cosmic space, reactive constellations, refined motion, clearer states and everyday usability | Aspirational |

## Progress Ledger

Sign-off entries are added when changes are verified working in session.

- **2026-08-26 — Movements I–III verified.** Playback pipeline, scrub-drag fix, transport wiring, numbering fix, borderless chrome, settings persistence, universal search relevance rewrite (word-boundary fuzzy), artist-card click fix (pointer-capture regression).
- **2026-08-26 — Movement IV verified.** Two-pane stage with staggered mini-cells; per-album queue context; auto-advance; prev/next; palette field throbbing confirmed; spectrum engine v2 confirmed "truly reflective" after fftSize 2048 rebuild; overlay color-wash pulse confirmed.
- **2026-08-26 — Movement V signed off.** Pure LRC parser locked behind a 20-case suite (`npm test`) covering fractions, multi-timestamps, offset sign convention, BOM/CRLF, malformed tolerance and sync boundaries. Lyrics resolve local-sheet-first, then lrclib (get → search fallback, closest duration, synced preferred) and are written beside songs so folders stay portable. LyricScroller lives in the stage rail *and* a two-column expanded panel: hue-tinted high-luminance ink, active-line glow, click-a-line-to-seek.
- **2026-08-26 — Movement VI signed off (minor polish riders).** Hover-snippet previews on every song cell: 1.4s dwell, main playback ducks to silence and restores precisely; waveform peaks come from a lazy-first-hover decode plus a throttled idle queue, persisted permanently. Song-reactive UI theming via `@property` color crossfade (priority hovered > playing > moonlight) across scrubber, glows, borders, ambient washes. Velocity spacing + art parallax on the carousel (transform-only). Card-to-fullscreen FLIP morph with measured destination rects. Search rebuilt as a top-center summonable oracle with centered browse chrome. Frameless custom window controls; flex-column shell; scroll-performance pass on long song lists. Now-playing focus modes gated on lyric availability and remembered between sessions (default: Art Focus).
- **2026-08-26 — Movement VII playlist implementation reached interaction-QA stage.** Renderer-owned playlist persistence through KV storage, live track resolution by ID/path, missing-track ghosts, create/rename/delete, drag or button reorder, session-only shuffle playback, play-all, playlist search, and song context-menu additions are present. Context menus now retain their anchor when changing views, use consistent typography, and prefer opening to the right of the source song. Default and expanded queue controls share reactive accent styling and explicit expanded-view hit-target handling. Full manual Electron QA and final sign-off remain pending.
- **2026-08-27 — Transport and now-playing polish verified.** Normal view is now the default playback surface; expanded now-playing is opened and closed with the music-note toggle or Escape. Both views share the minimized transport geometry and controls. Synced lyrics can preview over the normal scrubber with pointer-transparent frosted styling and an enlarged hit area; scrub release updates the active LRC line through the existing rAF clock.
- **2026-08-27 — Transport alignment and queue theming polished.** Expanded now-playing no longer shifts during transition; both transports place previous/play/next before the current-time display with matching geometry. The lyric backdrop is continuous and borderless, and queue panel accents now consume the active song theme variables.
- **2026-08-27 — Minimized lyric and settings polish verified.** Synced lyrics now appear as a centered content-sized orb above the minimized scrubber without a full-timeline frosted layer. Settings rows have more breathing room and their toggles/segments align to a shared right edge.
- **Deferred:** now-playing display toggles v1 — superseded by art/title cycling + persisted default view; richer toggles may return later.
- **Deferred:** custom folder-picker UI (frosted card style) — native dialog currently in use; queued for polish pass.
- **Open riders:** BPM tag shown in metadata when present · minor visual tweaks flagged during Movement VI sign-off review.

## Future Direction

The next major pass should make the existing architecture feel more celestial without burying the music or artwork under effects. The intended direction is layered depth: multiple slow starfield planes, restrained palette-reactive constellations, mouse-parallax atmosphere, subtle pointer trails or cursor light, and foreground transitions that respond to playback and album color. All motion remains gated by the existing master and granular motion settings.

The same pass should improve daily usability: first-run library guidance, clearer scan and error states, stronger focus and keyboard feedback, duplicate protection when adding playlist tracks, richer action confirmations, and more precise hover, selected, playing, previewing, queued, and unavailable states.

## Known Behaviors

- First launch after an update runs a background rescan; palettes/cards refresh moments after boot (cached index paints instantly meanwhile).
- Sorting chip labels adapt per tab but occupy fixed 96px slots so the control bar never shifts.
