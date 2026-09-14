# Movement X — The Universe, Rechartered
### The Library as Worlds

**Status:** Rechartered 2026-09-13, pending owner stamp. Supersedes `docs/charter-movement-x.md`, which stays on disk as the rejected-direction record (same disposition as the Listening View charter).

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
 │    └─ ARTIST PLACE   the discography: album cards, newest first, subtle 3-D
 │         └─ ALBUM PLACE   inside one world: blurred art + the vertical song river
 └─ PLAYLISTS lens   one square per playlist
      └─ PLAYLIST PLACE   a flat world: blurred art + the song river (personal spectrum)

THE SUMMON   over everything; every result has a world to land in
ESC          always steps back exactly one stage; the ladder ends at the shelf
```

One grammar everywhere: **squares → place → Esc.** Every container opens the same way; every place climbs back the same way. Nothing in this charter introduces a second navigation grammar.

---

## 3. The Shelf (home)

The app boots into the shelf. A horizontal field of squares with the river's momentum physics (ported from the carousel) and a subtle 3-D tilt.

**Boot focus.** A cold, silent boot centers a **random artist** — the osu! landing. A resumed session centers the **playing artist** instead: the shelf opens where you are.

**The center-focus grammar (front door, both fields; amends the click-selection draft by owner ruling).** The field always settles with one card squarely centered — after every fling and drag it snaps to the nearest artist and never rests between two — and the centered card is automatically the focus: the horizon haze takes its tone and its ledger whisper shows ("*N albums · M songs*"; playlists: "*M songs*"), no click required. The accent chain gains *focused > playing > moonlight* — positional focus is chosen attention, not a sweeping pointer, so the standing hover law stands untouched. The tone and whisper update **when the field settles, never mid-scroll**: you browse in silence and the world tints when you arrive. Clicking a side card glides it to center; clicking the centered card enters (a deliberate no-op until the places exist). Esc never deselects — there is no sticky selection; on the shelf, Esc exists only for the letter ruler's dim (Phase 5). The focus layer belongs to the front door only; inside any place, everything stays single-click.

**Two lenses, one switcher.** In the idiom of the expanded view's mode dots: a quiet two-option instrument — **Artists (default)** and **Playlists**. Shape (tiny tracked-caps wordpair vs. two dots) and seat (near the transport's dot position, or under the bezel) are a build-time taste call. The bezel stays summon-only — the switcher is a surface instrument. Whether the chosen lens persists across boots (like `nowPlayingView` does) or the app always opens on Artists: owner's call at build.

**The Artists field.** One square per primary artist, arranged **A–Z** (case-insensitive) with a **#** bucket at the far end for digits, symbols, and non-Latin names. A square's face is **the artist's newest album's art** — one art, never a mosaic — with the artist's name inked beneath. The shelf speaks "who this artist is now": a new release visibly changes their face.

**The Playlists field.** One square per playlist. Face = the playlist's **first song's album art** (the same one-art cleanliness ruling), name and song-count inked beneath. No letter ruler here — the field is small and summon covers lookup. (A soft mosaic of member art is the parked alternative if first-song art ever feels misleading.)

**The letter ruler (Artists field only).** Twenty-six letters plus **#**, riding one edge of the field (bottom edge proposed — it doubles as a ruler for the shelf's span; the visual-verification law applies to anything near the bottom edge). Dim at rest; brightens under the pointer; **glows when active**.

- Click one or more letters (multi-select = union): the shelf **glides** to center that letter's cluster and the rest of the field **softly dims** — nothing ever vanishes. Dim, never filter: a lit cluster on a dimmed field reads as intention; a nearly-empty field reads as a bug; the glowing letters *are* the visible state.
- Click a lit letter to unlight it. **Esc clears** the dim before stepping back. A small ✕ at the ruler's end clears all at once.
- **#** is a real bucket, an equal citizen in the strip.

### 3.1 Phase 1 specification — the artists field

Everything Phase 1 builds, decided on paper before code. The graduated river is **untouched**: the shelf is a separate horizontal-first module porting the river contract's physics and laws verbatim — the way river v2 ported them from v1.

**Entry.** A temporary sixth tab, **SHELF**, swaps the field in over the real chrome; the Songs river keeps working untouched behind it. The shelf is a full-bleed fixed surface with a dormancy body flag, mounted at boot, visibility driven by the browser — the established pattern. At graduation the tab row dies and the shelf becomes home.

**The field grammar (owner-specified).** The river's depth grammar rotated horizontal: the centered square stands flat and forward, slightly larger; squares toward the edges shrink, ease back, and tilt away — **billboard recession with gentle tilt** (a few degrees at the edges, never the coverflow lean; the tilt is a dial if taste ever shifts). Spacing follows size — the self-similar depth walk — so edge squares pack tighter: immersive at the center, index-like at the periphery. Near the alphabet's ends the field compresses symmetrically (the Shorten squash); a library smaller than the visible band pins to center. The vanishing point sits at the center of the shelf band. Every number is a dial, tuned live by feel.

**Rhythm.** Six to eight faces visible at once — parametric, derived from the region. The centered square carries a ~+18% lens (folded into the depth walk so spacing stays honest).

**Scroll.** The river's physics ported verbatim with its banked laws: position on the device-pixel grid, scale/tilt/opacity never rounded, continuous depth lookup with no dead zones, compositor-only writes, idle parking. **The field is a ring**: past the last artist the first returns — the infinite carousel, no wall at A or Z, and the Shorten squash retires (a ring has no ends); libraries smaller than twice the visible count pin linear instead. After every fling and drag the field **snaps to the nearest card**. Acceptance is the river's own bar, ported: **a card may never move further in one frame than the scroll itself traveled**, plus slow-scroll pixel stability and a measured fling.

**Edges.** The river's alpha-mask edge dissolve, rotated horizontal: squares dissolve into whatever is behind (void and horizon haze) at the left and right screen edges — never a hard clip at the viewport border. Names ride their squares as children, warping and fading in lockstep.

**Selection.** As §3's center-focus grammar defines it, now bound to the field: the settle highlight, the tone, and the whisper follow whatever card stands at the flat, forward center spot; clicking a side card glides it there. Entering is a deliberate no-op in Phase 1, because the places do not exist yet.

**Faces.** Newest album's art requested at **full resolution** — 128px thumbnails upscale to mush, and the face is the content — loaded lazily so a hidden shelf costs nothing at boot.

**Scope boundary.** Phase 1 is the field and the focus feel only: no discography (Phase 3), no album place (Phase 2), no letter ruler (Phase 5), no playlist places (Phase 4). The Playlists lens exists with real squares and the center-focus highlight; entry is a no-op. The new surface registers with the motion-flag system at birth. One performance law stamped during the build: the focus bloom animates **opacity on a pre-rastered layer, never the shadow itself** — an animated box-shadow re-rasterizes its blur every frame and grows the layer's texture mid-bloom (measured: a 45% frame-rate collapse and two dropped frames; after the fix, 36/36 buckets at 144Hz, zero hitches).

---

## 4. The Artist Place — the discography

**Entrance (owner-specified choreography).** Clicking an artist square: the square blurs and **turns into their newest album** (their face — always the last album). Then the older albums **slide in from the left, pushing each along** — the song-river's card-push trick, so only visible cards are real and the animation is equally fast at two albums or two hundred — until the assembly settles with **the most recent album in front**. The cards carry the river's subtle 3-D tilt. Esc runs the whole sentence in reverse: cards slide back out, the square re-forms, the shelf glides home.

**The place itself.** A horizontal river of album cards, **newest first**, one per album. Clicking a card falls into that album's place (below). The color-band song river once sketched for this level is superseded — artists are worlds made of worlds; songs live one level down.

**Auto-drill.** An artist with exactly **one album** skips this place entirely: their square lands directly in the album place, the artist's name still shown as the anchor. No point standing in a discography of one. (Single-song albums already open straight through — the `openSingleStage` precedent.)

---

## 5. The Album Place — inside one world

**Required.** Not optional polish: a summon result must land somewhere, and "the album's own world" is the honest answer. It is reached two ways — a summon album result, or an album card inside an artist place.

**Choreography.** The album art **expands to fill the screen** (the measured FLIP morph, Movement VI machinery), and as it settles it **dims and blurs into the veil** — the expanded view's blurred-backdrop recipe: static blur, compositor drift, never an animated blur. A **void scrim** sits between veil and rows so high-luminance ink never fights art. The rows **stagger up from the depth** (the river contract's reveal timeline — chartered in river v2, now with its first consumer). Esc reverses everything: rows dissolve, the veil sharpens back into the square, the square glides home.

**Content.** The vertical song river: this album's songs, with the identity anchor **Album · Year** (artist included when arrived via summon) inked small in the song's tint above the river.

**Row dressing.** All rows wear **one color family** — the album's own tone, washed over the scrim (the owner's original "colored rows" image; calm because it is a single hue). This is a taste dial: if the first live look feels loud, the alternative is neutral moon-ink rows with the environment carrying all color, playing row in full accent.

**Laws carried over untouched.** The playing row wears the committed accent bloom; hover is a static highlight plus the pause-with-resume preview (hover never recolors); a click plays with **the album as queue context**; the song menu mounts on every row (the existing river mount).

**Succession.** At parity this place **replaces the detail stage** (Movement IV's two-pane stage), which then retires along with the Albums tab it served.

---

## 6. The Playlist Place — a flat world

**One less layer.** A playlist has no discography — it is flat: personally ordered songs scattered across albums. So there is no cascade entrance and no middle level. The square fills the screen and blurs into its first song's album art, and the songs **rise directly as the vertical river**.

**The personal spectrum.** Each row wears **its own song's album tone** — the multi-color idea the artist place gave up lives here, where it belongs: a playlist reads as a spectrum of the worlds it pulls from. The owner's color-coding instinct, at its best address.

**Anchor and laws.** Anchor line: **name · count**. Drag to reorder with the queue's gap-based grammar (insertion line, one drop one persist). Song menu on every row. Ghost rows for missing files stay dimmed (existing resolution). Click plays with **the playlist as queue context**. Esc: rows dissolve, the art sharpens into the square, back to the Playlists field.

**Management.** Create stays in the song menu ("New playlist", duplicate guard, existing). Rename and delete get a home: right-click the playlist's **square** for a small menu in the song menu's visual language (open detail at build).

---

## 7. The Summon

The bezel graduates to **summon-only** — the standing endgame, now the whole chrome. Ranking stays as shipped (name-ladder, sections, per-section caps, deterministic ties).

**The landing law: every result has a world.**

- Artist result → the artist place (discography).
- Album result → the album place.
- Song result → **plays, and opens its album place centered on that song** — a summon never lands you in nowhere (proposed behavior, confirm at build).
- Playlist result → the playlist place, without flipping the lens; Esc from there returns to whatever field you left.

The summon is for *knowing* the name; the letter ruler is for *half-remembering* it; no instrument at all is for wandering. Three finding modes, one field.

---

## 8. What retires, what carries over

**Retires with the sky (Phase 0):** the universe surface (`universe.ts`, `universe/` modules, `universe.css`), the sky layout math and its probe (`verify-sky-layout.mjs`), the temporary UNIVERSE tab. Branch history preserves everything; the MKII repo is untouched.

**Retires at graduation:** the tab row (Albums, Artists, Songs, Playlists), the flat list and its arrows, the detail stage (replaced by the album place), the playlist tab and detail layer (replaced by the Playlists lens + playlist place). Dormant behind body flags until parity, never deleted mid-flight.

**Carries over (proven machinery this charter reuses):** the river v2 contract (parametric depth, card-push recycling, glide physics, reveal/collapse timeline); carousel momentum; the FLIP card-to-fullscreen morph; the blurred-backdrop recipes and their performance laws; index v7 prominence weights and the summon's row-tone washes; the song menu and `songActions` intent layer; the playlist store (CRUD, ghosts, gap-reorder); the preview pause-with-resume machinery (its gating learns the new surfaces); moments/motes under the motion-flag law.

---

## 9. Phases

Each phase carries probe-verifiable acceptance; nothing is verified by eye alone (DPI-aware physical capture for anything near the bottom edge).

- **Phase 0 — Disposition of the sky.** Retire the universe surface and probes, bank the verdict in the ledger. Small, reversible, first.
- **Phase 1 — The Artists field.** Built to the §3.1 specification: temporary SHELF tab; horizontal depth grammar (billboard recession with gentle tilt, self-similar packing, Shorten squash, small-set pinning, edge dissolve); six-to-eight full-res faces; boot focus + selection layer with glide-to-center; lens switcher (Playlists lens lightly populated, entry a no-op); motion-continuity acceptance bar ported from the river. River stays live until parity.
- **Phase 2 — The Album place.** FLIP fill → veil → staggered river; auto-drill for one-album artists; anchor line; album openings route through it (stage's role absorbed).
- **Phase 3 — The Artist place.** The discography river and the push-cascade entrance, reversible on Esc.
- **Phase 4 — The Playlists lens + playlist place.** Spectrum rows, drag-reorder, ghost rows, square management menu.
- **Phase 5 — The letter ruler.** Glide-and-dim, multi-select, # bucket, Esc/✕ clear.
- **Phase 6 — Summon landing law + graduation.** Song results open their album place; tabs retire in order; bezel → summon-only. Ledger and AGENTS stamped at each sign-off.

---

## 10. Open questions (parked riders)

1. **The all-songs surface.** Does any "play everything" view survive, or do summon + albums + playlists cover it? (Today's Songs river's fate rides on this.)
2. **Switcher** — wordpair vs. dots; seat; lens persistence across boots.
3. **Album-place row dressing** — one color family vs. neutral ink; decide on the first live look.
4. **Playlist square art** — first-song art vs. soft mosaic.
5. **Playlist management menu** — exact contents and behavior of the square's right-click menu.
6. **Song-result landing** — the glide-to-song detail inside the album place.
7. **Sorting** — the shelf is A–Z by ruling; whether any alternate arrangement ever exists (probably not; the ruler assumes A–Z).

---

*Charter written 2026-09-13 from the design discussion. Owner rulings are law in this document; recommendations are marked as dials or parked riders. Nothing builds until the owner stamps it.*
