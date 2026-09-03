import { el } from '../core/dom';
import { fmtTime } from '../core/dom';
import { player } from '../core/player';
import { createQueuePanel } from './queuePanel';
import { ICON_PAUSE, ICON_PLAY, ICON_PREV, ICON_NEXT, ICON_VOLUME, ICON_VOLUME_MUTE, ICON_LOOP } from './icons';
import type { LoopMode } from '../../shared/types';

const ICON_QUEUE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" width="17" height="17" aria-hidden="true"><path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5.4" cy="6.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="5.4" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="5.4" cy="17.5" r="1.15" fill="currentColor" stroke="none"/></svg>`;

export interface TransportHandle {
  setInteractivity(enabled: boolean): void;
  setCompactLyric(text: string | null, upcoming: boolean): void;
}

export function createTransport(host: HTMLElement): TransportHandle {
  const timeNow = el('span', 'mono transport-time');
  timeNow.textContent = '0:00';

  const prevBtn = el('button', 'icon-btn transport-skip');
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', 'Previous track');
  prevBtn.innerHTML = ICON_PREV;
  prevBtn.disabled = true;

  const btn = el('button', 'icon-btn transport-toggle');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Play or pause');
  btn.innerHTML = ICON_PLAY;

  const nextBtn = el('button', 'icon-btn transport-skip');
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', 'Next track');
  nextBtn.innerHTML = ICON_NEXT;
  nextBtn.disabled = true;

  const scrub = el('div', 'scrub');
  scrub.tabIndex = 0;
  scrub.setAttribute('role', 'slider');
  scrub.setAttribute('aria-label', 'Seek');
  scrub.setAttribute('aria-valuemin', '0');
  scrub.setAttribute('aria-valuemax', '0');

  const fill = el('div', 'scrub-fill');
  const knob = el('div', 'scrub-knob');
  const lyric = el('div', 'transport-lyric');
  lyric.hidden = true;
  scrub.append(fill, knob);

  const timeTotal = el('span', 'mono transport-time transport-time-total');
  timeTotal.textContent = '0:00';

  const volBtn = el('button', 'icon-btn btn-small vol-toggle');
  volBtn.type = 'button';
  volBtn.setAttribute('aria-label', 'Mute or restore volume');
  volBtn.innerHTML = ICON_VOLUME;
  const volRail = el('div', 'vol-rail');
  const volFill = el('div', 'vol-fill');
  const volKnob = el('div', 'vol-knob');
  volRail.append(volFill, volKnob);
  let lastNonZero = player.volume > 0 ? player.volume : 1;
  const applyVolumeUi = (v: number): void => {
    const pct = Math.round(v * 100);
    volFill.style.width = `${pct}%`;
    volKnob.style.left = `${pct}%`;
    volBtn.innerHTML = v > 0 ? ICON_VOLUME : ICON_VOLUME_MUTE;
  };
  applyVolumeUi(player.volume);
  player.bus.on('volume', ({ volume }) => applyVolumeUi(volume));
  const persistVolume = (): void => {
    void window.mr.updateSettings({ volume: player.volume });
  };
  volBtn.addEventListener('click', () => {
    const next = player.volume > 0 ? 0 : lastNonZero;
    if (next > 0) lastNonZero = next;
    player.setVolume(next);
    persistVolume();
  });
  let volDragging = false;
  const setFromPointer = (e: PointerEvent): void => {
    const rect = volRail.getBoundingClientRect();
    const frac = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
    if (frac > 0) lastNonZero = frac;
    player.setVolume(frac);
    applyVolumeUi(frac);
  };
  volRail.addEventListener('pointerdown', (e) => {
    volDragging = true;
    volRail.setPointerCapture(e.pointerId);
    setFromPointer(e);
  });
  volRail.addEventListener('pointermove', (e) => {
    if (volDragging) setFromPointer(e);
  });
  volRail.addEventListener('pointerup', () => {
    volDragging = false;
    persistVolume();
  });
  volRail.addEventListener('pointercancel', () => {
    volDragging = false;
  });

  const queueBtn = el('button', 'icon-btn btn-small');
  queueBtn.classList.add('queue-toggle');
  queueBtn.type = 'button';
  queueBtn.setAttribute('aria-label', 'Up next queue');
  queueBtn.setAttribute('aria-pressed', 'false');
  queueBtn.innerHTML = ICON_QUEUE;

  const loopBtn = el('button', 'icon-btn btn-small loop-toggle');
  loopBtn.type = 'button';
  const renderLoop = (): void => {
    const mode = player.loop;
    loopBtn.innerHTML = ICON_LOOP;
    loopBtn.classList.toggle('lit', mode !== 'off');
    loopBtn.setAttribute('aria-label', mode === 'off' ? 'Loop: off' : 'Loop: repeat this song');
    loopBtn.setAttribute('aria-pressed', mode !== 'off' ? 'true' : 'false');
  };
  renderLoop();
  player.bus.on('loopMode', renderLoop);
  loopBtn.addEventListener('click', () => {
    const next: LoopMode = player.loop === 'off' ? 'forever' : 'off';
    player.setLoopMode(next);
    void window.mr.updateSettings({ loopMode: next });
  });

  host.append(prevBtn, btn, nextBtn, timeNow, scrub, timeTotal, loopBtn, volBtn, volRail);
  host.append(lyric);

  const bottomBar = host.parentElement;
  if (bottomBar !== null) bottomBar.insertBefore(queueBtn, host);

  const queuePanel = createQueuePanel();
  const syncQueueButton = (open: boolean): void => {
    queueBtn.classList.toggle('lit', open);
    queueBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  };
  queuePanel.onStateChange(syncQueueButton);
  syncQueueButton(queuePanel.isOpen());
  queueBtn.addEventListener('click', () => {
    queuePanel.toggle();
  });

  let dragging = false;
  let lastProgressSent = 0;
  let paintedLabel = '';
  let paintedTotal = '';
  let paintedStep = -1;
  let paintedMax = '';
  let paintedNow = '';

  const paintFromClock = (time: number, duration: number): void => {
    if (!dragging) {
      const label = fmtTime(time);
      if (label !== paintedLabel) {
        paintedLabel = label;
        timeNow.textContent = label;
      }
      const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
      const step = Math.round(pct * 10) / 10;
      if (step !== paintedStep) {
        paintedStep = step;
        const value = `${step}%`;
        fill.style.width = value;
        knob.style.left = value;
      }
    }
    const total = fmtTime(duration);
    if (total !== paintedTotal) {
      paintedTotal = total;
      timeTotal.textContent = total;
    }
    const maxLabel = String(Math.floor(duration));
    if (maxLabel !== paintedMax) {
      paintedMax = maxLabel;
      scrub.setAttribute('aria-valuemax', maxLabel);
    }
    if (!dragging) {
      const nowLabel = String(Math.floor(time));
      if (nowLabel !== paintedNow) {
        paintedNow = nowLabel;
        scrub.setAttribute('aria-valuenow', nowLabel);
      }
    }
    const now = performance.now();
    if (now - lastProgressSent > 300) {
      lastProgressSent = now;
      window.mr.taskbar.progress(duration > 0 ? Math.min(1, Math.max(0, time / duration)) : -1);
    }
  };

  const renderState = (): void => {
    btn.innerHTML = player.playing ? ICON_PAUSE : ICON_PLAY;
    btn.classList.toggle('is-playing', player.playing);
    window.mr.taskbar.playing(player.playing);
    prevBtn.disabled = !player.hasPrev() && !player.playing;
    nextBtn.disabled = !player.hasNext();
  };

  const renderQueue = (): void => {
    prevBtn.disabled = !player.hasPrev();
    nextBtn.disabled = !player.hasNext();
  };

  const timeFromPointer = (clientX: number): number => {
    const rect = scrub.getBoundingClientRect();
    const frac = rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0;
    return frac * player.duration;
  };

  btn.addEventListener('click', () => player.toggle());
  prevBtn.addEventListener('click', () => player.prev());
  nextBtn.addEventListener('click', () => player.next());

  scrub.addEventListener('pointerdown', (e) => {
    if (player.duration <= 0) return;
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    const t = timeFromPointer(e.clientX);
    fill.style.width = `${clamp01(t / player.duration) * 100}%`;
    knob.style.left = `${clamp01(t / player.duration) * 100}%`;
    timeNow.textContent = fmtTime(t);
  });
  scrub.addEventListener('pointermove', (e) => {
    if (!dragging || player.duration <= 0) return;
    const t = timeFromPointer(e.clientX);
    fill.style.width = `${clamp01(t / player.duration) * 100}%`;
    knob.style.left = `${clamp01(t / player.duration) * 100}%`;
    timeNow.textContent = fmtTime(t);
  });
  scrub.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    player.seek(timeFromPointer(e.clientX));
  });

  scrub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      player.seek(player.currentTime - 5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      player.seek(player.currentTime + 5);
    }
  });

  player.bus.on('tick', ({ time, duration }) => paintFromClock(time, duration));
  player.bus.on('state', () => renderState());
  player.bus.on('ended', () => renderState());
  player.bus.on('queue', () => renderQueue());
  player.bus.on('trackChanged', () => renderQueue());
  player.bus.on('queueMutated', () => renderQueue());

  return {
    setInteractivity: (enabled) => host.classList.toggle('is-disabled', !enabled),
    setCompactLyric: (text, upcoming) => {
      lyric.textContent = text ?? '';
      lyric.hidden = text === null || text === '';
      lyric.classList.toggle('upcoming', upcoming);
    },
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
