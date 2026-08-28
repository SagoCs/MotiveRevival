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
| VII | Playlists | Create/reorder/persist; playlist tab awakens | ✅ Signed off |
| VIII | The Living Void | Lantern cursor, pointer bias, song-state effects, usability, The Waveform Horizon | Chartered — Phases 0–2 closed |

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
- **2026-08-27 — Scrubber atmosphere refined.** The minimized lyric orb now sits higher with larger type, and the scrubber rail, fill, knob, and hover glow carry a restrained active-song accent tint.
- **2026-08-27 — Playback presentation refined.** The lyric orb is now centered across the full transport and hidden on detail layers; the music-note halo is removed, no-lyrics expanded mode defaults to large art/visualizer focus with a restrained unavailable-action shake, and the queue remains palette-reactive.
- **2026-08-27 — Bottom-bar "horizon haze" signed off.** The transport bar retired its hairline border and now exhales an atmosphere: a viewport-scaled veil (`clamp(112px, 16vh, 172px)`, floored so lyrics never lose backing) rises above the controls — near-solid at the skyline (~97%), holding a 70%-density shoulder through its middle, dissolving into void at the crest. Three new registered colors `--hz-a/b/glow` derive dark-but-saturated tones from palette data and ride the 700ms crossfade chain; after live testing they follow the full hovered > playing priority chain beside every other accent (playing-only coupling read as disconnected). The minimized lyric preview shed its chip chrome — borderless ink resting inside the fog, viewport-centered at last (its old transport-relative anchor sat ~48px right of true center because of the asymmetric button cluster). Veil and lyric hush away together when detail or playlist layers open; expanded now-playing is untouched. Lessons banked for Movement VIII's rising dust: perceptibility lives in luminance deltas over the void backdrop, not opacity percentages shuffled among near-equal darks — one invisible-build regression was caught by eye and re-derived from first principles, and a later song-tinted mid-band experiment was judged less clean than the plain fade and reverted without residue.
- **2026-08-27 — Movement VII signed off.** Playlists completed final QA through days of live use: create/name/rename/delete, KV persistence, oracle rows, playlist cards, add-to-playlist context menus on songs and stage cells, and ghost rows for missing files. Reordering adopted the queue's grammar — gap-based drag with a glowing insertion line, the ▲▼ buttons retired, per-row ✕ retained, one drop one persist via `playlistsStore.reorderTrack`. Tab, search, play-all, and session-only shuffle all verified.
- **2026-08-27 — Expanded now-playing rebuilt around three first-class views.** Art / Art + Lyrics / Lyrics Only, switched by dots above the transport, keys 1/2/3, or the existing art-title cycling (legacy 'blur' preferences migrate to Lyrics Only). Lyrics Only keeps the blurred artwork as a full backdrop, hides the art column/visualizer/title, drops the divider, centers a wide lyric column, and keeps invisible edge zones for one-click view jumps. Lyrics render far larger (34px, 38px in Lyrics Only, × user scale) with looser leading (~5–6 lines on screen), and wheel-parking pauses auto-sync while scrolling with a 2.5s snap-home; clicking a line seeks and snaps instantly.
- **2026-08-27 — Performance campaign: virtualization, thumbnail pipeline, compositing.** The songs list virtualizes with fixed-height rows and patch-based sliding windows — visible rows are never remounted, relocation fires only after the offscreen buffer drains, and maintenance runs deferred — so scroll cost is independent of library size. Artwork became a two-size pipeline: 128px thumbnails generated at scan and self-healed on demand by the media handler, thumb-first rendering with full-res fallback, and cacheable art responses replacing the old no-store header that caused decode storms. Song rows hold permanent compositor surfaces, motion values are quantized, hover accent storms mute mid-fling, and the carousel paint loop touches only its visible window (including the discovery that the parallax transforms had been silently acting as our layer-promotion system). A blurred, crossfading backdrop of the playing album now spans the browsing floor. Transport numerals moved to high-luminance ink with a void halo; the album detail's back arrow retired in favor of Esc/click-outside; the topbar and controlbar joined the color-reactive system with a whisper-tier ceiling wash. Boot render-delay fell from ~1.13s to noise; scrolling is fluent at any velocity.
- **2026-08-27 — Movement VIII chartered: "The Living Void."** Decisions locked (partially amended same day — see next entry): the cursor becomes a lantern, and nearby ambient particles brighten and gently part around its light; music modulates the sky through *musical moments* (onset flux, never bass loudness) within a floor and a ceiling; each playing album draws a signature constellation — hash-seeded figure, palette color, duration-scaled sprawl — prerendered offscreen; the lantern cursor replaces the native pointer with an accent-rimmed core, wake, interactive ring, edge-chevron reveal, and a native I-beam yield on inputs; waveform-derived figures and similarity-clustered constellations are the north star beyond VIII; the folder-picker defers to Movement IX.
- **2026-08-27 — Ember particles deferred; browsing-floor backdrop experiments concluded.** After repeated roadblocks the canvas ember system was removed (`player.spectrum()` remains for a future pass). The floor then cycled through two replacements — a blurred-artwork backdrop, then a palette color wash masked so the horizon haze kept the floor — before both were reverted by design: the browsing floor is deliberately plain void, keeping the content surface calm. The archaic CSS starfield far plane (the source of the "random dots" on the timeline and elsewhere) was removed entirely. Meanwhile the "inaccurate UI colors" report was traced to hue derivation from near-neutral palette tones — a near-black dominant carries a mathematically arbitrary hue (landing on red) that the derivation's saturation floor then amplifies — and was **fixed** via chroma-weighted tone selection (`mostChromatic` in `palette.ts`) with a moonlight fallback for fully neutral palettes. No rescan was needed: stored palettes were always correct.
- **2026-08-27 — Movement VIII plan finalized.** Phase order amended by design discussion — Phase 3 lantern cursor, Phase 4 pointer bias (parallax), Phase 5 usability block, Phase 6 song-state effects (NEW: a solid corner-reticle framing the playing/selected song, and a dotted bracket plus a one-shot ripple on hovered rows — **solid means committed, dotted means preview**), Phase 7 **The Waveform Horizon** (NEW: a full-width waveform band across the timeline top, built from the Movement VI peaks pipeline, horizon-tinted and dim, with lyrics rendered over it and particles thrown from the playhead peaks on musical onsets; the haze gradient remains as the fallback until peaks are analysed, and a seek-on-waveform scrubber upgrade is the natural later step). Constellations move to the north star together with a possible library UI overhaul — including exploring a spatial, non-scroll alternative browsing view as an option, never a forced replacement.
- **Deferred:** now-playing display toggles v1 — superseded by art/title cycling + persisted default view; richer toggles may return later.
- **Deferred:** custom folder-picker UI (frosted card style) — native dialog currently in use; queued for polish pass.
- **Open riders:** BPM tag shown in metadata when present · minor visual tweaks flagged during Movement VI sign-off review · custom cursor that morphs into the expanded-view edge chevrons.

