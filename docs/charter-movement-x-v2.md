# Movement X — The Universe, Rechartered
### The Library as Worlds

**Status:** Rechartered 2026-09-13, pending owner stamp. Supersedes `docs/charter-movement-x.md`, which stays on disk as the rejected-direction record (same disposition as the Listening View charter). **Amended 2026-09-14:** the letter ruler built early as Phase 1.5; the discography and album place redesigned away before being built — one river species serves everything (§2, §4, §5).

**The one-sentence law:** *the shelf is where you choose, the river is what you see, the queue is what you hear.*

---

## 1. Why the sky retired

The night-sky spike (artist stars, the empty heart, the letter-sector layout) was built, measured, and probe-verified — and it was wrong. The owner's verdict: it felt like a **different art style from the rest of the application**, and the diagnosis bears repeating because it is now a material law:

- Every signed-off surface in this app is a **painting made of the library itself** — album art, ink, hairlines, washes. Even the river's crystals are slabs of art. The cosmos is stage dressing; the light comes from the content.
- The sky was the one surface with **no content in it** — generated light objects, additive GL glow, astrophotography physics. An interesting object in the room became a room built by a different artist.

**Material law (amended into the aesthetic contract):** the library's own imagery is the only valid content material — art, ink, titles are the light sources. Space is the stage, never the substitute. Generated abstraction (stars, tables, docked panels) may decorate nothing and may never *be* the content.

What survives from the spike: nothing visual, but the MKII star recipe remains banked in its own repo (proven, reusable someday), and the discipline carries — every claim in this charter is probe-verifiable, and the layout work's lessons (deterministic seeding, dials not constants, pixel-truth probes) apply to what follows.

---

## 2. The map

```
THE SHELF   (home — a horizontal field of squares, two lenses)
 ├─ ARTISTS lens     A–Z … # — one square per artist
 │    └─ ARTIST RIVER   every song the artist made, grouped by album (newest first),
 │                      each album a color band — "song · album" cards
 │                      └─ ALBUM DIM   summon-only: the whole river, one album's
 │                         sections lit, the rest ghosts, scroll bounded; Esc removes
 └─ PLAYLISTS lens   one square per playlist
      └─ PLAYLIST RIVER   the same river species — the personal spectrum

THE SUMMON   over everything; every result has a world to land in
ESC          always steps back exactly one stage; the ladder ends at the shelf
```

One grammar everywhere: **squares → river → Esc.** (Amended 2026-09-14: the discography and the album place were redesigned away before being built — the river is not a place you visit, it is the only content surface, and albums are a dim state over it.) Every container opens the same way; every surface climbs back the same way. Nothing in this charter introduces a second navigation grammar.

---

## 3. The Shelf (home)

The app boots into the shelf. A horizontal field of squares with the river's momentum physics (ported from the carousel) and a subtle 3-D tilt.

**Boot focus.** A cold, silent boot centers a **random artist** — the osu! landing. A resumed session centers the **playing artist** instead: the shelf opens where you are.

**The center-focus grammar (front door, both fields; amends the click-selection draft by owner ruling).** The field always settles with one card squarely centered — after every fling and drag it snaps to the nearest artist and never rests between two — and the centered card is automatically the focus: the horizon haze takes its tone and its ledger whisper shows ("*N albums · M songs*"; playlists: "*M songs*"), no click required. The accent chain gains *focused > playing > moonlight* — positional focus is chosen attention, not a sweeping pointer, so the standing hover law stands untouched. The tone and whisper update **when the field settles, never mid-scroll**: you browse in silence and the world tints when you arrive. Clicking a side card glides it to center; clicking the centered card enters (a deliberate no-op until the places exist). Esc never deselects — there is no sticky selection; on the shelf, Esc exists only for the letter ruler's dim (Phase 5). The focus layer belongs to the front door only; inside any place, everything stays single-click.

