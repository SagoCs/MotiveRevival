# Movement X — The Universe

> **RETIRED 2026-09-13.** Superseded by `docs/charter-movement-x-v2.md` (The Library as Worlds). Kept on disk as the rejected-direction record, like the Listening View charter. The owner's verdict that retired it: the sky felt like "a very different art style from the rest of the application" — generated light where every other surface speaks in the library's own imagery. The night-sky spike this charter describes was deleted in Phase 0; the governing sentence survives in v2 with the shelf in place of the sky.

**Charter v2.1 — chartered 2026-09-05; amended 2026-09-06 in three strokes: the heart rewritten (the orb is every song, playlist stars halo the hole), the Deep Field added (population, weather, and light for the far sky), and the day's verdicts locked — hover constellations replace playlist hover text, album pins retire, and color is atmosphere, never structure. Status: chartered; spike in progress on `spike/universe`. This charter is the project's sole active focus — every other open phase, rider, and idea is paused or subordinate until the spike verdict.**

## Intent

The library stops being lists and becomes a place you live in. The navigation model of the entire app is the cosmos itself: one night sky holds every artist as a star, the whole library as a black orb at the heart, and every playlist as a gathered star in halo around it. Clicking falls you inward — sky, artist, river — and Esc climbs back out. The tabs die; the summon remains. The app keeps one governing sentence: **the universe is where you choose, the river is what you see, the queue is what you hear.**

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

Every object class is distinct in silhouette — hole, round star, four-point sparkle, figure — so the sky stays readable without labels; labels are hover-polish, never crutches.

- **The Black Hole** — the master playlist: all songs. A true-black disc (licensed exception: the no-pure-black law governs *backgrounds*; the disc is an object) — **the orb is every song; there is no separate band of song-specks.** It is a constant presence: same size, same dimness at any library size, never brightening or swelling with song count — growth reads in the stars around it, never in the heart. Click opens the river of all songs; shuffling from it reshuffles the entire universe. It is the home: double-clicking the void returns there, and Esc climbs end there. It must read as majestic, never ominous — nothing about it says danger or delete.
- **Artist stars** — one star per credited artist. Size carries weight (song/album count); tint carries the artist's aggregate palette (top-3 dominant colors across their stored album palettes, computed once, deterministic). The playing artist's star wears the accent bloom — solid means committed, extended to the sky. Albums are never sky objects (amended 2026-09-06): the pin-to-constellation satellites, the "ring holds eight" cap, and their stored pins retire at the next build step; albums live only in the artist/album navigation.
- **Playlist stars** — one clean four-point star per playlist (amended 2026-09-06: the per-song cluster retires, and the shallow band with it). They live in a **loose organic halo around the Black Hole** — the court of the heart. **Position is meaning, two-part**: the direction faces the playlist's dominant artist's star (same-artist playlists form short radial strings pointing heart-ward; a stable hash-scattered angle when no artist holds a majority), and the distance from the orb reflects the playlist's size — **bigger = closer**, with a hard floor: a fixed respectful gap of void between the orb's edge and the nearest possible star, at any library size. Sizes are **relative to the library**: a fixed min→max band — the largest playlist always rides the max, the smallest the min, mid-sized lists spread between — kept organic by a gentle stable wobble (radial plus a slight angular fan), never a drawn circle. A **proportional glow** is the halo's aura: subtle, static, painted once in the playlist's own blended hue, sized with its star, always quieter than hover; animated glow is banned here. The grammar is color-independent by design — it survives any future decision about the sky matching the playing song. Hover speaks name · count, and raises the **constellation**: faint temporary threads to the playlist's heaviest source artists — the dominant thread brightest, capped at the top few — those artists brightening as the rest of the sky dims a touch, all dissolving on leave. The constellation is momentary, cosmic in kind (the summon-drawer model); permanent wiring stays retired. An empty playlist renders as a **protostar**: a dim ember at minimum size, seated among the others, igniting with its first song.
- **The Compass** — a horizon star that returns the view to what is playing, never auto-following (the compass law, inherited). Sky level: flies to the playing artist's star. Artist level: marks the playing album on the shelf.
- **The Ambient Sky** — the far field (the Deep Field pass, below), rare travelers, the deep-field fade beneath the bezel hairline. The paint is static; only its motion (twinkles, travelers) is gated by the ambient flag, compositor-only.

