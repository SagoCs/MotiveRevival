import { player } from './player';
import { fx } from './fx';

const listeners = new Set<(strength: number) => void>();
let lastSample = 0;
let prevEnergy = 0;
let fluxAvg = 0;
let lastFire = 0;

export function onMoment(fn: (strength: number) => void): void {
  listeners.add(fn);
}

player.bus.on('tick', () => {
  if (!player.playing || !fx.pulse) {
    prevEnergy = 0;
    return;
  }
  const now = performance.now();
  if (now - lastSample < 33) return;
  lastSample = now;
  const b = player.bands();
  const energy = (b.bass * 2 + b.mid) / 3;
  const flux = Math.max(0, energy - prevEnergy);
  prevEnergy = energy;
  fluxAvg += (flux - fluxAvg) * 0.06;
  const threshold = fluxAvg * 1.5 + 0.008;
  if (flux <= threshold || now - lastFire < 200) return;
  lastFire = now;
  const strength = Math.min(1, flux / (threshold * 3));
  for (const fn of listeners) fn(strength);
});
