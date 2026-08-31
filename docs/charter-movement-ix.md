# Movement IX — The Crystal Atlas

**Charter v1 — chartered 2026-08-31. Status: chartered, not started.**

## Intent

The browse surface becomes a place, not a list. Three views — Artist, Song, Constellation — render the library with deliberate depth: a discography drawn as a star chart, a queue that recedes toward the horizon, and playlists reborn as plotted constellations. Depth is no longer decoration; it is the state grammar of the app. This charter supersedes the flat browse surfaces and retires the playing-row arrows.

## I. The Three Views

### Artist

The Albums and Artists tabs merge. A side-scrolling shelf of artists (gentle cover-flow, cards near the edges rotating slightly away) opens, on click, into an artist page: the artist's albums branch outward as chart nodes, distance mapped to time — **earlier = closer** — with unknown years drifting into a visually distinct "uncharted" cluster (fallback chosen against real library numbers during design). Album nodes open the existing detail stage unchanged. The page is library-derived only — **no external APIs — yet**: richer artist dossiers (cached, settings-gated bio/tags/image/similar via last.fm-style lookup, following the lyrics pipeline's precedent) remain a chartered rider.

### Song

Replaces the flat songs list entirely. A single perspective plane rises out of the horizon haze; each song is a crystal slab — **near = now, far = upcoming**. The playing song is the nearest and largest; sliding travels the queue along the plane. On click, a song shoots a shower of dust motes (the existing moments/mote pipelines, re-pointed). The flat list's virtualization concept carries over as a sliding window of live slabs; the code itself is rewritten.

### Constellation

The playlist successor. Songs are plotted as stars into draggable figures and connected by lines; positions persist in the existing playlist KV store (positions become a per-track field; store, ghost resolution, and reorder logic are inherited, not rewritten). Playback walks the figure. Plotting semantics — what edges mean, auto-layout versus manual — are locked in a dedicated design doc **before** any build. The playlist UI retires when this view reaches parity.

## II. The Depth Grammar

The state grammar extends into the third dimension: solid means committed, dotted means preview, and **near means now**. Depth encodes state — the playing song is never marked by an accessory; it is simply the closest thing to you.

Previews are a privilege of the near zone: only slabs within pointing distance respond to hover; distant crystals invite approach. The pause-with-resume audition machinery (850ms fade-out, exact-position restore, 950ms fade-in) is reused unchanged; only its trigger region changes. Every crystal also previews visually — its face carries the waveform silhouette from the Movement VI peaks pipeline; a glance replaces a snippet. Hover still never recolors the UI: slabs brighten, they do not change hue.

Navigation obeys the **compass pattern**: when the playing item drifts off-screen, a small star surfaces at the horizon; one call returns the view to it with the drift ease. The compass never moves the view automatically — approach is the user's; return is the compass's. The pattern generalizes across all three views (shelf → playing artist; constellation → playing figure).

## III. Material Law — Crystal

Glass is **painted, never frosted**. A crystal slab is layered translucent gradients (top face lighter, extruded faces darker), luminous 1px hairline edges, and a faint inner glow, tinted only by the accent chain. `backdrop-filter` is **banned inside 3D contexts** (Chromium flattens it under `preserve-3d`; it is also a per-frame cost). Ink keeps its legibility floors on translucent faces. A true cuboid is forbidden where a 2–3-face fake reads the same — three faces maximum per slab.

## IV. Motion & Typography in Depth

Plane rotation is static per view; only translations animate, compositor-only and quantized. Perspective angles stay gentle (~30–35°) with a generous near zone — foreshortened text must never cost legibility. Text on crystal faces is real DOM (crisp, selectable). Particles live on the existing screen-space mote canvas, never inside the plane. Every new motion registers with the motion-flag system at birth; the bezel and chrome remain motion-free.

## V. Performance Budget (acceptance criteria)

- 60fps sustained in the Song view at any scroll velocity, with ~15–25 live slabs and no main-thread per-frame work beyond transform writes.
- Zero `backdrop-filter` on any 3D-transformed element; zero animated blur-class filters anywhere new.
- Boot time unchanged; view switches stay under the current transition budgets (≤700ms class).
- The spike gate (Phase 2) may pause the movement if the material fails the feel-check.

## VI. Phases (in order)

1. **The Bezel** — merged single-row top chrome: wordmark removed; tabs (becoming the three views), summon-search center, contextual sort/filter marker on the active tab, status + gear island right. Lands with current tabs; tab labels evolve as each view arrives.
2. **The Spike** — one crystal slab on a throwaway branch: painted glass, fake cuboid, feel-check against Material Law. Cheap to revert; the movement's escape hatch.
3. **The Song View** — built to the feature-parity checklist (oracle song rows land at their crystal; add-to-playlist context menu has a home; queue panel untouched; sorts order the river via the tab marker). Flat list retires at parity.
4. **The Artist View** — after the year-tag audit; shelf + discography chart; albums tab retires at parity.
5. **The Constellation** — design doc first; playlist UI retires at parity.

## VII. Retirements & Absorptions

- **Retired:** flat songs list; Albums tab and carousel (absorbed by Artist); `arrowMarkers.ts` and the arrow pair; the designed-but-unbuilt hover glow.
- **Absorbed and kept:** `moments.ts` onset detector, the mote canvas and burst pipeline (re-pointed to crystal showers and Phase 7), the pause-with-resume preview machinery, the waveform peaks pipeline, playlist KV store, detail stage, horizon haze.
- **Amended:** Movement VIII Phase 6 closes as *superseded — assets absorbed*; Phase 7 (Waveform Horizon) continues and now decorates the horizon the crystals rise from; the folder-picker rider will be built in the new plate/crystal language.

## VIII. Aesthetic Contract Amendment (v2)

The line "Forbidden: … glassmorphism cards …" is replaced by:

> Forbidden: emoji as UI icons, frosted `backdrop-filter` surfaces on 3D-transformed elements, purple→blue gradient clichés, neon saturation, springy bounce easing, six-face cuboids where three faces suffice. The crystal material is permitted as painted translucency only: accent-chain tinting, luminous hairline edges, ink legibility floors, static per palette.

All other contract lines stand. Hover still never recolors the UI.

## IX. Open Questions & Riders

- Constellation plotting semantics (edges, auto-layout) — its design doc decides.
- Unknown-year fallback — decided against real library numbers during Phase 4 design.
- Artist dossiers — the cached, settings-gated online tier (bio/tags/image/similar, last.fm-style with optional keyless MusicBrainz/Wikidata tier) returns as a rider once the library-derived page ships.
- Keyboard navigation along the Song plane (e.g., arrows walk the river) — rider.
- Near-zone audio auditioning — if targeting proves fiddly at the spike, audio previews shrink to a fast-follow; visual waveforms are the floor.
- Pointer bias (VIII Phase 4) interplay with 3D planes — sky-plane parallax unaffected; the planes themselves may earn their own depth response later.
- Compass placement and exact form — decided during Phase 3 build (bottom horizon proposed).
- Renames: the movement name, view names, and any owner art for crystal states or the summon star remain owner riders.