**Two lenses, one switcher.** In the idiom of the expanded view's mode dots: a quiet two-option instrument — **Artists (default)** and **Playlists**. Shape (tiny tracked-caps wordpair vs. two dots) and seat (near the transport's dot position, or under the bezel) are a build-time taste call. The bezel stays summon-only — the switcher is a surface instrument. Whether the chosen lens persists across boots (like `nowPlayingView` does) or the app always opens on Artists: owner's call at build.

**The Artists field.** One square per primary artist, arranged **A–Z** (case-insensitive) with a **#** bucket at the far end for digits, symbols, and non-Latin names. A square's face is **the artist's newest album's art** — one art, never a mosaic — with the artist's name inked beneath. The shelf speaks "who this artist is now": a new release visibly changes their face.

**The Playlists field.** One square per playlist. Face = the playlist's **first song's album art** (the same one-art cleanliness ruling), name and song-count inked beneath. A–Z by name with the # bucket, and the letter ruler serves this field too (amended 2026-09-14 — same instrument, same gestures, letters wake and sleep with the store).

**The letter ruler (BUILT 2026-09-14 as Phase 1.5, pulled forward from Phase 5; amended by owner rulings).** Twenty-six letters plus **#** leading the strip, seated under the bezel with the ARTISTS/PLAYLISTS switcher beneath it (the bottom-edge seat retired: the transport's lyric preview owns that zone and the bottom edge carries the taskbar hazard). **Strong dim** is the law: lit letters stay lit and everything else fades to a ~13% ghost — ghosts are inert and the settle-snap considers only lit entries, so the focus never speaks for a ghost. Letters with no entries sleep: fainter, inert, unlightable. Names fold accents before bucketing (Björk → B); **#** serves digits, symbols, and non-Latin scripts, equal citizen. **Esc is the only clear** — the ✕ button was built and retired by ruling (its hidden layout box was found shoving the visible letters 18.8px off center). Serves both lenses; the playlists field is A–Z by name with the same bucket. All shelf instrument text is Sora 300, matched to the summon's voice.

- Click one or more letters (multi-select = union): the shelf **glides** to center that letter's cluster and the rest of the field dims to ghosts — nothing ever vanishes. Dim, never filter: a lit cluster on a dimmed field reads as intention; the glowing letters *are* the visible state.
- Click a lit letter to unlight it. **Esc clears** the dim — the only clear.

### 3.1 Phase 1 specification — the artists field

Everything Phase 1 builds, decided on paper before code. The graduated river is **untouched**: the shelf is a separate horizontal-first module porting the river contract's physics and laws verbatim — the way river v2 ported them from v1.

**Entry.** A temporary sixth tab, **SHELF**, swaps the field in over the real chrome; the Songs river keeps working untouched behind it. The shelf is a full-bleed fixed surface with a dormancy body flag, mounted at boot, visibility driven by the browser — the established pattern. At graduation the tab row dies and the shelf becomes home.

**The field grammar (owner-specified).** The river's depth grammar rotated horizontal: the centered square stands flat and forward, slightly larger; squares toward the edges shrink, ease back, and tilt away — **billboard recession with gentle tilt** (a few degrees at the edges, never the coverflow lean; the tilt is a dial if taste ever shifts). Spacing follows size — the self-similar depth walk — so edge squares pack tighter: immersive at the center, index-like at the periphery. Near the alphabet's ends the field compresses symmetrically (the Shorten squash); a library smaller than the visible band pins to center. The vanishing point sits at the center of the shelf band. Every number is a dial, tuned live by feel.

**Rhythm.** Six to eight faces visible at once — parametric, derived from the region. The centered square carries a ~+18% lens (folded into the depth walk so spacing stays honest).

**Scroll.** The river's physics ported verbatim with its banked laws: position on the device-pixel grid, scale/tilt/opacity never rounded, continuous depth lookup with no dead zones, compositor-only writes, idle parking. **The field is a ring**: past the last artist the first returns — the infinite carousel, no wall at A or Z, and the Shorten squash retires (a ring has no ends); libraries smaller than twice the visible count pin linear instead. After every fling and drag the field **snaps to the nearest card**. Acceptance is the river's own bar, ported: **a card may never move further in one frame than the scroll itself traveled**, plus slow-scroll pixel stability and a measured fling.