## III. The Queue Model

The queue stops being a list you manage and becomes wherever you are. Opening an album, a playlist, or the hole makes its songs the queue; **session shuffle is per-context**, extending the existing playlist shuffle machinery to every context. Summoning a song from search plays a queue of one — no context, no queue. The queue panel and the river's swipe-left append retire at parity (owner confirms at the verdict). Rearranging happens only in the river, with the existing gap-drag grammar; **the sky shows and never edits**.

## IV. The Artist View

The artist view is deliberately practical: the artist's name in ink, and one horizontal momentum shelf of square album covers — the Movement III carousel physics reborn (`ui/carousel.ts` re-homed) — **ordered by year, oldest first** (a career timeline; owner confirms at the spike), with the year in mono numerals beneath each cover. Clicking a cover falls into the river of that album.

Behind the shelf, the **artist's sky**: the background is decorated with stars and constellations tinted by the artist's aggregate top-3 colors, driven through the existing wash/ambient machinery — the same system that lets a playing song tint the horizon haze, re-pointed at an artist. The background is *decoration, never an object*: no frames, no shapes, nothing competing with the covers (sharp geometry reads as HUD — banked law). The "ghost star-album" (a star-painted album-cover silhouette) is a banked idea, revisited only if the view proves too plain; one small seeded signature constellation per artist is a parked rider.

## V. Layout Law — works for everyone

Nothing may assume the owner's library shape. The layout is one deterministic formula from 1 artist to 5,000: artist position = stable seed (name hash) + spacing/collision adjustment, **stable across launches**, recomputed only on rescan. The inner court belongs to the heart: the hole and its playlist halo own the center, and artist seeds fall beyond the halo's outer edge. Structure is implied, never drawn — the weight-band contour rings retire; at most extremely faint, irregular arcs may remain as atmosphere. Genre clustering does not exist — the library carries no genre data, and none is faked. Pan and zoom absorb scale: a small library fills the sky generously with no zooming needed; a huge library zooms out to a galaxy and in to a neighborhood. A single-artist library reads as a solar system — one great star with the playlist halo circling the heart — and that is correct. Collaboration credits stay whole for the spike (each credit string is its own star); splitting credits is a rider. An empty library renders the existing first-run guidance panel over an empty sky.

## VI. Material & Motion Law

The sky is painted light. Stars, halos, glow auras, and constellation lines are pre-rendered once into static layers; the camera moves them by compositor transform only. `backdrop-filter` is banned as everywhere; no animated blur-class filters; no physics simulation, ever. Hover brightens, never recolors. Every new motion registers with the flag system at birth; ambient sky motion is gated by the ambient flag; view transitions stay in the ≤700ms class. The wheel zooms in the sky — the river keeps its scroll. Level-of-detail is a law, not a nicety: zoomed out, the sky is stars only; zooming in reveals labels. Density must never become dust. Color is atmosphere, never structure (amended 2026-09-06): star color is identity and never moves; the playing song recolors only the environment — nebulae, hole glow, ambient washes — through the accent chain, re-tinted only on song change; and the sky must read in grayscale — shape, size, position, glow, and labels carry the meaning without hue.

### The Deep Field (added 2026-09-06, owner-settled)

The sky's realism lives in the unnamed light — populations, weather, and interaction, not more objects. Every item below is pre-rendered once into static layers the camera moves by transform: boot-paint cost, never frame cost. The owner's mock (`docs/universe-mock.png`) is the painting reference — steal its grammar, never its pixels, and run dimmer than it at rest.

