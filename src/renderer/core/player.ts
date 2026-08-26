import { Bus } from './bus';
import { appBus } from './appBus';
import type { IndexedTrack } from '../../shared/types';

export type PlayerEventMap = {
  tick: { time: number; duration: number };
  state: { playing: boolean };
  loaded: { duration: number };
  ended: Record<string, never>;
  error: { message: string };
  queue: { canPrev: boolean; canNext: boolean };
  trackChanged: { track: IndexedTrack };
};

const MEDIA_ERROR_MESSAGES: Record<number, string> = {
  1: 'Loading aborted',
  2: 'Network error while streaming track',
  3: 'Audio decode failed — file may be corrupt or unsupported',
  4: 'Source not supported or unreadable',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class PlayerService {
  readonly bus = new Bus<PlayerEventMap>();

  private readonly audio: HTMLAudioElement;
  private clockRunning = false;
  private rafHandle = 0;

  private queue: IndexedTrack[] = [];
  private queueIndex = -1;

  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private freqData: Uint8Array | null = null;
  private timeData: Uint8Array | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.audio.addEventListener('loadedmetadata', () => {
      this.startClock();
      this.bus.emit('loaded', { duration: this.duration });
      this.emitTick();
    });
    this.audio.addEventListener('play', () => {
      this.startClock();
      this.bus.emit('state', { playing: true });
    });
    this.audio.addEventListener('pause', () => {
      this.stopClock();
      this.emitTick();
      this.bus.emit('state', { playing: false });
    });
    this.audio.addEventListener('seeked', () => this.emitTick());
    this.audio.addEventListener('ended', () => {
      if (this.hasNext()) {
        this.next();
        return;
      }
      this.bus.emit('ended', {});
    });
    this.audio.addEventListener('error', () => {
      const code = this.audio.error?.code ?? 0;
      const message =
        MEDIA_ERROR_MESSAGES[code] ?? `Unknown audio error${this.audio.src ? ` (${this.audio.src})` : ''}`;
      this.bus.emit('error', { message });
    });
  }

  get duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  get volume(): number {
    return this.audio.volume;
  }

  set volume(value: number) {
    this.audio.volume = clamp(value, 0, 1);
  }

  get currentTrack(): IndexedTrack | null {
    return this.queue[this.queueIndex] ?? null;
  }

  hasNext(): boolean {
    return this.queueIndex >= 0 && this.queueIndex < this.queue.length - 1;
  }

  hasPrev(): boolean {
    return this.queueIndex > 0 || (this.queueIndex === 0 && this.currentTime > 3);
  }

  setContext(tracks: readonly IndexedTrack[], startIndex: number): void {
    this.queue = [...tracks];
    this.playFrom(startIndex);
  }

  playFrom(index: number): void {
    const track = this.queue[index];
    if (track === undefined) return;
    this.queueIndex = index;
    this.load(mediaUrlOf(track));
    void this.play();
    appBus.emit('track-selected', { track });
    this.emitQueueState();
    this.bus.emit('trackChanged', { track });
  }

  next(): void {
    if (this.hasNext()) this.playFrom(this.queueIndex + 1);
  }

  prev(): void {
    if (this.currentTime > 3) {
      this.seek(0);
      return;
    }
    if (this.queueIndex > 0) this.playFrom(this.queueIndex - 1);
    else this.seek(0);
  }

  load(mediaUrl: string): void {
    this.stopClock();
    this.audio.pause();
    this.audio.src = mediaUrl;
    this.audio.load();
  }

  async play(): Promise<void> {
    try {
      this.ensureGraph();
      if (this.audioCtx !== null) {
        await this.audioCtx.resume().catch(() => undefined);
      }
      await this.audio.play();
    } catch (err) {
      this.bus.emit('error', { message: `Playback refused: ${String(err)}` });
    }
  }

  pause(): void {
    this.audio.pause();
  }

  toggle(): void {
    if (this.playing) {
      this.pause();
    } else {
      void this.play();
    }
  }

  seek(timeSeconds: number): void {
    if (!Number.isFinite(timeSeconds)) return;
    const max = this.duration > 0 ? this.duration : 0;
    this.audio.currentTime = clamp(timeSeconds, 0, max);
    this.emitTick();
  }

  bands(): { bass: number; mid: number; treble: number } {
    const analyser = this.ensureGraph();
    if (analyser === null || this.freqData === null || this.timeData === null) {
      return { bass: 0, mid: 0, treble: 0 };
    }
    analyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
    analyser.getByteTimeDomainData(this.timeData as Uint8Array<ArrayBuffer>);

    let bassSum = 0;
    for (let i = 1; i <= 10; i++) bassSum += this.freqData[i] ?? 0;
    let midSum = 0;
    for (let i = 11; i <= 85; i++) midSum += this.freqData[i] ?? 0;
    let trebleSum = 0;
    for (let i = 86; i <= 340; i++) trebleSum += this.freqData[i] ?? 0;

    return {
      bass: bassSum / (10 * 255),
      mid: midSum / (75 * 255),
      treble: trebleSum / (255 * 255),
    };
  }

  waveform(): Uint8Array | null {
    const analyser = this.ensureGraph();
    if (analyser === null || this.freqData === null) return null;
    analyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
    return this.freqData;
  }

  private ensureGraph(): AnalyserNode | null {
    if (this.analyserNode !== null) return this.analyserNode;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(this.audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      this.audioCtx = ctx;
      this.analyserNode = analyser;
      this.freqData = new Uint8Array(analyser.frequencyBinCount);
      this.timeData = new Uint8Array(analyser.frequencyBinCount);
      void ctx.resume();
    } catch {
      this.analyserNode = null;
    }
    return this.analyserNode;
  }

  private emitQueueState(): void {
    this.bus.emit('queue', { canPrev: this.hasPrev(), canNext: this.hasNext() });
  }

  private snapshot(): PlayerEventMap['tick'] {
    return { time: this.currentTime, duration: this.duration };
  }

  private emitTick(): void {
    this.bus.emit('tick', this.snapshot());
  }

  private startClock(): void {
    if (this.clockRunning) return;
    this.clockRunning = true;
    const loop = (): void => {
      if (!this.clockRunning) return;
      this.emitTick();
      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  private stopClock(): void {
    this.clockRunning = false;
    cancelAnimationFrame(this.rafHandle);
  }
}

function mediaUrlOf(track: IndexedTrack): string {
  return `media://local/${encodeURIComponent(track.absPath)}`;
}

export const player = new PlayerService();

export function mediaUrl(absPath: string): string {
  return `media://local/${encodeURIComponent(absPath)}`;
}
