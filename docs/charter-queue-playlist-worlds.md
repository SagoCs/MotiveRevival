# Charter — The Queue and Playlist as Worlds

**Status:** Chartered 2026-09-17; owner-stamped rulings are law here. **Step 2 (the queue river) BUILT + STAMPED 2026-09-18**; **Step 3 (the filing mode) BUILT + STAMPED 2026-09-19, with the menu cutover pulled forward**; **Step 4 (the management scene) BUILT + STAMPED 2026-09-19 — the queue and playlist worlds are functionally complete; graduation remains** — §2’s two-option fork is live, the queue and playlist phases are retired, `queueNext` remains until the Step 5 sweep. **Amended 2026-09-19 by owner rulings:** the filing click law (click focuses; clicking the focused square files; Enter files the highlighted square; pinned fields select-then-commit); the naming stage is a naked **CHOOSE A NAME** word-morph — no glyph dress, Enter fades the text into “Created.” and the field lands on the new square, a duplicate fades into “Name already taken” and back to the text; the queue regains a **QUEUE** label in instrument dress at the ruler’s 64px seat (superseding the removal ruling), arrives through the same frosted floor as filing, draws at 80%, and hovers as the veil grammar (dim + centered role words, now-card included, ghosts silent); one symmetric **800ms** beat governs every filing and queue transition, with all bookkeeping landing behind the fade and the shelf’s exit fade made real (the engine's `hidden` attribute had defeated it since birth). — see §7; §3’s “appears nowhere” law is amended by the now-card ruling of the same day. Supersedes the queue-phase and playlist-phase portions of `docs/charter-song-menu.md` (that charter's remaining surface — the fork mount, sizing, readability guard, toggle identity — stands until Step 5 retires the phases; a retirement banner lands with the cutover). Extends Movement X Phase 4 (`docs/charter-movement-x-v2.md` §6), fulfilling its drag-reorder step and its square management scene.

**The one-sentence law:** *a queue and a playlist are worlds you walk into, not menus you unfold.*

---

## 1. Why

The song menu grew into a player: queue surgery and playlist management lived in a 280px popup stacked on a river card. This charter moves both into the grammar every other surface already speaks — momentary worlds over the void, the shelf as the place you choose. Context surfaces are momentary and cosmic in kind, never docked chrome (the banked Listening View law), and a popup was never the right vessel for a queue you want to *see*.

---

## 2. The menu slims to a fork

The right-click popup on song surfaces (river cards, summon rows, and the standing chrome mounts) carries exactly two options:

- **Add to queue**
- **Add to playlist**

No queue view, no playlist list, no delete, no typing field. The panel keeps its identity — a child of the card, inheriting its warp, 280px wide, the two options stacked as frameless rows in the shared row grammar, centered in the panel. Escape closes (a single stage; the step-back ladder dies with the phases). Choosing either option dismisses the menu and hands off to the world that owns the outcome.

---

## 3. Add to queue — the bottom of the line

**Owner ruling 2026-09-17, superseding the 2026-09-13 "play next" ruling:** *Add to queue* appends the song to the **bottom** of the upcoming queue and the menu answers **"Added."** — nothing else happens. It makes sense because a queue is a line: you join at the end.

- The **never-twice law stands**: the queue can never contain the same track twice. A song already upcoming answers **"Already there."** instead of copying; a stale copy in the played section is purged when the fresh one appends.
- The intent layer replaces `queueNext` (plays-next semantics retire entirely) with an append intent.

**Seeing the queue — the queue river.** The timeline's queue button no longer opens a popup: it opens a **momentary song-river** of the session queue, over whatever world you are in.

- **The serving metaphor (owner law):** a queue is the people who haven't been served; the currently playing song is being served — it is *not in the line*. The playing song appears **nowhere** in the queue river; the transport owns "now."
- **Composition (amended 2026-09-18):** fully played songs sit **above center, dimmed** (the ghost treatment — inert, display-only); the **centered card is the playing song**; upcoming songs descend below it. If nothing is upcoming but a song rests, it holds the center alone with the served history above. If the queue is entirely empty, the world is pure void.
- **Jump-play (owner law):** clicking an upcoming card plays it now — the clicked card **rises to the center and takes the bloom** (it is never removed from view). The skipped songs are **deferred, never dropped** — they slide behind the new current song preserving their order — and the interrupted playing song joins the played section as a ghost. Nobody leaves the circle; they only change seats. This click law belongs to the queue river alone; everywhere else, `playSingle` stands.
- **Played cards are inert** — the past is display-only; there is no road back into it from the queue river.
- **Reordering:** dragging a card reorders the upcoming section with the river's insertion-line grammar — **one drop, one persist** (the queue is session-persisted, so a reordered line survives a restart through session:v2). Dragging is **bounded to upcoming**: the past cannot be re-ordered (owner law). Drag *card* = reorder; drag *void* = pan; wheel = scroll.
- **Esc** dismisses back to whatever world you came from. The **queue button toggles** — pressing it while the queue river is open closes it.
- **Role whispers (2026-09-18):** no world title — hovering a card reveals a small caps tag: `PLAYING` (accent) on the center card, `UP NEXT` beneath it, `N AWAY` deeper. Invisible at rest; the bloom is the only standing signal. Ghosts take no hover.
- **Small lines bound, large lines wrap (2026-09-18):** the ring is exempt from the small-set pin — past and future arcs wrap through the dissolve at every size; drag stays upcoming-only via an arc clamp that lands seam-crossing drags at the line’s end.

