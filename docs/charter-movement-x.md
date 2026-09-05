# Movement X — The Universe

**Charter v1 — chartered 2026-09-05. Status: chartered; spike next. This charter is the project's sole active focus — every other open phase, rider, and idea is paused or subordinate until the spike verdict.**

## Intent

The library stops being lists and becomes a place you live in. The navigation model of the entire app is the cosmos itself: one night sky holds every artist as a star, the whole library as a ring of light around a black hole, and every playlist as a cluster of gathered stars. Clicking falls you inward — sky, artist, river — and Esc climbs back out. The tabs die; the summon remains. The app keeps one governing sentence: **the universe is where you choose, the river is what you see, the queue is what you hear.**

This charter was born from the 2026-09-05 owner sessions: the sky must be the place, not a border ("the cosmos is decoration on the chrome today"); the Listening View law (context surfaces must be momentary and cosmic, never docked) here becomes the whole navigation model.

## Primacy

Until the spike verdict, nothing else in the roadmap builds:

- **Movement VIII** — Phase 4 (pointer bias) pauses; it returns as the sky-parallax rider. Phase 7 (Waveform Horizon) is untouched and continues later.
- **Movement IX** — Phase 4 (Artist view) and Phase 5 (Constellation) are *realized inside the Universe* rather than built as separate surfaces; Phase 3's parity items carry into the Universe's parity checklist.
- **Open riders** (folder-picker, visual tweaks, owner art) — paused.

## I. The Three Places

Navigation is a two-zoom ladder. **Sky → artist view → river.** Esc climbs one level at a time; from the sky, Esc has nowhere further to go.

Clicking an artist star does not open a page — you **fall into the star**: it flares, the rest of the world dims, and the artist view assembles out of the light. This is the signature transition of the movement and must be transform/opacity only. Clicking an album cover falls a second time, into the river of that album. The old browse surfaces (tabs, carousel-as-browse, detail stage) have no place on the ladder; they retire at parity, dormant behind a body flag — never deleted (the flat-list law).

## II. The Dictionary of Objects

Every object class is distinct in silhouette — hole, star, swarm, figure — so the sky stays readable without labels; labels are hover-polish, never crutches.

- **The Black Hole** — the master playlist: all songs. A true-black disc (licensed exception: the no-pure-black law governs *backgrounds*; the disc is an object) ringed by a dense band of star-specks — **the ring is literally every song holding orbit**, so the glow grows with the library. Click opens the river of all songs; shuffling from it reshuffles the entire universe. It is the home: double-clicking the void returns there, and Esc climbs end there. It must read as majestic, never ominous — nothing about it says danger or delete.
- **Artist stars** — one star per credited artist. Size carries weight (song/album count); tint carries the artist's aggregate palette (top-3 dominant colors across their stored album palettes, computed once, deterministic). The playing artist's star wears the accent bloom — solid means committed, extended to the sky.
- **Playlist clusters** — an open star cluster per playlist; each tiny star *is* a song (very large lists render a visual cap with halo density carrying the rest). **Placement is meaning**: the cluster lives near its dominant artist's star — you can read a listener's taste by where their clusters orbit. Playlists with no dominant artist, and empty playlists, drift in the shallow band between constellations. An empty playlist renders as a **protostar** — a dim ember that ignites with its first song. The "focus threads" idea (lines from cluster stars to their source albums) is retired by design: albums no longer live in the sky; placement already tells the story.
- **The Compass** — a horizon star that returns the view to what is playing, never auto-following (the compass law, inherited). Sky level: flies to the playing artist's star. Artist level: marks the playing album on the shelf.
- **The Ambient Sky** — specks, rare travelers, the deep-field fade beneath the bezel hairline. Decoration only, gated by the ambient flag, compositor-only.

## III. The Queue Model

The queue stops being a list you manage and becomes wherever you are. Opening an album, a playlist, or the hole makes its songs the queue; **session shuffle is per-context**, extending the existing playlist shuffle machinery to every context. Summoning a song from search plays a queue of one — no context, no queue. The queue panel and the river's swipe-left append retire at parity (owner confirms at the verdict). Rearranging happens only in the river, with the existing gap-drag grammar; **the sky shows and never edits**.

## IV. The Artist View

The artist view is deliberately practical: the artist's name in ink, and one horizontal momentum shelf of square album covers — the Movement III carousel physics reborn (`ui/carousel.ts` re-homed) — **ordered by year, oldest first** (a career timeline; owner confirms at the spike), with the year in mono numerals beneath each cover. Clicking a cover falls into the river of that album.