**Edges.** The river's alpha-mask edge dissolve, rotated horizontal: squares dissolve into whatever is behind (void and horizon haze) at the left and right screen edges — never a hard clip at the viewport border. Names ride their squares as children, warping and fading in lockstep.

**Selection.** As §3's center-focus grammar defines it, now bound to the field: the settle highlight, the tone, and the whisper follow whatever card stands at the flat, forward center spot; clicking a side card glides it there. Entering is a deliberate no-op in Phase 1, because the places do not exist yet.

**Faces.** Newest album's art requested at **full resolution** — 128px thumbnails upscale to mush, and the face is the content — loaded lazily so a hidden shelf costs nothing at boot.

**Scope boundary.** Phase 1 is the field and the focus feel only: no discography (Phase 3 — since retired into Phase 2), no album place (Phase 2 — since redesigned into the artist river), no letter ruler (Phase 5 — since built as Phase 1.5), no playlist places (Phase 4). The Playlists lens exists with real squares and the center-focus highlight; entry is a no-op. The new surface registers with the motion-flag system at birth. One performance law stamped during the build: the focus bloom animates **opacity on a pre-rastered layer, never the shadow itself** — an animated box-shadow re-rasterizes its blur every frame and grows the layer's texture mid-bloom (measured: a 45% frame-rate collapse and two dropped frames; after the fix, 36/36 buckets at 144Hz, zero hitches).

---

## 4. The Artist River

**Amended 2026-09-14 (owner redesign): the discography is gone.** There is no album level between the shelf and the songs. Clicking an artist square opens **the artist river**: every song credited to the artist, **grouped by album, albums newest-first, tracks in album order** — each album reads as one contiguous **color band**, every card tinted by its album's tone (quiet dial to start; art stays the light source). Cards carry two lines: **song name, album name**.

