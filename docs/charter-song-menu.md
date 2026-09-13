# Charter — The Song Menu (queue + playlist actions)

Status: 3D mount BUILT and verified (2026-09-12). Chrome mount + two refinements PENDING (next session).

## Architecture

**Surfaces emit, stores act.** Every song surface fires intents through `core/songActions.ts`; the player and `playlistsStore` own all state and rules. Surfaces never implement queue/playlist logic.

- `queueNext(track)` — insert at plays-next (front of up-next); dedupes against the live queue → `'queued' | 'alreadyQueued'`
- `fileIntoPlaylist(id, track)` — store-guarded → `'added' | 'alreadyInPlaylist' | 'missingPlaylist'`
- `createPlaylistWithTrack(name, track)` — create + file in one intent
- `removePlaylist(id)` — UI confirm-gates before calling
- `queueRemoveTrack(id)`, `queueMoveToGap(fromOffset, gapOffset)` — GAP semantics (to = insertion gap; `to === from + 1` is the no-op drop), matching the player's `moveUpcoming`
- Reads: `queueUpcoming`, `playlistContains`, `playlists`, `playlistsReady`
- Probe handle: `window.__songActions` (boots via side-effect import in `index.ts`)

## The one menu, two registers

One component (`ui/songMenu.ts`), one state machine, two mounts. Form follows space: world context → 3D-inherited panel; chrome context → flat panel in the same material language. Same verbs everywhere.

**3D mount (BUILT, v2 river):** panel is a child of the right-clicked card, anchored to its left (`right: calc(100% + 20px)`), inheriting the card's full transform — moves and warps in lockstep, zero independent motion (inheritance beats simulation; never chase a moving target with per-frame reads). Trigger: right-button context on the card via the river contract's `onEntryContext(id, card)`; the river declines slivers (projected height < 24px). `.rv2-card` is `overflow: visible` now — `.rv2-art` clips itself (`border-radius: inherit; overflow: hidden`).

**Chrome mount (PENDING):** flat, row-anchored, on summon rows + album stage cells (replacing the old flat menu), styled in the summon drawer's grammar (art-strip playlist rows, `── ──` hairline header). The transport queue button opens it directly in queue phase — **the old queue panel (`ui/queuePanel.ts`) retires**. Transport stays the queue's constant-access home ("the queue is what you hear").

## State machine (locked)

- **Fork:** *Add to queue · Add to playlist*, side by side.
- **Queue path:** inserts plays-next (dedupe: already queued → no insert) → opens the **live queue view** (compact art-strip rows, `UP NEXT` header) with the song's row highlighted; drag to reorder (insertion line, one drop one persist); hover ✕ removes (no confirm). List is live (`queueMutated`), scrolls internally (wheel inside panel scrolls the list; wheel outside closes).
- **Playlist path:** *New playlist* pinned first (click → summon-style typing field; Enter creates + files; Escape backs out), existing playlists below; playlists already containing the song render muted with an "added" mark; click files + **"Added"**; hover ✕ on any row → menu transforms into **Confirm | Cancel** → **"Deleted"** (or Cancel returns). No timeout disarm — the explicit buttons are the safety.
- **No motes. No Play (card click plays). No Go to album (arrives with drill-through).**
- **Dismissal:** any scroll outside, outside click, Escape. Escape while typing backs out first. One panel exists at a time.
- All feedback words in one voice: "Added" / "Deleted", accent-glow, then fade.

## PENDING (next session, spec'd and approved)

1. **Panel sizing (3D mount):** width 224px → ~280px (+25%); height stretches to the full card (`top: 0; bottom: 0` instead of fixed + centered) — inherits card scale; inner scroll stays as the safety net.
2. **Right-click reliability:** trigger on right-button `pointerdown` (fires on press, immune to release wiggle) instead of `contextmenu` (fires on release); keep `contextmenu` preventDefault to suppress native menus; relax the 24px sliver guard slightly; right-click the same card while open = toggle closed.
3. **Chrome mount:** summon rows + stage cells + transport button (queue phase); retire `queuePanel.ts`.

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
- A queue holding the whole library means every track is "already queued" — probes must carve test tracks out first, and repeated runs mutate queue state: glide the river to the target before geometric picking, and guard F9 toggles (`river-v2-active` check) or you disarm the lab.
- A CSS-hidden surface is still alive (second occurrence: v1 river glided invisibly under the F9 lab).
