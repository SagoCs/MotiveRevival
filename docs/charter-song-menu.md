# Charter — The Song Menu (queue + playlist actions)

Status: FULLY DELIVERED (2026-09-13) — both mounts live, `queuePanel.ts` retired, every surface sings the same verbs.

## Architecture

**Surfaces emit, stores act.** Every song surface fires intents through `core/songActions.ts`; the player and `playlistsStore` own all state and rules. Surfaces never implement queue/playlist logic.

- `queueNext(track)` — plays-next semantics (2026-09-13, owner ruling "add to queue = play this next"): a song already scheduled moves to the front (`'moved'`), an unscheduled song inserts at the front (`'queued'`), a song already at the front is a no-op (`'alreadyNext'`). In the river world the queue IS the library, so refuse-always dedupe was a dead button; the intent now always does something visible. Duplicates never enter the queue.
- `fileIntoPlaylist(id, track)` — store-guarded → `'added' | 'alreadyInPlaylist' | 'missingPlaylist'`
- `createPlaylistWithTrack(name, track)` — create + file in one intent
- `removePlaylist(id)` — UI confirm-gates before calling
- `queueRemoveTrack(id)`, `queueMoveToGap(fromOffset, gapOffset)` — GAP semantics (to = insertion gap; `to === from + 1` is the no-op drop), matching the player's `moveUpcoming`
- Reads: `queueUpcoming`, `playlistContains`, `playlists`, `playlistsReady`
- Probe handle: `window.__songActions` (boots via side-effect import in `index.ts`)

## The one menu, two registers

One component (`ui/songMenu.ts`), one state machine, two mounts. Form follows space: world context → 3D-inherited panel; chrome context → flat panel in the same material language. Same verbs everywhere.

**3D mount (BUILT, v2 river):** panel is a child of the right-clicked card, anchored to its left (`right: calc(100% + 20px)`), inheriting the card's full transform — moves and warps in lockstep, zero independent motion (inheritance beats simulation; never chase a moving target with per-frame reads). Sizing (2026-09-13): width 280px, height = exactly the card's height (`top: 0; bottom: 0`), no floor — the readability guard guarantees the menu is never hosted on an unreadable card. Small phases (fork, confirm, word) sit vertically centered; lists fill the panel and scroll inside. Trigger: right-button RELEASE (`contextmenu`) — the press-trigger idea was retired by owner ruling: everything else fires on release, so press-firing would feel weird. The guard is the readability line (owner design): cards rendering under ~55% of full card height decline the menu — below that line cards are dissolving into the edge fade and their titles are unreadable, so no decision could be made anyway; the jarring tiny-card-big-menu pairing cannot exist. Right-clicking the same card toggles closed; right-clicking a different card moves the menu; right-clicks inside the panel are swallowed (they once reached the card underneath and both reset the menu and — via pointer capture — committed the card: real mouse clicks on the fork buttons played the song). The panel never grows below its card.

**Chrome mount (BUILT 2026-09-13):** flat panel, right-anchored to the row and viewport-clamped, styled in the summon drawer's grammar — the fork rows ARE that grammar (stacked, frameless, hairline-divided, left-aligned). Surfaces: summon song rows, album stage cells, playlist detail rows, the dormant flat list (parity until Phase 3 retires it), all through `attachSongMenu(row, track)`. The transport queue button opens the menu directly in queue phase — left-aligned above the button (the button lives at the transport's left end; right-aligning pushed the menu off-screen), growing upward — and lights only while it owns the menu (the anchor row rides `song-menu-opened`/`song-menu-closed` on the appBus). `queuePanel.ts` and `queue.css` are deleted. **Summon layering (locked rulings, implemented):** the summon stays open through every menu action; the summon's press-dismissal stands down while the menu is open (its capture handler used to see the menu's real presses — the menu lives at body level, outside the drawer — and closed the summon the moment the user pressed Add to playlist); an outside press closes only the menu, the next press closes the summon; summon keyboard activity closes the menu; non-song rows decline the menu (song-rows-only). Toggle identity extends to chrome rows: right-click the same row toggles closed, a different row moves the menu. The Escape ladder respects a track-less queue entry (from the transport, the queue view closes directly — a fork with no song context could not act).

## State machine (locked, amended 2026-09-13)

