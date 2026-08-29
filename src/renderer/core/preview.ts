import { Bus } from './bus';
import { mediaUrl, player } from './player';
import { getPreviewOffset } from './peakAnalyzer';
import type { IndexedTrack } from '../../shared/types';

export type PreviewEventMap = {
  pending: { trackId: string | null };
  active: { trackId: string | null };
};

const DWELL_MS = 1400;

class PreviewService {
  readonly bus = new Bus<PreviewEventMap>();

  private readonly audio = new Audio();
  private dwellTimer = 0;
  private fadeAnim = 0;
  private pendingId: string | null = null;
  private activeId: string | null = null;
  private duckBase = 1;
  private mainHeld = false;

  constructor() {
    this.audio.preload = 'auto';
    this.audio.volume = 0.9;
  }

  hoverEnter(track: IndexedTrack): void {
    if (this.activeId === track.id) return;
    this.cancelDwell();
    this.pendingId = track.id;
    this.bus.emit('pending', { trackId: track.id });
    this.dwellTimer = window.setTimeout(() => {
      this.dwellTimer = 0;
      void this.begin(track);
    }, DWELL_MS);
  }

  hoverLeave(): void {
    this.cancelDwell();
    if (this.activeId !== null) this.stop();
  }

  hardStop(): void {
    this.cancelDwell();
    if (this.activeId !== null) {
      try {
        this.audio.pause();
      } catch {
        /* ignore */
      }
      this.activeId = null;
      this.bus.emit('active', { trackId: null });
    }
    this.restoreMain(true);
  }

  private cancelDwell(): void {
    if (this.dwellTimer !== 0) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = 0;
    }
    if (this.pendingId !== null) {
      this.pendingId = null;
      this.bus.emit('pending', { trackId: null });
    }
  }

  private async begin(track: IndexedTrack): Promise<void> {
    if (this.activeId === track.id) return;
    if (player.currentTrack?.id === track.id && player.playing) {
      this.stop();
      this.cancelDwell();
      return;
    }
    const switching = this.activeId !== null;
    this.activeId = track.id;
    this.bus.emit('active', { trackId: track.id });

    if (!switching && player.playing) this.pauseMain();

    const startSec = getPreviewOffset(track);
    try {
      if (switching || this.audio.src !== mediaUrl(track.absPath)) {
        this.audio.src = mediaUrl(track.absPath);
        await new Promise<void>((resolve) => {
          const once = (): void => {
            this.audio.removeEventListener('loadedmetadata', once);
            resolve();
          };
          this.audio.addEventListener('loadedmetadata', once);
          this.audio.src = mediaUrl(track.absPath);
          this.audio.load();
        });
      }
      this.audio.currentTime = Math.min(startSec, Math.max(0, (this.audio.duration || 0) - 1));
      this.audio.volume = switching ? 0.4 : 0;
      await this.audio.play();
      this.fadeElTo(0.9, switching ? 240 : 520);
    } catch {
      this.stop();
    }
  }

  private stop(): void {
    if (this.activeId === null) return;
    this.activeId = null;
    this.bus.emit('active', { trackId: null });
    try {
      this.audio.pause();
    } catch {
      /* ignore */
    }
    this.restoreMain(false);
  }

  private pauseMain(): void {
    this.mainHeld = true;
    this.duckBase = player.volume;
    this.tweenMain(0, 850, () => {
      if (this.mainHeld) player.pause();
    });
  }

  private restoreMain(instant: boolean): void {
    if (this.fadeAnim !== 0) {
      cancelAnimationFrame(this.fadeAnim);
      this.fadeAnim = 0;
    }
    const held = this.mainHeld;
    this.mainHeld = false;
    if (instant) {
      player.volume = this.duckBase;
      return;
    }
    if (held) void player.play();
    this.tweenMain(this.duckBase, 950);
  }

  private tweenMain(to: number, ms: number, onDone?: () => void): void {
    if (this.fadeAnim !== 0) cancelAnimationFrame(this.fadeAnim);
    const from = player.volume;
    const t0 = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      player.volume = from + (to - from) * k;
      if (k < 1) {
        this.fadeAnim = requestAnimationFrame(step);
      } else {
        this.fadeAnim = 0;
        onDone?.();
      }
    };
    this.fadeAnim = requestAnimationFrame(step);
  }

  private fadeElTo(target: number, ms: number): void {
    const from = this.audio.volume;
    const t0 = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      this.audio.volume = from + (target - from) * k;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

export const preview = new PreviewService();
