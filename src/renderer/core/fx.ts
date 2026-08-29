import type { LyricSize } from '../../shared/types';

export const fx = {
  motion: true,
  carousel: true,
  pulse: true,
  morph: true,
  lantern: true,
};

const LYRIC_SCALE: Record<LyricSize, string> = {
  s: '0.85',
  m: '1',
  l: '1.18',
};

export function applyMotionFlags(settings: {
  motionEffects?: boolean;
  motionCarousel?: boolean;
  motionPulse?: boolean;
  motionMorph?: boolean;
  motionLantern?: boolean;
}): void {
  fx.motion = settings.motionEffects !== false;
  fx.carousel = fx.motion && settings.motionCarousel !== false;
  fx.pulse = fx.motion && settings.motionPulse !== false;
  fx.morph = fx.motion && settings.motionMorph !== false;
  fx.lantern = fx.motion && settings.motionLantern !== false;

  const root = document.documentElement.classList;
  root.toggle('no-motion', !fx.motion);
  root.toggle('no-pulse', !fx.pulse);
  root.toggle('no-lantern', !fx.lantern);
}

export function applyLyricSize(size: LyricSize | undefined): void {
  document.documentElement.style.setProperty('--lyric-scale', LYRIC_SCALE[size ?? 'm']);
}
