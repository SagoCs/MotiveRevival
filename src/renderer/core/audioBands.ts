import { player } from './player';
import { fx } from './fx';

type VizDrawFn = (wave: Uint8Array | null) => void;

let refCount = 0;
let running = false;
let rafHandle = 0;

const smoothed = { bass: 0, mid: 0, treble: 0 };
const drawTargets = new Set<VizDrawFn>();

const BAND_SMOOTH = { bass: 0.48, mid: 0.39, treble: 0.33 };
let bandFrame = 0;

export function startBands(): void {
  refCount += 1;
  if (!running) {
    running = true;
    loop();
  }
}

export function stopBands(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && running) {
    running = false;
    cancelAnimationFrame(rafHandle);
    resetVars();
    for (const fn of drawTargets) fn(null);
  }
}

export function addVizTarget(fn: VizDrawFn): void {
  drawTargets.add(fn);
}

function resetVars(): void {
  const s = document.documentElement.style;
  s.setProperty('--bass', '0');
  s.setProperty('--mid', '0');
  s.setProperty('--treble', '0');
}

function loop(): void {
  if (!running) return;

  if (!fx.pulse) {
    resetVars();
    for (const fn of drawTargets) fn(null);
    rafHandle = requestAnimationFrame(loop);
    return;
  }

  bandFrame = (bandFrame + 1) % 2;
  if (bandFrame === 0) {
    const b = player.bands();
    smoothed.bass += (b.bass - smoothed.bass) * BAND_SMOOTH.bass;
    smoothed.mid += (b.mid - smoothed.mid) * BAND_SMOOTH.mid;
    smoothed.treble += (b.treble - smoothed.treble) * BAND_SMOOTH.treble;

    const s = document.documentElement.style;
    s.setProperty('--bass', smoothed.bass.toFixed(4));
    s.setProperty('--mid', smoothed.mid.toFixed(4));
    s.setProperty('--treble', smoothed.treble.toFixed(4));
  }

  const wave = drawTargets.size > 0 ? player.waveform() : null;
  for (const fn of drawTargets) fn(wave);

  rafHandle = requestAnimationFrame(loop);
}