**Entrance — part-and-zoom (owner-specified choreography).** The squares to the left and right of the chosen artist **slide away to the sides and fade out** — simultaneously with the zoom, one motion, not a sequence — while the chosen square **zooms to full extension** — no early handoff — and at completion **crossfades into the blurred-art veil** (the expanded view's backdrop recipe: static blur applied at the end state, compositor drift, never an animated blur). The handoff is art-into-itself: the square's face and the veil are the same image — the newest album's art — so the seam should be invisible if the timing is right. The artist's name caption fades out partway up as the veil takes over. The artist's songs rise as the vertical river over it. **Esc reverses the whole sentence smoothly**: the songs sink, the veil sharpens back into the square, the shelf squares slide home — and the shelf **re-centers on the artist just left** (the shelf opens where you are; owner-ruled 2026-09-14). **Reversibility is an acceptance requirement, not garnish** — the collapse is the same timeline run backwards, with no cuts and no snaps.

### 4.1 Phase 2 specification — the artist river

**Entry.** A full-bleed surface over whatever is on screen (shelf, or a summon in flight), following the established pattern: mounted at boot, visibility driven by the browser, dormancy body flag. Esc walks home exactly one stage.

**The feed.** Every track whose primary artist (the credits rule) is the chosen artist. Ordering: albums newest-first, tracks in album order, so tone bands are contiguous. One-album artists need no special case — their river simply holds one band. Bands are **per-artist-per-album**: on a split/collab album, the band holds this artist's tracks only (confirmed 2026-09-14 — it is their world).

**Start position.** A plain entry lands at the **top — the newest album's first song** (owner-ruled 2026-09-14). The summon-song landing is the exception that already has its own law: centered on that song.

**Cards.** Two lines — song name, album name — over the river's existing caption grammar, all Sora. The card's wash leans ~15–20% toward the album's prominence-weighted tone (`selectTone`); the dial is tuned live with the owner. The playing card wears the committed accent bloom; hover stays a static highlight plus the pause-with-resume preview; the song menu mounts on every row.

**Click law (amended 2026-09-14, owner ruling: "no queue at all").** Single-click plays — and assigns **no queue**. The queue holds only what the user manually adds through the song menu (play next, add to queue); when the manual queue runs dry, playback rests. This is the click law river-wide, library river included. Playlists' play-all is the standing exception — a playlist is already a hand-curated list, so playing it as its own context is the manual assignment.

**Laws carried.** Motion continuity (a card never moves further in a frame than the scroll traveled), device-pixel-grid positions, compositor-only writes, edge dissolve, the full input grammar — ported by feeding the existing river contract, not by forking it.

**Scope boundary.** The library's Songs river keeps its current dress for now (re-dress with the shared card recipe is a later pass, owner-ruled). No playlist river yet (Phase 4). No letter ruler inside rivers — the summon is lookup. The entrance timeline is the only genuinely new machinery.

**Acceptance.** Probe-verifiable: reverse-timeline identity (collapse matches the entrance run in reverse), motion continuity on the new feed, band-tint pixels per album tone, Esc ladder (river → shelf), entrance frame cost measured.

---

## 5. The Album Dim

**Amended 2026-09-14: there is no album place, and no album gesture inside the river.** The only road to "just this album" is the summon.

A summon album result opens **that artist's river — the entire river** — with only the sections pertaining to that album lit. The dim is part of the entrance, never a second state after it: the river **rises already dimmed** (owner-ruled 2026-09-14), non-album sections ghosts from the first frame, scroll bounded from the first frame. If the artist's river is already open, there is no re-entrance — the dim crossfades in over the standing river (~400ms). Every other section is the ruler's ghost: 13% opacity, inert. **Scroll is bounded**: the infinite ring retires, the view clamps at the lit album's first and last song, and the Shorten squash compresses those ends — an album has ends. Ghosts at the edges show where you are; the scroll refuses to leave. **Esc removes the dim** (one stage back to the whole artist river); Esc again climbs to the shelf.

While a dim is active the focused card's ledger may whisper **Album · Year** (taste call at build — the album's name already rides every lit card; only the year is new information). All river laws carry unchanged: bloom, static hover + preview, song menu, click-to-play.

---

## 6. The Playlist Place — a flat world

**One less layer.** A playlist has no discography — it is flat: personally ordered songs scattered across albums. So there is no cascade entrance and no middle level. The square fills the screen and blurs into its first song's album art, and the songs **rise directly as the vertical river**.

**The personal spectrum.** Each row wears **its own song's album tone** — a playlist reads as a spectrum of the worlds it pulls from. The owner's color-coding instinct, at its best address. Cards carry the shared two-line recipe (song name, album name) — the same species as the artist river.

**Anchor and laws.** Anchor line: **name · count**. Drag to reorder with the queue's gap-based grammar (insertion line, one drop one persist). Song menu on every row. Ghost rows for missing files stay dimmed (existing resolution). Click plays with **the playlist as queue context**. Esc: rows dissolve, the art sharpens into the square, back to the Playlists field.

**Management.** Create stays in the song menu ("New playlist", duplicate guard, existing). Rename and delete get a home: right-click the playlist's **square** for a small menu in the song menu's visual language (open detail at build).

---

## 7. The Summon

The bezel graduates to **summon-only** — the standing endgame, now the whole chrome. Ranking stays as shipped (name-ladder, sections, per-section caps, deterministic ties).

**The landing law: every result has a world.**

- Artist result → the artist river (§4).
- Album result → the artist's river with the album dimmed-in (§5).
- Song result → **plays, and opens its artist's river centered on that song** — a summon never lands you in nowhere (proposed behavior, confirm at build).
- Playlist result → the playlist river, without flipping the lens; Esc from there returns to whatever field you left.

The summon is for *knowing* the name; the letter ruler is for *half-remembering* it; no instrument at all is for wandering. Three finding modes, one field.

