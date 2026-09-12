# Spike Brief — River v2 (working title)

Status: APPROVED by owner 2026-09-11 — the drill grammar below (Future
consumers) was settled in session the same day. Nothing is built yet; this
document seeds the spike's HANDOFF.md. Decided: branch `spike/river-v2`
(exists); delivery vehicle is the hidden in-app view (see What this spike is) —
the draft's standalone `sandbox/river/` lab is superseded.

## What this spike is

A new river surface built inside the live app, on branch `spike/river-v2`: the
painted-slab glide view the music app uses for Songs, and will use for artist
albums and album songs. One surface, parametric layout, tested motion, two card
recipes.

Delivery vehicle (owner ruling 2026-09-11, superseding the draft's standalone
`sandbox/river/` lab): a hidden in-app view behind a debug key — pressed, the
v2 river swaps into the Songs tab's slot over the real chrome; pressed again,
the live river returns. The crystal-river precedent (the F9 stress rig that
became the live Songs view). Real library data from day one; measurements run
through the app's own CDP port — the verification-ritual channel — so the
performance bar is judged in the exact environment it was measured in.

Graduation path (the crystal-river precedent): lab → owner feel-checks → the core
becomes the new `songRiver` internals behind the existing integration points.
First consumer is the universe drill-through (see Future consumers); the
Songs-tab swap follows it.

## What this spike is NOT

- No app behaviors: no audio previews, no queue, no playlists, no accent-theming
  logic. Those wire up app-side through the contract.
- No star/universe choreography (mote flights, camera anchoring, artist name
  overlay) — a future consumer of this surface, not this spike.
- No data truth: the surface renders generic entries and knows nothing about
  songs or albums. The live Songs river's code is untouched — v2 is a parallel
  module, not an edit of it.

## Why (the evidence, from the 2026-09-11 measure pass)

The current in-app river is a 21-card recycled ring on a hand-tuned curve. It
works and feels good, but measurement showed:

- Layout constants are coupled (GAP 145px, card 520×140, 21 slabs, curve 0.55).
  Visible count is not a parameter (≈ viewport height ÷ 145 ≈ 6.7); changing
  values clips cards or shrinks the visible set.
- The slow-scroll shimmer was self-inflicted rounding: scale quantized to 0.01
  steps (5.2px pops on a 520px card), oscillating at rounding boundaries. Fixed
  in-app by continuous writes (`cf3368a`); the law is below and is binding here.
- The browser is exonerated: 0 layout / 0 style-recalc / 0 paint during scroll at
  any velocity; the loop parks at idle. DOM transforms are compositor-cheap here.
- Fling ceiling: ~61fps during flings on a ~170Hz display. That is the
  performance bar this spike must beat — measured in-app, and the replacement
  is judged in the same app, so the comparison is apples-to-apples.
- The recycle moment (a card rebinds to the opposite end of the ring) jumps
  visibly (~144px position, ~36px size). Cards must rebind only while invisible.

## Design laws (binding)

1. Motion values round to whole device pixels of visible effect — position to the
   device-pixel grid (1/dpr); scale, tilt, opacity are never rounded.
2. Motion writes transforms/opacity only; drift easing (cubic-bezier(0.16,1,0.3,1));
   no springy bounce; entrance beats live in the 400–700ms class.
3. Painted, never frosted: no backdrop-filter, no blur that animates.
4. Deterministic core: same data + same inputs → same layout; the entrance
   timeline is time-parameterized so tests can freeze it mid-flight.
5. The rAF parks at idle: zero writes when settled.
6. Strict TypeScript, zero comments, no libraries.

## The contract (what the app will call)

- `mount(region, dpr)` — layout derives from an arbitrary rectangle; never
  assumes fullscreen.
- `setEntries(entries)` — generic entry: `{ id, art?, title, meta[], badge? }`.
- `visibleCount` as a layout parameter (3–12); geometry is derived, never tuned.
- Built-in wheel/drag/fling input; `scrollTo(index, { animate })` exposed.
- `reveal()` / `collapse()` — ONE entrance timeline with a direction parameter;
  exit is the same curve walked backward. `collapse` carries the spread exit
  (R8): an animated spacing multiplier opens the river around an entry while
  the other cards fade.
- `entryRect(id)` — the on-screen rectangle of a live card, so a caller can
  grow another surface (the album square) from the exact pixels; paired with
  `hideEntry(id)` — the river drops its copy at handoff so the card is never
  double-drawn.
- Events out: `entryActivated(id)`, `settled()`, `visibleWindowChanged(range)`.
- Rivers are instances from a factory, never a singleton — several may be alive
  at once (the album→songs handover overlaps an exiting album river with an
  entering song river).
- Anything not reachable through this contract does not exist.

## Requirements (each with its acceptance test)

