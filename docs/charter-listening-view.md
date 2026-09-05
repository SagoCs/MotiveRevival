# The Listening View — Side Panels Charter

**REJECTED 2026-09-05 after live review — kept on disk as a record of the experiment. The implementation is preserved in git stash "listening-view v3 full snapshot". See the README ledger entry of the same date for the verdict and the banked law: the river's power is the void around it; context surfaces must be momentary and cosmic in kind, never docked player chrome.**

**Charter v3 — chartered 2026-09-05; amended 2026-09-05 (v2: glass, width, secondary panel; v3: in-place drill, throw-to-summon, legacy retirement). Status: Phase A shipped 2026-09-05; Phase C reworked to v3; Phases D–E open.**
**Provenance:** owner concept docs (`Motive_New_Navigation_Concept.md`, `Motive_Queue_Playlist_UI_Design_Guidance.md`), decisions locked in sessions 2026-09-05.

## Intent

The song river stops being a lone column in an empty void. It becomes the center of a three-zone instrument: **source on the left, music in the center, trajectory on the right.** The playlists panel answers *where is this music coming from*; the river answers *what am I listening to*; the queue answers *where is the music going*. Each part of the music experience gains a clear spatial role, and the river's unused flanks start working — without breaking the negative-space aesthetic.

This charter is a Movement IX insert: it lands between Phase 3 (Song view parity) and Phase 4 (Artist view), amends Phase 3's "queue panel untouched" clause, and delivers Phase 5's "playlist UI retires" retirement early. The cosmic/Universe layer is explicitly **out of scope** — this build is structure and usability; the cosmos is layered on later (Section IX).

## I. The Three Zones

- **Left — Playlists (source):** calm and static. A scannable list of playlist names; the active source is marked. Navigation, not management.
- **Center — Song River (music):** untouched. Painted slabs, glide physics, edge fades, center glow, commit/preview grammar all behave exactly as today.
- **Right — Queue (trajectory):** more dynamic than the left. Now Playing on top, Up Next beneath, drag-reorder, remove, hover audition.

Hierarchy is enforced by brightness, not boxes: the river stays the loudest surface on screen.

## II. Layout Law — Overlay, Never Push

Panels **overlay** the river's edge zones; the river never re-flows. Toggling a panel must not re-lay-out the river, recompute its physics, or move its center glow — the void's flanks are already empty, and the panels live there. Panels carry the glass fill defined by Material Law, so slabs gliding beneath them read as depth through the blur; the river's own edge fades remain the panels' backdrop.

- Rough proportions 20 / 60 / 20; the docks are ~320px wide (amended from 280px), plus the secondary playlist panel when summoned. The center always wins — below ~1100px of window width, panels vanish entirely.
- Panels hide automatically while a detail or playlist layer is open, in step with the horizon veil and lyric orb.

## III. Material Law — Glass on the Frame

**Amended v2 — the docks are glass instrument panels.** The v1 law (frameless ink, frost banned outright) is superseded for the flat docks: a *slight* glass is their material — `backdrop-filter` blur held small (~12–16px), a void-tinted translucent fill (~65–75% opacity), a faint top-edge light line for the glass read, and the 1px hairline kept. Filter values are **never animated**, and the blur radius stays static per palette; ink keeps its legibility floors over the glass. This is legal because the original frost ban targeted 3D contexts (Chromium flattens `backdrop-filter` under `preserve-3d`) — the docks are flat fixed overlays, where glass is safe. The crystal law stands untouched for every 3D surface. Retreat clause: if measured cost over a moving river disappoints, the docks fall back to a layered translucent gradient that reads as glass at zero filter cost — decided by measurement, not by eye.

- Panel typography: tiny tracked-caps header (`PLAYLISTS` / `NOW PLAYING` / `UP NEXT`), whisper-tier ink below (~70% luminance), smaller than river type.
- Playlist rows: bare ink names with mono counts. Queue rows: IBM Plex Mono numerals + small art chips (32–40px) + two-line ink (title over artist).
- One 1px hairline divides panel from river — matched to the bezel edge formula.
- Selected source and playing queue row: solid left bar + full-strength accent (solid = committed). Hover: the static diluted CSS highlight only — hover never recolors the UI, per the standing contract.
- Secondary actions (remove, rename, delete) live in context menus and hover affordances, never as permanent per-row buttons.

## IV. Behavior

**Defaults.** At boot the playlists panel is open and the queue panel is closed — an empty queue must not ship as an empty box. The queue panel auto-opens the first time a song commits (while the listening view is on screen); a manual close sticks for the rest of the session. *Rider: the auto-open rule is revisitable after live use.*

**The soft swap (source model).** Clicking a playlist in the panel changes the *source and the queue's trajectory* — but **never interrupts the current song**. The playing song finishes naturally; the queue panel shows it as NOW PLAYING above the new source's Up Next. The way music starts is by committing a card in the river — the panel never starts, stops, or skips audio. Corollaries:

- Clicking the already-active source is a no-op that glides the river back to the playing card.
- An empty playlist renders a one-line ink note, not an error surface.
- The active source persists through restart via the existing session-resume.
- The river displays the source's song slice; the immortal `<audio>` element and playback internals are never touched by panel navigation (Invariant 1).

**Collapse.** Each panel collapses via a small glyph on its inner edge; collapsed, it slides out by `transform: translateX` + opacity only. Re-opening happens from the same edge. Never animate width.

## V. The Playlist Home — the Drill and the Throw

