# Spike Brief — River v2 (working title)

Status: DRAFT for owner review. Nothing below is built. On approval this document
seeds the spike's HANDOFF.md and the branch is created.

## What this spike is

A standalone river lab at `sandbox/river/` in MotiveRevival, on its own branch
(`spike/river-v2`), rebuilding the river surface: the painted-slab glide view the
music app uses for Songs, and will use for artist albums and album songs. One
surface, parametric layout, tested motion, two card recipes.

The MotiveMKII rigor, the app's own sandbox pattern (`sandbox/universe`,
`sandbox/space`): own Electron window, own CDP port, own esbuild build, probe
scripts in `scripts/`, fake-but-real-shaped data, a HANDOFF doc, and a suite that
is the regression net. Because it lives in this repo it imports the real
`tokens.css` and fonts — look decisions are judged in the true skin.

Graduation path (the crystal-river precedent): lab → owner feel-checks → the core
becomes the new `songRiver` internals behind the existing integration points.

## What this spike is NOT

- No app behaviors: no audio previews, no queue, no playlists, no accent-theming
  logic. Those wire up app-side through the contract.
- No star/universe choreography (mote flights, camera anchoring, artist name
  overlay) — a future consumer of this surface, not this spike.
- No data truth: fake-but-real-shaped data only. The live Songs view is untouched.

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
  performance bar this spike must beat.
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
  exit is the same curve walked backward.
- Events out: `entryActivated(id)`, `settled()`, `visibleWindowChanged(range)`.
- Anything not reachable through this contract does not exist.

## Requirements (each with its acceptance test)

- **R1 Parametric layout.** Any region × any visible count, no clipping, no
  constant coupling. Test: sweep region sizes × counts (3–12), assert every
  visible card lies fully inside the region.
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

## Test envelope (test the app's usage, not the demo's)

- Entry counts: 1, 5, 12, 30, 200.
- Regions: full viewport, half-screen left/right, short strip; resize mid-scroll
  and mid-entrance.
- dpr 1 and 2; simulated refresh 60 and 120+.
- Input: wheel, drag/fling, programmatic scrollTo.
- Motion-disabled mode (instant placement, no timeline).
- Headless probes through the lab's own CDP port (the `probe-sandbox.mjs`
  pattern: raw-socket CDP, PNG decode, pixel asserts).

## Deliverables

- `sandbox/river/` harness: Electron main (frameless window, CDP port), esbuild
  script, npm scripts (`build:river-lab`, `river-lab`, `probe:river-lab`).
- Core source: layout, motion, slabs, timeline.
- Demo modes in the harness: region/entry-count/card-recipe modes,
  entrance/reverse scrubber, frame-time HUD.
- `scripts/probe-river-lab.mjs` suite wired to R1–R7.
- `HANDOFF.md` in the sandbox folder (this brief seeds it).
- Fake data in the app's entry shape.

## First spike inside the spike (decides an open question, evidence only)

DOM-vs-canvas slabs: build the first meter of both, frame-time them under fling
and slow scroll. DOM is the default (the measure pass showed it compositor-cheap);
canvas is chosen only if DOM misses R5. Text crispness and hit-testing stay DOM
side either way.

## Open decisions (owner)

- Branch name: `spike/river-v2` (default) or folded into `spike/universe`.
- Lab shape: standalone `sandbox/river/` window (default, recommended) or a
  hidden surface inside the live app behind a flag.

## Future consumers (banked 2026-09-11, NOT this spike's scope)

Artist view transition: star anchors left; artist name displayed above it; motes
flash, fly right as one group, first visible card morphs (newest album first),
remaining visible cards stagger in, then the surface is scrollable; exit is the
same machinery in reverse. These become payload requirements on `reveal()` when
the transition phase starts — the contract reserves for them now.