- **The far field** — thousands (target 2,500–4,000) of unnamed stars painted onto two or three canvas sheets; the DOM-speck era ends. Brightness follows the real-sky drop-off (many faint, few bright); colors are star temperatures — blue-white through white to warm orange, rare deep reds; the violet dust families retire. Positions clump, with a loose diagonal corridor of extra density.
- **The band is emergent** — never painted. Zooming out merges the corridor into a river of unresolved starlight by itself; the weather veil only adds texture over it.
- **Star variety** — artist stars roll stable per-star recipe slots from their seed (core heat, bloom width, rim character); hue never moves — identity color is law; majors wear four-point glints echoing the playlist sparkle. The round-star species law holds: variety is in the burn, never the shape.
- **The weather** — nebulae gain structure: layered smooth noise dragged into wisps and dark lanes, painted small and upscaled (they are blurry by nature), a pinch of grain against gradient banding. Structure is painted as shape so the playing song can pour color in.
- **The light touches** — baked interaction, painted close to its source's depth plane so parallax cannot shear it: the hole's accretion light rims the inner edge of the playlist court; major stars sit in faint dust pools; nebulae brighten toward dense artist neighborhoods.
- **The range** — a handful of brilliant points against real darkness; never a global lift (that is how dust happens). **The crown is the hole's**: its accretion rim owns the single brightest point in the sky.
- **The atmosphere split** — objects are stable, air breathes: field dots keep fixed star-temperature colors; the nebulae and hole glow ride the playing song through the accent chain, re-tinted only on song change.
- **The twinkle** — a sparse handful of far-field stars twinkle, opacity-only, gated by the ambient flag (the meridian starfield's precedent, re-homed to the sky).

## VII. Performance Budget (acceptance criteria)

- Pan/zoom sustains 60fps with no main-thread per-frame work beyond transform writes (prerendered layers + DOM/canvas click anchors).
- Layout computes on library change only; offscreen anchors are culled.
- Boot time unchanged; fall-into-artist and fall-into-river transitions stay within the ≤700ms class.
- The spike may pause the whole movement if the sky fails the owner's feel-check.

## VIII. The Bezel Endgame

During the spike the Universe is a temporary tab. At graduation the tabs retire — dormant behind a body flag, never deleted — and the bezel reaches its final form: **the summon trio alone at center, a whisper-quiet gear at the right edge, window controls at the shell's corner.** The compass lives in the sky, not the chrome. The undecided sort-popover rider dissolves with the tabs; sorts must be re-homed (contextually to the river — open question).

## IX. Phases

All work on branch `spike/universe` until the verdict.

1. **Spike v1 — the sky:** pan/zoom, deterministic artist stars, the black hole with the playlist halo around it, the Deep Field far sky (population, weather, light), the fall-into-artist transition, the artist view (shelf by year + tinted backdrop), album → river-in-context drill-through, the compass star. Then live with it.
2. **Spike v2 — after the v1 feel-check:** per-context shuffle, label/LOD polish, focus states.
3. **Graduation:** owner verdict. If the sky passes, the bezel diet and the retirements land.

Explicitly out of scope: genre anything, artist-to-artist relationship lines, physics, search-moves-the-viewport (rider), permanent playlist-to-artist wiring (the hover constellation is the only thread the sky ever shows), animated halo glows, HUD geometry, frost.

**Verdict ritual:** the old views remain intact and reachable until graduation; the verdict is the owner's, from living with it; nothing commits without the owner's approval.

## X. Relationship to the Other Movements

- **Movement IX** — Phases 4 and 5 are realized inside the Universe (the artist view and the playlist halo); Phase 3's parity items (oracle song rows, add-to-playlist home) carry into the Universe's parity checklist; the flat list stays dormant and retires unchanged.
- **Movement VIII** — Phase 4 returns as the sky-parallax rider; Phase 7 (Waveform Horizon) continues later, decorating the horizon beneath the sky.
- **Reborn** — `ui/carousel.ts` momentum physics becomes the artist shelf.
- The Listening View law — *context surfaces must be momentary and cosmic* — is the reason this charter exists: the Universe is that law made into the entire navigation.

## XI. Open Questions & Riders

- Shelf ordered by year (oldest first) — owner confirms at the spike.
- Playlist halo placement — settled 2026-09-06: pulled into v1 with the black hole; distance grades by size (bigger = closer, hard floor at the orb's edge), direction faces the dominant artist (see Dictionary).
- Album custom order: the river can rearrange any context; does an album's hand-order persist (stored per-album order over track numbers) or stay session-only like shuffle? Decides store work in v2.
- Queue-panel and swipe-left retirement — owner confirms at the verdict.
- Re-homing sorts contextually as the tabs retire.
- Compass exact form per level; zoom LOD thresholds; label typography and visibility.
- Search flies the viewport to the found star — rider.
- Sky parallax (VIII Phase 4) — rider.
- Artist-view hover audio previews (the preview service is Songs-tab-gated today) — rider.
- Owner art for star, hole, and halo states — rider.