---

## 4. Add to playlist — the filing mode

Choosing **Add to playlist** closes the menu and lands you in the **Playlists lens** in a filing mode, holding the song. The lens you know — squares, ruler, momentum — wearing one new duty.

**The + square.** A special square pinned at the **end of the field, after the # bucket**: face is a **+**, always present, **always awake** (never dimmed by a lit ruler, never a lit target, never boot-focused, never renamed or deleted). It is the app's single creation gesture. Caption: "New Playlist" (taste dial at build).

**Filing into an existing playlist.** Scroll (or click-glide) a playlist to center and press **Enter**, or simply **click** the square (owner law: click commits here): the chosen square **fades out**, the others **slide away**, the word **"Added."** shows, and the world **fades back to wherever you came from** — any tab, any river; the origin is recorded at entry. Menu closed. Done.

**Creating a new playlist.** Clicking or Enter on the **+ square** slides the other playlists away, revealing a text prompt — **"enter a name"**. Type; **Enter** confirms. During filing mode this creates the playlist, files the song, and runs the same "Added." choreography home. In **normal browsing** (no song held), the same prompt simply creates an empty playlist and slides back — creation never requires holding a song.

**Escape** at any point in filing mode cancels cleanly: nothing filed, fade back to origin. Any unrelated navigation (summon, tab change, entering another world) abandons the pending song silently — the intent survives only until filed or Esc'd.

---

## 5. The management scene

**Right-clicking a playlist square** (a standing feature of the Playlists lens, in normal browsing) slides the other playlists away and reveals **two options flanking the chosen square**:

- **Rename** (left): opens the same slide-away name prompt; **Enter** commits, **Esc** cancels and restores the old name. The prompt honors the duplicate-name law — a name another playlist already wears shakes and refuses.
- **Delete** (right): hovering turns it **red** and it says **"confirm?"**; clicking deletes the playlist (the store's removal; a playlist river open on it closes itself via the store event).

**Escape** cancels the scene; **right-clicking the same square again toggles it off** (the song menu's toggle identity). During filing mode the scene is declined — the field is mid-transaction (taste call, amendable).

---

## 6. What retires, what carries over

**Retires at Step 5 (the cutover):** the song menu's queue phase (live queue view, drag-in-menu, hover-✕), its playlist phase (typing field, muted rows, inline Confirm|Cancel delete), the step-back Escape ladder, and the transport button's popup behavior. The song-menu charter gains its retirement banner for those phases. The menu itself survives as the two-row fork.

**Untouched until Movement X graduation:** the old Playlists tab and its detail layer (including its own "+ New Playlist" card and context menu) — graduation deletes the retired views in one pass.

**Carries over (proven machinery):** the river contract (momentary worlds, ghost treatment, center lens, motion laws); the store layer as-is (`reorderTrack`, `queueMoveToGap`, `remove`, `rename` with the duplicate guard); the "Added." accent-word grammar; the parting/floor world pattern; session:v2 queue persistence.

**New core work:** an append-at-bottom queue intent replacing `queueNext`; a jump-with-deferral queue operation (clicked song becomes current, skipped songs slide behind it, interrupted song joins the played section); and drag-to-reorder as a river-contract capability (per-surface opt-in — Songs and artist rivers keep card-drag-pans).

---

## 7. Phases

Each phase carries probe-verifiable acceptance; real CDP mouse input wherever pointer capture is involved.

- **Step 1 — Drag-to-reorder in the river contract (BUILT 2026-09-17, owner-tested live).** Card-drag = reorder, void-drag = pan, wheel = scroll; per-surface opt-in (`reorder`, plus a bounded `reorderSpan` reserved for the queue river); the surface maps display indices to its store's gap call — one drop, one persist. **Amended during the build by owner verdicts:** the insertion line was replaced by **the parting field** — a crossed neighbor eases fully to its new slot the moment the dragged card crosses its midpoint (crossing-committed and retargetable, never finger-proportional), so no displaced card ever moves after release; the dragged card lifts with the full depth deformation of wherever it hovers, and the lift and opacity ease out during the settle so the landing is pixel-continuous. The commit is element-preserving: `setEntries` diffs by id and reindexes in place when only the order changed (the small version of card recycling R7) — no rebuild flash on any river surface. Edge auto-scroll serves long lists; the past/bounded span refuses grabs. Acceptance (probe-playlist-river + diag-settle): single and consecutive real-mouse drags reorder and persist; neighbors part; the displaced card shows zero movement through the commit; the dragged card shows no post-settle resize or opacity jump.
- **Step 2 — The queue river (BUILT + STAMPED 2026-09-18).** Momentary world with the now-card composition (playing song centered in the bloom, ghosts above, upcoming below); jump-play with deferral — the clicked card rises to the now seat; played cards inert; append-at-bottom + never-twice; the queue button opens and toggles; Esc returns; drained state = the resting song centered with history above, fully empty = void. **The line rings at every size** (queue exempt from the small-set pin); drag stays upcoming-only via an arc clamp; hover whispers carry the roles (`PLAYING` / `UP NEXT` / `N AWAY`). Acceptance: `probe-queue-river` (46 checks, green twice) asserts composition from live queue state, jump-play deferral order, append-at-bottom + never-twice, wrap past the line’s end, toggle and Esc.
- **Step 3 — The filing mode (BUILT + STAMPED 2026-09-19).** Pending-track intent, the + square (placement, always-awake laws), slide-away prompt, create-and-file and file-into-existing, the "Added." choreography, cross-tab origin restore, Esc cancel, silent abandon on navigation. Acceptance: probe files by Enter and by click, creates through the prompt, restores the origin world, cancels cleanly.
- **Step 4 — The management scene (BUILT + STAMPED 2026-09-19, owner-amended).** Right-click a playlist square: it glides to center, the field parts around it (chosen square standing, caption lit), and RENAME / DELETE flank it at the vacated neighbor seats, measured equidistant from the card's edges. **Rename** opens the naked CHOOSE A NAME morph stage pre-filled and selected; Enter fades the text into **"Renamed."** with the square re-forming dimmed beneath the in-face veil, then the field lands on the square at its re-sorted position; duplicates fade into **"Name already taken"** and back to the text (the shake retired with the morph stage). **Delete** arms red **"Confirm?"** on hover or focus; activation dissolves the card under a floating **"Deleted."** and the field closes the gap in one motion (the closing-scene primitive: snapshot every square's and caption's visual state, rebuild the data, interpolate all of it to the true new arrangement). **Keyboard grammar (final by ruling):** right-click opens; left/right moves the focus; Enter activates the focused word; Esc walks back one stage (mid-edit → original name → scene → home); up/down was built and removed. Toggle identity, Esc cancel, and the filing-time decline stand. Acceptance: probe-filing's management checks (right-click open, pre-filled rename, duplicate refusal, armed delete, removal, Esc ladder) green.
- **Step 5 — The menu cutover + retirement sweep.** The fork slims to two options; queue/playlist phases and their code paths are deleted from the song menu; the transport button rewires fully to the queue river (Step 2 preview becomes the only path); `queueNext` retires from the intent layer; probes rewritten (song-menu probe shrinks to the fork; drag coverage moves to the new surfaces). Acceptance: full battery green; no dead code paths remain.

---

*Charter written 2026-09-17 from the design discussion. Owner rulings are law in this document; taste dials are marked. Nothing builds until the owner stamps the build order.*

---

**Build log (2026-09-19, polish):** the creation landing was rebuilt to the owner's three beats — glide to the sorted spot, the spot parts open, the new card appears between its neighbors — after the traveling-gap rotation and the split's slide-home were each built and removed by verdict the same day; the + square activates only when centered; the naming stage is bloom-free and the new card fades in already carrying the center-focus bloom. The closing-scene interpolation was also fixed to carry captions and ledgers (it had aimed at the card's mid-flight position — a lerp applied twice), the end-of-filing bookkeeping is position-silent, and the scene's option words only catch clicks while visible. **Build log (2026-09-18):** Step 3 shipped with the menu cutover pulled forward — the fork is the whole menu, the + square and the parted CHOOSE A NAME stage carry creation, the “Added.” word lives on the square via the in-face veil, the origin world is suspended and crossfades back mid-dissolve, and all bookkeeping lands behind the fade. The queue joined it under the 800ms beat with frost, label, dim, and hover veils. **(2026-09-18):** Step 1’s drag grammar shipped with the crossing-committed parting field; Step 2 shipped with the now-card amendment, the ring-at-every-size queue, arc-bounded drag, hover whispers, and the empty-world rules. Steps 3–4 (the filing mode, the square management scene) remain; Step 5’s cutover inherits the context-aware fork (inside a playlist world the second row is Remove).

**NEXT SESSION RIDERS (owner, 2026-09-18):** a placeholder for when a playlist has no songs (today the world opens as pure void), and playlist colors that reflect the currently playing song. Ghost cards take no menu, so missing files cannot be removed from the river yet. The full-battery runner is flaky at its tail (electron died mid-run twice; both tail probes green standalone) — revisit the runner before trusting a red tail.*
