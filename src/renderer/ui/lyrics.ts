import { el } from '../core/dom';
import { parseLrc, activeLineIndex, type ParsedLrc } from '../core/lrc';
import { player } from '../core/player';
import type { IndexedTrack } from '../../shared/types';

export type LyricsState = 'idle' | 'loading' | 'none' | 'synced' | 'plain';

export interface LyricsHandle {
  setTrack(track: IndexedTrack | null): void;
}

export interface LyricsOptions {
  pannable?: boolean;
  anchor?: number;
  parkMs?: number;
}

const RESUME_GLIDE_MS_DEFAULT = 2500;

export function createLyrics(
  container: HTMLElement,
  onResolved?: (state: LyricsState) => void,
  onActiveLine?: (text: string | null, upcoming: boolean) => void,
  opts: LyricsOptions = {},
): LyricsHandle {
  const pannable = opts.pannable === true;
  const anchorRatio = opts.anchor ?? 0.42;
  const parkMs = opts.parkMs ?? RESUME_GLIDE_MS_DEFAULT;

  container.classList.add('lyrics');
  const status = el('div', 'lyric-status mono dim');
  const viewport = el('div', 'lyric-viewport');
  const strip = el('div', 'lyric-strip');
  viewport.append(strip);
  container.append(status, viewport);

  let trackKey: string | null = null;
  let parsed: ParsedLrc | null = null;
  let lineEls: HTMLElement[] = [];
  let activeIdx = -2;

  let curY = 0;
  let parked = false;
  let resumeTimer = 0;
  let snapHold = 0;

  function setStatus(text: string): void {
    status.textContent = text;
    status.hidden = text === '';
  }

  function stopParkTimers(): void {
    parked = false;
    window.clearTimeout(resumeTimer);
    window.clearTimeout(snapHold);
    container.classList.remove('panning');
  }

  function reset(statusText: string): void {
    parsed = null;
    lineEls = [];
    activeIdx = -2;
    curY = 0;
    stopParkTimers();
    strip.replaceChildren();
    strip.style.transform = 'translate3d(0,0,0)';
    setStatus(statusText);
    onActiveLine?.(null, false);
  }

  function renderSynced(data: ParsedLrc): void {
    parsed = data;
    strip.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const line of data.lines) {
      const node = el('div', 'lyric-line');
      node.textContent = line.text;
      node.addEventListener('click', () => {
        if (pannable && parked) hardSnap();
        player.seek(line.timeMs / 1000);
      });
      frag.append(node);
    }
    strip.append(frag);
    lineEls = Array.from(strip.children) as HTMLElement[];
    activeIdx = -2;
    setStatus('');
  }

  function renderPlain(text: string): void {
    parsed = null;
    const block = el('div', 'lyric-static');
    block.textContent = text;
    strip.replaceChildren(block);
    lineEls = [];
    setStatus('');
  }

  function bounds(): { min: number; max: number } {
    const vpH = viewport.clientHeight;
    const first = lineEls[0];
    const last = lineEls[lineEls.length - 1];
    if (first === undefined || last === undefined || vpH === 0) return { min: 0, max: 0 };
    const min = Math.max(0, first.offsetTop - vpH * 0.35);
    const max = Math.max(min, last.offsetTop + last.offsetHeight + vpH * 0.35 - vpH);
    return { min, max };
  }

  function applyY(y: number): void {
    curY = y;
    strip.style.transform = `translate3d(0, ${(-y).toFixed(1)}px, 0)`;
  }

  function hardSnap(): void {
    strip.classList.add('no-trans');
    stopParkTimers();
    window.clearTimeout(snapHold);
    snapHold = window.setTimeout(() => strip.classList.remove('no-trans'), 80);
  }

  function centerOn(index: number): void {
    if (index < 0 || index >= lineEls.length) {
      applyY(0);
      return;
    }
    const target = lineEls[index];
    if (target === undefined) return;
    const vpH = viewport.clientHeight;
    if (vpH === 0) return;
    const want = target.offsetTop - vpH * anchorRatio + target.offsetHeight / 2;
    const b = bounds();
    applyY(Math.min(b.max, Math.max(b.min, want)));
  }

  function endPark(glide: boolean): void {
    if (!glide) {
      hardSnap();
      return;
    }
    if (!parked) return;
    parked = false;
    window.clearTimeout(resumeTimer);
    container.classList.remove('panning');
    centerOn(activeIdx);
  }

  if (pannable) {
    viewport.addEventListener(
      'wheel',
      (e) => {
        if (lineEls.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= viewport.clientHeight;
        const b = bounds();
        applyY(Math.min(b.max, Math.max(b.min, curY + dy)));
        if (!parked) {
          parked = true;
          container.classList.add('panning');
        }
        window.clearTimeout(resumeTimer);
        resumeTimer = window.setTimeout(() => endPark(true), parkMs);
      },
      { passive: false },
    );
  }

  player.bus.on('tick', ({ time }) => {
    if (parsed === null || !parsed.synced || lineEls.length === 0) return;
    const idx = activeLineIndex(parsed.lines, time * 1000);
    if (idx === activeIdx) return;
    activeIdx = idx;
    const active = parsed.lines[idx >= 0 ? idx : 0];
    onActiveLine?.(active?.text ?? null, idx < 0);
    for (let i = 0; i < lineEls.length; i++) {
      const node = lineEls[i];
      if (node === undefined) continue;
      node.classList.toggle('active', i === idx);
      node.classList.toggle('past', idx >= 0 && i < idx);
    }
    if (!parked) centerOn(idx);
  });

  async function setTrack(track: IndexedTrack | null): Promise<void> {
    if (track === null) {
      trackKey = null;
      reset('—');
      onResolved?.('idle');
      return;
    }
    const key = track.id;
    if (key === trackKey) return;
    trackKey = key;
    reset('Consulting the archives…');
    onResolved?.('loading');

    let result;
    try {
      result = await window.mr.getLyrics({
        absPath: track.absPath,
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationSec: track.durationSec,
      });
    } catch {
      if (trackKey !== key) return;
      reset('The archives are silent.');
      onResolved?.('none');
      return;
    }

    if (trackKey !== key) return;

    if (!result.ok) {
      reset('No lyrics found.');
      onResolved?.('none');
      return;
    }

    if (!result.synced) {
      renderPlain(result.text);
      setStatus('');
      onResolved?.('plain');
      return;
    }

    renderSynced(parseLrc(result.text));
    setStatus('');
    onResolved?.('synced');
  }

  return { setTrack };
}