---

## 8. What retires, what carries over

**Retires with the sky (Phase 0):** the universe surface (`universe.ts`, `universe/` modules, `universe.css`), the sky layout math and its probe (`verify-sky-layout.mjs`), the temporary UNIVERSE tab. Branch history preserves everything; the MKII repo is untouched.

**Retires at graduation:** the tab row (Albums, Artists, Songs, Playlists), the flat list and its arrows, the detail stage (absorbed by the artist river and its album dim), the playlist tab and detail layer (replaced by the Playlists lens + playlist river). Dormant behind body flags until parity, never deleted mid-flight.

**Carries over (proven machinery this charter reuses):** the river v2 contract (parametric depth, card-push recycling, glide physics, reveal/collapse timeline); carousel momentum; the FLIP card-to-fullscreen morph; the blurred-backdrop recipes and their performance laws; index v7 prominence weights and the summon's row-tone washes; the song menu and `songActions` intent layer; the playlist store (CRUD, ghosts, gap-reorder); the preview pause-with-resume machinery (its gating learns the new surfaces); moments/motes under the motion-flag law.

---

## 9. Phases

Each phase carries probe-verifiable acceptance; nothing is verified by eye alone (DPI-aware physical capture for anything near the bottom edge).

- **Phase 0 — Disposition of the sky.** Retire the universe surface and probes, bank the verdict in the ledger. Small, reversible, first.
- **Phase 1 — The Artists field.** Built to the §3.1 specification: temporary SHELF tab; horizontal depth grammar (billboard recession with gentle tilt, self-similar packing, Shorten squash, small-set pinning, edge dissolve); six-to-eight full-res faces; boot focus + selection layer with glide-to-center; lens switcher (Playlists lens lightly populated, entry a no-op); motion-continuity acceptance bar ported from the river. River stays live until parity.
- **Phase 2 — The Artist river (spec §4.1; absorbs the former album place and discography, redesigned 2026-09-14).** Part-and-zoom entrance to full extension with the veil crossfade; album-grouped, album-tinted river with two-line cards; the summon album dim with bounded scroll; fully reversible collapse. Probe-verifiable: reverse-timeline identity, motion continuity, bounded clamp, band-tint pixels, Esc ladder.
- **Phase 3 — RETIRED INTO PHASE 2 (2026-09-14 redesign).** The discography river and its push-cascade entrance never build; albums are color bands in the artist river, not a level.
- **Phase 4 — The Playlists lens + playlist place.** Spectrum rows, drag-reorder, ghost rows, square management menu.
- **Phase 5 — The letter ruler.** BUILT EARLY as Phase 1.5 (2026-09-14): strong dim, sleeping letters, snap-to-lit, # first, Esc-only clear — see the letter ruler section in §3 and the README ledger.
- **Phase 6 — Summon landing law + graduation.** Song results open their artist's river centered on the song; tabs retire in order; bezel → summon-only. Ledger and AGENTS stamped at each sign-off.

---

## 10. Open questions (parked riders)

1. **The all-songs surface.** ANSWERED 2026-09-14: the library's Songs river survives as the unfiltered whole-library river; it takes the shared two-line album-tinted card recipe in a later pass (owner-ruled, not in Phase 2).
2. **Switcher** — wordpair vs. dots; seat; lens persistence across boots.
3. **Album row dressing** — SUPERSEDED 2026-09-14 by the artist river's tint dial (~15–20% lean toward the album tone to start; tuned live).
4. **Playlist square art** — first-song art vs. soft mosaic.
5. **Playlist management menu** — exact contents and behavior of the square's right-click menu.
6. **Song-result landing** — the glide-to-song detail inside the artist's river.
7. **Sorting** — the shelf is A–Z by ruling; whether any alternate arrangement ever exists (probably not; the ruler assumes A–Z).

---

*Charter written 2026-09-13 from the design discussion. Owner rulings are law in this document; recommendations are marked as dials or parked riders. Nothing builds until the owner stamps it.*
