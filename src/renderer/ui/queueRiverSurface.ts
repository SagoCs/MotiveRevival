import { mediaUrl, player } from '../core/player';
import { appBus } from '../core/appBus';
import { deriveRowWash } from '../core/palette';
import { thumbOf } from '../core/dom';
import { createRiverV2 } from './riverV2';
import { openNowPlaying } from './overlay';
import type { RiverV2Entry, RiverV2Region } from './riverV2';
import type { IndexedTrack } from '../../shared/types';

const BEZEL_H = 52;
const TIMELINE_H = 62;
const WORLD_MS = 800;

let river: ReturnType<typeof createRiverV2> | null = null;
let floor: HTMLDivElement | null = null;
let titleEl: HTMLDivElement | null = null;
let opened = false;
let closing = false;
let closeTimer = 0;

const playedCount = (): number => Math.max(0, player.queuePosition);

const upcomingOffsetOf = (id: string): number =>
  player.getUpcoming().findIndex((t) => t.id === id);

const displayEntries = (): RiverV2Entry[] =>
  player.queueTracks.map((track, i) => entryOf(track, i < player.queuePosition));

const entryOf = (track: IndexedTrack, played: boolean): RiverV2Entry => {
  const album = track.album !== null && track.album.trim() !== '' ? track.album : '';
  const meta: string[] = [];
  if (track.artist !== null && track.artist.trim() !== '') meta.push(track.artist);
  if (album !== '') meta.push(album);
  return {
    id: track.id,
    title: track.title,
    meta,
    art: track.artFile !== null ? mediaUrl(track.artFile) : null,
    artThumb: track.artFile !== null ? mediaUrl(thumbOf(track.artFile)) : null,
    tone: deriveRowWash(track.palette, track.paletteWeights),
    ghost: played,
  };
};

const currentRegion = (): RiverV2Region => ({
  x: 0,
  y: BEZEL_H,
  width: window.innerWidth,
  height: Math.max(240, window.innerHeight - BEZEL_H - TIMELINE_H),
});

const ensureFloor = (): HTMLDivElement => {
  if (floor !== null) return floor;
  const node = document.createElement('div');
  node.id = 'queue-river-floor';
  document.body.append(node);
  floor = node;
  return node;
};

const ensureTitle = (): HTMLDivElement => {
  if (titleEl !== null) return titleEl;
  const node = document.createElement('div');
  node.id = 'queue-title';
  node.textContent = 'Queue';
  document.body.append(node);
  titleEl = node;
  return node;
};

const refreshCaptions = (): void => {
  const cards = document.querySelectorAll<HTMLDivElement>('#queue-river .rv2-card');
  const cur = player.currentTrack;
  cards.forEach((card) => {
    let cap = card.querySelector('.rv2-cap');
    if (cap === null) {
      cap = document.createElement('span');
      cap.className = 'rv2-cap';
      card.append(cap);
    }
    const id = card.dataset.id ?? '';
    let text = '';
    let accent = false;
    if (cur !== null && cur.id === id) {
      text = 'Playing';
      accent = true;
    } else {
      const offset = upcomingOffsetOf(id);
      if (offset === 0) text = 'Up next';
      else if (offset > 0) text = `${offset + 1} away`;
    }
    cap.textContent = text;
    cap.classList.toggle('cap-accent', accent);
  });
};

const syncCommitted = (): void => {
  const cur = player.currentTrack;
  river?.setCommitted(cur !== null ? cur.id : null);
};

const sync = (follow: boolean): void => {
  if (!opened || closing) return;
  river?.setEntries(displayEntries());
  river?.setLayout({ reorderSpan: upcomingSpan() });
  syncCommitted();
  refreshCaptions();
  if (follow) river?.glideTo(anchorIndex());
};

const anchorIndex = (): number => {
  const len = player.queueTracks.length;
  if (player.queuePosition >= 0) return Math.min(playedCount(), Math.max(0, len - 1));
  return 0;
};

const upcomingSpan = (): { first: number; last: number } => {
  const first = player.queuePosition >= 0 ? playedCount() + 1 : 0;
  const last = Math.max(first, displayEntries().length - 1);
  return { first, last };
};

