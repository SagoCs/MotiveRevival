import { el } from '../core/dom';
import { fmtTime } from '../core/dom';
import { player } from '../core/player';
import { ICON_PAUSE, ICON_PLAY, ICON_PREV, ICON_NEXT } from './icons';

export interface TransportHandle {
  setInteractivity(enabled: boolean): void;
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
  scrub.append(fill, knob);

  const timeTotal = el('span', 'mono transport-time');
  timeTotal.textContent = '0:00';

  host.append(timeNow, prevBtn, btn, nextBtn, scrub, timeTotal);

  let dragging = false;

  const paintFromClock = (time: number, duration: number): void => {
    if (!dragging) {
      timeNow.textContent = fmtTime(time);
      const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
    }
    timeTotal.textContent = fmtTime(duration);
    scrub.setAttribute('aria-valuemax', String(Math.floor(duration)));
    if (!dragging) scrub.setAttribute('aria-valuenow', String(Math.floor(time)));
  };

  const renderState = (): void => {
    btn.innerHTML = player.playing ? ICON_PAUSE : ICON_PLAY;
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

  return { setInteractivity: (enabled) => host.classList.toggle('is-disabled', !enabled) };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
