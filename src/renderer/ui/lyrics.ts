import { el } from '../core/dom';
import { parseLrc, activeLineIndex, type ParsedLrc } from '../core/lrc';
import { player } from '../core/player';
import type { IndexedTrack } from '../../shared/types';

export type LyricsState = 'idle' | 'loading' | 'none' | 'synced' | 'plain';

export interface LyricsHandle {
  setTrack(track: IndexedTrack | null): void;
}

export function createLyrics(
  container: HTMLElement,
  onResolved?: (state: LyricsState) => void,
): LyricsHandle {
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

  function setStatus(text: string): void {
    status.textContent = text;
    status.hidden = text === '';
  }

  function reset(statusText: string): void {
    parsed = null;
    lineEls = [];
    activeIdx = -2;
    strip.replaceChildren();
    strip.style.transform = 'translate3d(0,0,0)';
    setStatus(statusText);
  }

  function renderSynced(data: ParsedLrc): void {
    parsed = data;
    strip.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const line of data.lines) {
      const node = el('div', 'lyric-line');
      node.textContent = line.text;
      node.addEventListener('click', () => player.seek(line.timeMs / 1000));
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
    setStatus('');
  }

  function centerOn(index: number): void {
    if (index < 0 || index >= lineEls.length) {
      strip.style.transform = 'translate3d(0,0,0)';
      return;
    }
    const target = lineEls[index];
    if (target === undefined) return;
    const vpH = viewport.clientHeight;
    const anchor = vpH * 0.42;
    const maxScroll = Math.max(0, strip.scrollHeight - vpH);
    const want = target.offsetTop - anchor + target.offsetHeight / 2;
    const clamped = Math.min(maxScroll, Math.max(0, want));
    strip.style.transform = `translate3d(0, ${-clamped.toFixed(1)}px, 0)`;
  }

  player.bus.on('tick', ({ time }) => {
    if (parsed === null || !parsed.synced || lineEls.length === 0) return;
    const idx = activeLineIndex(parsed.lines, time * 1000);
    if (idx === activeIdx) return;
    activeIdx = idx;
    for (let i = 0; i < lineEls.length; i++) {
      const node = lineEls[i];
      if (node === undefined) continue;
      node.classList.toggle('active', i === idx);
      node.classList.toggle('past', idx >= 0 && i < idx);
    }
    centerOn(idx);
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