export const queueRiverSurface = {
  open(): boolean {
    if (closing) {
      closing = false;
      window.clearTimeout(closeTimer);
      const el = document.getElementById('queue-river');
      if (el !== null) {
        el.classList.add('pre');
        void el.offsetWidth;
        el.classList.remove('pre');
      }
      ensureFloor().classList.add('on');
      ensureTitle().classList.add('on');
      return true;
    }
    if (opened) return false;
    opened = true;
    window.clearTimeout(closeTimer);
    river?.setEntries(displayEntries());
    river?.setLayout({ reorderSpan: upcomingSpan() });
    river?.scrollTo(anchorIndex());
    syncCommitted();
    refreshCaptions();
    river?.setVisible(true);
    const el = document.getElementById('queue-river');
    if (el !== null) {
      el.classList.add('pre');
      void el.offsetWidth;
      el.classList.remove('pre');
    }
    ensureFloor().classList.add('on');
    ensureTitle().classList.add('on');
    appBus.emit('queue-river-opened', {});
    return true;
  },
  close(): boolean {
    if (!opened || closing) return false;
    closing = true;
    ensureFloor().classList.remove('on');
    ensureTitle().classList.remove('on');
    document.getElementById('queue-river')?.classList.add('pre');
    closeTimer = window.setTimeout(() => {
      river?.setVisible(false);
      document.getElementById('queue-river')?.classList.remove('pre');
      opened = false;
      closing = false;
      appBus.emit('queue-river-closed', {});
    }, WORLD_MS + 60);
    return true;
  },
  toggle(): boolean {
    if (opened) return this.close();
    return this.open();
  },
  isOpen(): boolean {
    return opened;
  },
  activateCenter(): void {
    if (!opened) return;
    const id = river?.centerId() ?? null;
    if (id === null) return;
    const cur = player.currentTrack;
    if (cur !== null && cur.id === id) {
      void openNowPlaying();
      return;
    }
    const offset = upcomingOffsetOf(id);
    if (offset < 0) return;
    player.jumpUpcoming(offset);
  },
  arrowStep(dir: 1 | -1, repeat = false): void {
    if (!opened) return;
    if (repeat) river?.stepHold(dir);
    else river?.step(dir);
  },
  arrowRelease(): void {
    if (!opened) return;
    river?.stepRelease();
  },
};

export function initQueueRiverSurface(): void {
  if (river !== null) return;
  river = createRiverV2();
  river.setLayout({ ring: true, smallSetPin: false, reorder: true });
  river.onHome(() => {
    river?.glideTo(anchorIndex());
  });
  river.onEntryActivated((id) => {
    if (!opened || closing) return;
    const cur = player.currentTrack;
    if (cur !== null && cur.id === id) {
      void openNowPlaying();
      return;
    }
    const offset = upcomingOffsetOf(id);
    if (offset < 0) return;
    player.jumpUpcoming(offset);
  });
  river.onEntryReordered((from, gap) => {
    if (!opened) return;
    const base = player.queuePosition >= 0 ? playedCount() + 1 : 0;
    player.moveUpcoming(from - base, gap - base);
  });
  river.mount(currentRegion(), window.devicePixelRatio || 1, 'queue-river');
  river.setVisible(false);
  ensureFloor();
  ensureTitle();

  window.addEventListener('resize', () => {
    river?.setRegion(currentRegion(), window.devicePixelRatio || 1);
  });

  player.bus.on('trackChanged', () => sync(true));
  player.bus.on('queueMutated', () => sync(false));

  (window as unknown as { __queueRiver?: unknown }).__queueRiver = {
    open: () => queueRiverSurface.open(),
    close: () => queueRiverSurface.close(),
    toggle: () => queueRiverSurface.toggle(),
    isOpen: () => opened,
    ids: () => displayEntries().map((e) => e.id),
    ghostIds: () =>
      displayEntries()
        .filter((e) => e.ghost === true)
        .map((e) => e.id),
    centerId: () => river?.centerId() ?? null,
    scroll: () => river?.scrollPosition() ?? 0,
    anchor: () => anchorIndex(),
  };
}