Behind the shelf, the **artist's sky**: the background is decorated with stars and constellations tinted by the artist's aggregate top-3 colors, driven through the existing wash/ambient machinery — the same system that lets a playing song tint the horizon haze, re-pointed at an artist. The background is *decoration, never an object*: no frames, no shapes, nothing competing with the covers (sharp geometry reads as HUD — banked law). The "ghost star-album" (a star-painted album-cover silhouette) is a banked idea, revisited only if the view proves too plain; one small seeded signature constellation per artist is a parked rider.

## V. Layout Law — works for everyone

Nothing may assume the owner's library shape. The layout is one deterministic formula from 1 artist to 5,000: artist position = stable seed (name hash) + spacing/collision adjustment, **stable across launches**, recomputed only on rescan. Genre clustering does not exist — the library carries no genre data, and none is faked. Pan and zoom absorb scale: a small library fills the sky generously with no zooming needed; a huge library zooms out to a galaxy and in to a neighborhood. A single-artist library reads as a solar system — one great star with clusters in orbit — and that is correct. Collaboration credits stay whole for the spike (each credit string is its own star); splitting credits is a rider. An empty library renders the existing first-run guidance panel over an empty sky.

## VI. Material & Motion Law

The sky is painted light. Stars, halos, ring-specks, and constellation lines are pre-rendered once into static layers; the camera moves them by compositor transform only. `backdrop-filter` is banned as everywhere; no animated blur-class filters; no physics simulation, ever. Hover brightens, never recolors. Every new motion registers with the flag system at birth; ambient sky motion is gated by the ambient flag; view transitions stay in the ≤700ms class. The wheel zooms in the sky — the river keeps its scroll. Level-of-detail is a law, not a nicety: zoomed out, the sky is stars only; zooming in reveals labels. Density must never become dust.

## VII. Performance Budget (acceptance criteria)

- Pan/zoom sustains 60fps with no main-thread per-frame work beyond transform writes (prerendered layers + DOM/canvas click anchors).
- Layout computes on library change only; offscreen anchors are culled.
- Boot time unchanged; fall-into-artist and fall-into-river transitions stay within the ≤700ms class.
- The spike may pause the whole movement if the sky fails the owner's feel-check.

## VIII. The Bezel Endgame

During the spike the Universe is a temporary tab. At graduation the tabs retire — dormant behind a body flag, never deleted — and the bezel reaches its final form: **the summon trio alone at center, a whisper-quiet gear at the right edge, window controls at the shell's corner.** The compass lives in the sky, not the chrome. The undecided sort-popover rider dissolves with the tabs; sorts must be re-homed (contextually to the river — open question).

## IX. Phases

All work on branch `spike/universe` until the verdict.

1. **Spike v1 — the sky:** pan/zoom, deterministic artist stars, the black hole and its ring, the fall-into-artist transition, the artist view (shelf by year + tinted backdrop), album → river-in-context drill-through, the compass star, per-context shuffle. Then live with it.
2. **Spike v2 — after the v1 feel-check:** playlist clusters (protostars, dominant-artist placement, the shallow band), label/LOD polish, focus states.
3. **Graduation:** owner verdict. If the sky passes, the bezel diet and the retirements land.

Explicitly out of scope: genre anything, artist-to-artist relationship lines, physics, search-moves-the-viewport (rider), playlist figure threads (retired by design), HUD geometry, frost.

**Verdict ritual:** the old views remain intact and reachable until graduation; the verdict is the owner's, from living with it; nothing commits without the owner's approval.

## X. Relationship to the Other Movements

- **Movement IX** — Phases 4 and 5 are realized inside the Universe (the artist view and playlist clusters); Phase 3's parity items (oracle song rows, add-to-playlist home) carry into the Universe's parity checklist; the flat list stays dormant and retires unchanged.
- **Movement VIII** — Phase 4 returns as the sky-parallax rider; Phase 7 (Waveform Horizon) continues later, decorating the horizon beneath the sky.
- **Reborn** — `ui/carousel.ts` momentum physics becomes the artist shelf.
- The Listening View law — *context surfaces must be momentary and cosmic* — is the reason this charter exists: the Universe is that law made into the entire navigation.

## XI. Open Questions & Riders

- Shelf ordered by year (oldest first) — owner confirms at the spike.
- Playlist clusters in v2 (proposed) or pulled into v1 — owner confirms at the spike.
- Album custom order: the river can rearrange any context; does an album's hand-order persist (stored per-album order over track numbers) or stay session-only like shuffle? Decides store work in v2.
- Queue-panel and swipe-left retirement — owner confirms at the verdict.
- Re-homing sorts contextually as the tabs retire.
- Compass exact form per level; zoom LOD thresholds; label typography and visibility.
- Search flies the viewport to the found star — rider.
- Sky parallax (VIII Phase 4) — rider.
- Artist-view hover audio previews (the preview service is Songs-tab-gated today) — rider.
- Owner art for star, hole, and cluster states — rider.