- **R1 Parametric layout.** Any region × any visible count, no clipping, no
  constant coupling. Test: sweep region sizes × counts (3–12), assert every
  visible card lies fully inside the region AND adjacent visible cards never
  intersect each other, at rest and across the whole scroll range — the live
  river's clipping failure was card-on-card, not card-on-region.
- **R2 Zero shimmer.** Slow scroll at simulated 60 and 120+ Hz, dpr 1 and 2.
  Test: per-frame transform traces show no rounding steps; pixel-burst diffs in
  card interiors stay under threshold.
- **R3 Glide feel preserved.** Port the current physics (velocity impulse ×2.8
  per wheel notch, clamped; exponential decay 3.1/s; glide-to-center quartic
  ease, 700ms). Test: owner feel-check against the live river.
- **R4 Two card recipes.** Art slab (art + title + meta) and artless slab (tinted
  ground + typographic title + meta), one shared slab grammar.
- **R5 Performance bar.** Fling sustains high refresh (target ≥120fps at 1080p in
  the lab; in-app baseline ~61fps); scroll keeps Layout/Style/Paint at 0/0/0.
- **R6 Reveal and reverse.** Entrance lands every card pixel-exactly on its final
  position; exit is the reversed curve; a mid-timeline freeze is byte-stable.
- **R7 Invisible recycle.** Rebinds happen only off-screen or fully faded; no
  visible pop at slot rotation.
- **R8 Spread exit.** The river opens around an entry: an animated spacing
  multiplier pushes the other cards apart along the river's own axis while
  they fade — the album→songs handover move (the chosen entry itself may
  already be hidden at handoff via `hideEntry`). Test: forward and reverse
  traces are mirror-identical; a mid-spread freeze is byte-stable.

## Test envelope (test the app's usage, not the demo's)

- Entry counts: 1, 5, 12, 30, 200.
- Regions: full viewport, half-screen left/right, short strip; resize mid-scroll
  and mid-entrance.
- dpr 1 and 2; simulated refresh 60 and 120+.
- Input: wheel, drag/fling, programmatic scrollTo.
- Motion-disabled mode (instant placement, no timeline).
- Feed: the real library by default (songs; albums-as-entries); synthetic
  entry lists through `setEntries` for the count sweeps.
- Headless probes through the app's own CDP port (`--remote-debugging-port`,
  the verification-ritual channel; the `probe-sandbox.mjs` pattern: raw-socket
  CDP, PNG decode, pixel asserts).

## Deliverables

- The v2 surface as its own renderer module — layout, motion, slabs, timeline;
  contract-only, no app imports beyond what the debug wiring hands it.
- Debug-key wiring: the swap into the Songs slot and back, plus a debug HUD on
  the surface (region/entry-count/card-recipe overrides, entrance/spread/
  reverse scrubber, frame-time readout) — all debug apparatus removed at
  graduation.
- `scripts/probe-river-lab.mjs` suite wired to R1–R8 through the app's CDP port.
- `docs/handoff-river-v2.md` (this brief seeds it).

## First spike inside the spike (decides an open question, evidence only)

DOM-vs-canvas slabs: build the first meter of both behind the debug key (a
backend toggle on the v2 surface), frame-time them under fling and slow scroll.
DOM is the default (the measure pass showed it compositor-cheap); canvas is
chosen only if DOM misses R5. Text crispness and hit-testing stay DOM side
either way.

## Decided (were open in the draft)

- Branch: `spike/river-v2` (created; not folded into `spike/universe`).
- Delivery vehicle: hidden in-app view behind a debug key, swapping over the
  Songs tab slot — real chrome, real data, the app's own CDP port. Owner
  ruling 2026-09-11; supersedes the draft's standalone `sandbox/river/` lab.

## Future consumers (agreed with owner 2026-09-11, NOT this spike's scope)

The universe drill-through — the first consumer of this surface. The grammar,
one ladder walked forward and in reverse:

- Star click: the other stars and dust fade out, then freeze about half a
  second later (universe side); the camera carries the chosen star to a left
  anchor. The camera moves only here — every other move in the drill happens
  in screen space on top of the frozen sky. Albums reveal right of the star
  (motes flash, fly right as one group, become the first visible entries
  newest-album-first, the rest stagger in — the banked transition, unchanged);
  artist name above the star.
- Album click: the clicked card expands into a square of its art, parked on
  the right where the river stood (FLIP from `entryRect`; the river hides its
  copy at handoff). The other entries spread and fade (R8); the star and the
  artist name fade out; the song river staggers in on the left, where the star
  was.
- Exit: the same machinery in reverse — songs collapse, cards unfade and
  return (reverse spread), the square shrinks back into its card, the star
  relights, the sky thaws.

Owner rulings recorded 2026-09-11: the square parks on the right (a clean
separation between album and song); the artist name fades entirely and may
return later as a caption under the square if missed; what clicking the square
does (play the album, open now-playing) is parked until the view is built.