## Future Direction

Movement VIII — **The Living Void** — is chartered and phased (see ledger): the lantern cursor (3), pointer bias (4), the usability block (5), song-state effects (6), and The Waveform Horizon (7) — a full-width, horizon-tinted waveform band above the timeline with lyrics riding over it and particles thrown by the music's own onsets. Governing language: **solid means committed, dotted means preview**; music modulates through *moments*, never loudness; everything gated by the master and granular flags.

The north star beyond VIII: signature constellations growing into a navigable constellation map of the library — possibly a spatial, non-scroll alternative browsing view (prototyped as an option, never forced) — plus waveform-envelope figures, acoustic-similarity clustering, and the frosted folder-picker in Movement IX.

Beyond the charter: the frosted folder-picker and BPM-tag metadata stay open riders, waveform-envelope constellations may one day replace the hash seed, and acoustic-similarity clustering — constellations that drift toward albums that sound alike — remains the north star for a future movement.

## Known Behaviors

- First launch after an update runs a background rescan; palettes/cards refresh moments after boot (cached index paints instantly meanwhile).
- Sorting chip labels adapt per tab but occupy fixed 96px slots so the control bar never shifts.
- Artwork thumbnails (128px) are generated at scan and regenerated on demand: a missing thumbnail self-heals on its first request and then persists in the art cache.