**Amended v3 — one panel, two states, thrown open.** The left panel is a single column with two stacked views. At rest it lists playlists. Clicking a playlist **drills in place**: the songs view slides in from the right as the list exits left (transform/opacity only) — same glass, same width, its own header carrying the back chevron, the playlist's name, its meta line, and play/shuffle. ESC drills back out; the chevron does the same for the mouse. Song rows carry each track's album-art chip (queue-identical thumbnails), two-line ink, duration, the pause-with-resume audition on hover, click-to-commit (the queue follows the playlist's context), hover ✕ remove, and the queue's drag-reorder grammar; the playing row wears the solid accent bar.

**The throws summon the panels (v3).** The river's card drags become the panels' summon gestures, side-swapped to match the zone grammar: **throw a card left** (toward the source zone) and the **playlists panel** opens on the left with the song in hand — the floating picker's contents (add-marks, the inline New-playlist input) now live inside it; clicking a row files the song. **Throw a card right** (toward the trajectory zone) and the **queue panel** opens on the right with the song appended. The gestures swap sides versus their pre-v3 meanings — accepted for spatial truth, owner-confirmed. While the drag is short of the commit line, the target panel **peeks** proportionally to the card's displacement (peeking is preview); release commits it solid; release short retreats it with the card. The edge grips remain as quiet click-to-toggle fallbacks.

**Retired with v3:** the edge glow circles, the swipe prompt texts, and the floating `#river-names` picker (recoverable in git history).

The Playlists tab retires when this charter reaches parity — the panel becomes the playlist surface's only home.

- Creation: the throw state's inline "New playlist" input (and, after Phase E, the panel at rest).
- Rename/delete: context menus on panel rows (existing grammar).
- Playlist-list reordering: deliberately not built.
- The fullscreen playlist detail layer continues serving the Playlists tab until Phase E retires the tab.

## VI. The Transport

The queue toggle button is removed from the bottom transport **in both views** — normal and expanded. The freed space is rebalanced: the icon row's spacing and centering readjust so no gap reads as a wound. The loop toggle, volume cluster, and lyric orb are untouched. **The expanded view carries no panels, ever** — it is a listening surface, not a management surface; this is by design, not an omission.

## VII. State & Performance Law

- Panels are pure subscribers: `player.bus`, `appBus`, `playlistsStore`, `libraryStore`. Bind-once listeners; zero duplicate playback or playlist logic; the queue reflects the single source of truth.
- Motion: transform/opacity only; zero animated blur-class filters; no `backdrop-filter` anywhere in this charter; no new rAF loops (no new animation surfaces exist here).
- Lists are small — no virtualization. The queue's drag grammar is inherited (the panel renders its own full rebuild); nothing here rewrites playback-adjacent logic.
- Wheel scoping: the river's wheel-anywhere handler yields when the pointer is over a scrollable panel; panel lists scroll internally.
- Any future reactive flourish on the playing queue row inherits the existing pulse flag — nothing here introduces ungated motion.

## VIII. Phases (in order)

1. **Phase A — The Frame.** Three-zone layout with overlay panels; queue panel relocated (logic inherited from `queuePanel.ts`); playlists panel as read-only navigation; collapse glyphs; transport queue button removed in both views with row rebalance. **SHIPPED 2026-09-05.**
2. **Phase B — The Glass.** Docks widened to ~320px; glass material per amended Material Law; blur strength, fill opacity, and ink tiers tuned live; legibility and frame cost verified over a moving river by measurement (CDP probes), with the gradient fallback as the escape hatch.
3. **Phase C — The Panel and the Throw.** In-place drill (list ⇄ songs views, art-chip rows, click-to-play commit, audition hover, play/shuffle head, hover ✕, drag reorder); throw-to-summon with side-swap and peek physics; the picker, edge glows, and swipe prompts retired; the fullscreen layer retires from the river context. **Built 2026-09-05 to v3 (supersedes the v2 secondary column).**
4. **Phase D — The Source.** The remaining soft-swap model: source marking in the list (solid left bar), already-playing no-op glide back to the card, empty-playlist ink note, queue auto-open on first commit, session-resume persistence of the active source.
5. **Phase E — The Retirement.** Playlists tab removed; the panel owns creation, rename, and delete.

## IX. Future-Proofing for the Cosmos

The Universe layer (artist stars, constellations, nebulae, orbital visualizer) is layered on **after** this structure stands. The panels must therefore keep clean component boundaries and own no decorative backgrounds — nothing baked into the playlist or queue components that the cosmic pass would have to cut out. The panels' scrim and hairline are the only surfaces the cosmos will re-skin.

## X. Open Questions & Riders

- Auto-open rule for the queue panel — revisit after live use (owner reserved this).
- Glass strength, dock width, and ink tiers — tuned live during Phases B–C, as is house custom; the gradient fallback is the standing escape hatch if measured cost over a moving river disappoints.
- Expanded-view queue glance (a way to peek at Up Next from the expanded view without panels) — consciously out of scope; revisit only if the owner misses it.
- The throw-to-summon side-swap reverses pre-v3 muscle memory (right-throw used to open the picker) — owner-confirmed 2026-09-05; revisit only after live use.
- Relationship to Phase 5 Constellation: the KV store's future per-track position field and ghost resolution are untouched; the panel retires the tab, not the data model.
- The dock slide and peek follow the summon-drawer precedent (user-triggered, ungated motion); if the owner later disagrees, they register with the motion-flag system then.