- **Fork:** *Add to queue* · *Add to playlist* — two stacked rows (owner ruling: top and bottom, not side by side), full-width, frameless, hairline divider, left-aligned — the same row species as the lists and the summon drawer. No symbols.
- **Queue path:** plays-next (moved/inserted, deduped) → opens the **live queue view** (compact art-strip rows, `UP NEXT` header) with the song's row pulsing at position one; drag to reorder (insertion line, one drop one persist); hover ✕ removes (no confirm). List is live (`queueMutated`), scrolls internally (wheel inside panel scrolls the list; wheel outside closes).
- **Playlist path:** *New playlist* pinned first (click → summon-style typing field; Enter creates + files; Escape backs out), existing playlists below; playlists already containing the song render muted with an "added" mark; click files + **"Added"**. Hover ✕ on any row → **Confirm | Cancel appear inline on that row** (side by side, art and name stay for context; the hit is locked while armed) → the row itself speaks **"Deleted"**, fades and collapses, the rows below take its space, and the menu stays open on the shortened list (owner ruling 2026-09-13: the delete is a row-level working act, not a screen; "Added" stays a full-panel terminal word because adding ends the menu's job). No timeout disarm.
- **Escape steps back one stage; clicking off closes entirely** (owner ruling 2026-09-13): typing → list, confirm → list, queue view → fork, playlist list → fork, fork → closes. Outside press / outside scroll / same-card right-click close from anywhere. Escape is held during the delete fade.
- **No motes. No Play (card click plays). No Go to album (arrives with drill-through).**
- All feedback words in one voice: "Added" / "Deleted", accent-glow, then fade.

## PENDING

Nothing — the charter is delivered. Future riders live with their movements: drill-through arrivals come with Movement X, the flat-list menu retires with IX Phase 3.

## Cosmology decisions (recorded)

- Playlists are stars (places you visit); seen through the river via drill-through; edited in the layer now, Constellation (IX Phase 5) eventually.
- The queue is NOT a place — no queue star, no queue motes (motes are albums — one meaning per form). Queue = transport-owned panel + intents from any song surface. Optional future glance: none agreed (orbit idea REJECTED — collides with album motes).
- Universe direction: the central black hole = doorway to all playlists AND the master playlist (virtual — the library itself, never a stored copy). No caps, no first-X. Individual sparkles retire as a concept. Universe-star delete rider RETIRED (delete lives in this menu).
- Hover affordances on cards: parked again (Movement VII rider) — the context menu suffices.
- Swipe grammar: retires with the v1 river (can't travel to side-docked contexts; the menu is the fast path now).

## Banked lessons (this build)

- Inheritance beats simulation: a panel that IS a child of the moving thing cannot stutter; a panel that chases it always does.
- Assertions inside projected 3D space must be projection-aware: tilted rows compress; assert relative outcomes (moved off + still present), not pixel travel.
- `overflow: hidden` on a 3D card clips inherited panels into nonexistence — rects can be live while paint is void. Free the parent; let siblings clip themselves.
- Element.click() (synthetic) runs a post-dispatch focus fixup that blurs programmatically-focused inputs; real mouse clicks fix focus at mousedown. Use preventDefault + rAF focus when probing.
- Synthetic taps die at `setPointerCapture`: a synthetic PointerEvent has no active pointer, so capture throws and the pan helper aborts silently. Any path through pointer capture must be probed with real CDP mouse input (`Input.dispatchMouseEvent`) — and that is how the fork-button hijack was caught at all: element.click() bypasses pointer events, so a capture bug is invisible to synthetic-click probes by construction.
- A queue holding the whole library means every track is "already queued" — probes must carve test tracks out first, and repeated runs mutate queue state: glide the river to the target before geometric picking, and guard F9 toggles (`river-v2-active` check) or you disarm the lab.
- A CSS-hidden surface is still alive (second occurrence: v1 river glided invisibly under the F9 lab).
- Session-resume kv carries queue/playlist pollution across app instances — probes must normalize state at start (tap a card to rebuild a pristine context) and assert deltas, never absolutes like "exactly one copy".
- `getBoundingClientRect` happily reports coordinates for content scrolled out of an inner scroll list; a click there hits whatever is actually under the point (the river's void answered). scrollIntoView before measuring.
