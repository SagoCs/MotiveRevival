import { ICON_BACK, ICON_CLOSE, ICON_SETTINGS } from './icons';
import { fx, applyMotionFlags, applyLyricSize, applyTimelineLyricSize } from '../core/fx';
import { ICON_STAR4 } from './icons';

export function applyLyricsLayout(align?: 'left' | 'middle' | 'right', pane?: 'left' | 'right'): void {
  const overlay = document.getElementById('overlay');
  if (overlay === null) return;
  overlay.classList.toggle('align-left', align === 'left');
  overlay.classList.toggle('align-middle', align === 'middle');
  overlay.classList.toggle('align-right', align === 'right');
  overlay.classList.toggle('pane-left', pane === 'left');
}

export function initSettingsPanel(onLibraryChanged: () => void): void {
  const must = <T extends Element>(sel: string): T => {
    const node = document.querySelector<T>(sel);
    if (node === null) throw new Error('missing ' + sel);
    return node;
  };

  const gearBtn = must<HTMLButtonElement>('#btn-settings');
  const modal = must<HTMLDivElement>('#settings-modal');
  const home = must<HTMLElement>('#settings-home');
  const librariesView = must<HTMLElement>('#libraries-view');

  const backBtn = must<HTMLButtonElement>('#btn-libraries-back');
  const archiveSummary = must<HTMLUListElement>('#archive-summary');
  const archiveFullList = must<HTMLUListElement>('#archive-full-list');

  const masterToggle = must<HTMLInputElement>('#set-motion-master');
  const carouselToggle = must<HTMLInputElement>('#set-motion-carousel');
  const pulseToggle = must<HTMLInputElement>('#set-motion-pulse');
  const morphToggle = must<HTMLInputElement>('#set-motion-morph');
  const autofetchToggle = must<HTMLInputElement>('#set-autofetch');
  const savebesideToggle = must<HTMLInputElement>('#set-savebeside');
  const sizeSeg = must<HTMLElement>('#lyric-size-seg');
  const alignSeg = must<HTMLElement>('#lyric-align-seg');
  const paneSeg = must<HTMLElement>('#lyric-pane-seg');
  const timelineSizeSeg = must<HTMLElement>('#timeline-size-seg');

  if (
    modal === null ||
    home === null ||
    librariesView === null ||
    backBtn === null ||
    archiveSummary === null ||
    archiveFullList === null ||
    masterToggle === null ||
    carouselToggle === null ||
    pulseToggle === null ||
    morphToggle === null ||
    autofetchToggle === null ||
    savebesideToggle === null ||
    sizeSeg === null
  ) {
    return;
  }

  if (gearBtn !== null) {
    gearBtn.innerHTML = ICON_SETTINGS;
    gearBtn.classList.add('no-drag');
  }
  backBtn.innerHTML = ICON_BACK;

  let currentDirs: string[] = [];
  let closeTimer = 0;

  function addLibrary(): void {
    void window.mr.archivesAdd().then((settings) => {
      refreshFrom(settings);
      renderArchiveRows(archiveFullList, currentDirs);
      onLibraryChanged();
    });
  }

  function archiveDivider(): HTMLElement {
    const divider = document.createElement('li');
    divider.className = 'archive-divider';
    divider.setAttribute('aria-hidden', 'true');
    divider.innerHTML = `<span></span><i>${ICON_STAR4}</i><span></span>`;
    return divider;
  }

  function renderArchiveRows(host: HTMLElement, dirs: readonly string[]): void {
    host.replaceChildren();
    if (dirs.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'archive-empty-row';
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'archive-add archive-add-empty mono';
      add.textContent = '+ Add a library';
      add.addEventListener('pointerdown', (event) => event.stopPropagation());
      add.addEventListener('click', addLibrary);
      empty.append(add);
      host.append(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    frag.append(archiveDivider());
    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i];
      if (dir === undefined) continue;
      const row = document.createElement('li');
      row.className = 'archive-row';
      row.dataset.dir = dir;

      const body = document.createElement('div');
      body.className = 'archive-row-body';

      const pathSpan = document.createElement('span');
      pathSpan.className = 'mono dim archive-path';
      pathSpan.textContent = dir;
      pathSpan.title = dir;

      body.append(pathSpan);

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'archive-add archive-add-compact';
      addBtn.setAttribute('aria-label', 'Add a library');
      addBtn.textContent = '+';
      addBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
      addBtn.addEventListener('click', addLibrary);
      body.append(addBtn);

      const hint = document.createElement('span');
      hint.className = 'archive-swipe-hint';
      hint.textContent = 'Delete library';
      row.append(hint, body);

      const startX = { value: 0 };
      const startY = { value: 0 };
      let axis: 'x' | null = null;
      let dx = 0;

      const finish = (commit: boolean): void => {
        row.removeEventListener('pointermove', onMove);
        row.removeEventListener('pointerup', onUp);
        row.removeEventListener('pointercancel', onCancel);
        if (axis === 'x' && commit) {
          if (Math.abs(dx) > row.offsetWidth * 0.33) {
            row.classList.add('archive-swipe-out');
            body.style.translate = `${dx > 0 ? 130 : -130}% 0`;
            body.style.opacity = '0';
            window.setTimeout(() => {
              void window.mr.archivesRemove(dir).then((settings) => {
                refreshFrom(settings);
                onLibraryChanged();
              });
            }, 170);
          } else {
            row.classList.add('archive-spring');
            body.style.translate = '0 0';
            body.style.opacity = '1';
            hint.style.opacity = '0';
            window.setTimeout(() => row.classList.remove('archive-spring'), 260);
          }
        }
        axis = null;
        dx = 0;
      };

      const onMove = (event: PointerEvent): void => {
        const mx = event.clientX - startX.value;
        const my = event.clientY - startY.value;
        if (axis === null) {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
          if (Math.abs(mx) <= Math.abs(my)) {
            finish(false);
            return;
          }
          axis = 'x';
        }
        dx = mx;
        body.style.translate = `${dx}px 0`;
        body.style.opacity = String(Math.max(0.12, 1 - Math.abs(dx) / 110));
        hint.style.opacity = String(Math.min(1, Math.abs(dx) / 90));
      };

      const onUp = (): void => finish(true);
      const onCancel = (): void => finish(false);

      row.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        startX.value = event.clientX;
        startY.value = event.clientY;
        axis = null;
        dx = 0;
        try {
          row.setPointerCapture(event.pointerId);
        } catch {
          return;
        }
        row.addEventListener('pointermove', onMove);
        row.addEventListener('pointerup', onUp);
        row.addEventListener('pointercancel', onCancel);
      });

      frag.append(row);
      if (i < dirs.length - 1) frag.append(archiveDivider());
    }
    frag.append(archiveDivider());
    host.append(frag);
  }

  function renderSummary(dirs: readonly string[]): void {
    archiveSummary.replaceChildren();
    if (dirs.length === 0) {
      renderArchiveRows(archiveSummary, []);
      return;
    }
    const visible = dirs.slice(0, 5);
    renderArchiveRows(archiveSummary, visible);
    if (dirs.length > 5) {
      const more = document.createElement('li');
      more.className = 'archive-more';
      more.innerHTML = `+${dirs.length - 5} more — <span class="linkish">show all</span>`;
      more.addEventListener('click', () => showView(true));
      archiveSummary.append(more);
    }
  }

  function refreshFrom(settings: import('../../shared/types').Settings): void {
    currentDirs = [...settings.musicDirs];
    renderSummary(currentDirs);
    renderArchiveRows(archiveFullList, currentDirs);
    applyMotionFlags(settings);
    applyLyricSize(settings.lyricSize);

    masterToggle.checked = settings.motionEffects !== false;
    carouselToggle.checked = settings.motionCarousel !== false;
    pulseToggle.checked = settings.motionPulse !== false;
    morphToggle.checked = settings.motionMorph !== false;
    autofetchToggle.checked = settings.autoFetchLyrics !== false;
    savebesideToggle.checked = settings.lyricsSaveBeside !== false;

    for (const btn of sizeSeg.querySelectorAll<HTMLButtonElement>('button')) {
      btn.classList.toggle('active', btn.dataset['size'] === (settings.lyricSize ?? 'm'));
    }
    for (const btn of alignSeg.querySelectorAll<HTMLButtonElement>('button')) {
      btn.classList.toggle('active', btn.dataset['align'] === (settings.lyricAlign ?? 'left'));
    }
    for (const btn of paneSeg.querySelectorAll<HTMLButtonElement>('button')) {
      btn.classList.toggle('active', btn.dataset['pane'] === (settings.lyricPane ?? 'right'));
    }
    for (const btn of timelineSizeSeg.querySelectorAll<HTMLButtonElement>('button')) {
      btn.classList.toggle('active', btn.dataset['tsize'] === (settings.timelineLyricSize ?? 'm'));
    }
    applyLyricsLayout(settings.lyricAlign, settings.lyricPane);
  }

  function showView(libraries: boolean): void {
    home.hidden = libraries;
    librariesView.hidden = !libraries;
  }

  async function openModal(): Promise<void> {
    if (closeTimer !== 0) {
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    }
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('open'));
    showView(false);
    refreshFrom(await window.mr.getSettings());
  }

  function closeModal(): void {
    modal.classList.remove('open');
    if (closeTimer !== 0) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      closeTimer = 0;
      if (!modal.classList.contains('open')) modal.hidden = true;
    }, 750);
  }

  if (gearBtn !== null) gearBtn.addEventListener('click', () => void openModal());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  backBtn.addEventListener('click', () => showView(false));

  function bindToggle(
    input: HTMLInputElement,
    key: 'motionEffects' | 'motionCarousel' | 'motionPulse' | 'motionMorph' | 'autoFetchLyrics' | 'lyricsSaveBeside',
  ): void {
    input.addEventListener('change', () => {
      if (key === 'motionEffects') {
        const enabled = input.checked;
        carouselToggle.checked = enabled;
        pulseToggle.checked = enabled;
        morphToggle.checked = enabled;
        fx.motion = enabled;
        void window.mr
          .updateSettings({
            motionEffects: enabled,
            motionCarousel: enabled,
            motionPulse: enabled,
            motionMorph: enabled,
          })
          .then(refreshFrom);
        return;
      }
      const patch = { [key]: input.checked } as Partial<import('../../shared/types').Settings>;
      void window.mr.updateSettings(patch).then(refreshFrom);
    });
  }

  bindToggle(masterToggle, 'motionEffects');
  bindToggle(carouselToggle, 'motionCarousel');
  bindToggle(pulseToggle, 'motionPulse');
  bindToggle(morphToggle, 'motionMorph');
  bindToggle(autofetchToggle, 'autoFetchLyrics');
  bindToggle(savebesideToggle, 'lyricsSaveBeside');

  sizeSeg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-size]') ?? null;
    if (btn === null) return;
    const size = btn.dataset['size'] as 's' | 'm' | 'l';
    void window.mr.updateSettings({ lyricSize: size }).then((s) => {
      applyLyricSize(s.lyricSize);
      for (const b of sizeSeg.querySelectorAll<HTMLButtonElement>('button')) {
        b.classList.toggle('active', b.dataset['size'] === (s.lyricSize ?? 'm'));
      }
    });
  });

  alignSeg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-align]') ?? null;
    if (btn === null) return;
    const align = btn.dataset['align'] as 'left' | 'middle' | 'right';
    void window.mr.updateSettings({ lyricAlign: align }).then((s) => {
      applyLyricsLayout(s.lyricAlign, s.lyricPane);
      for (const b of alignSeg.querySelectorAll<HTMLButtonElement>('button')) {
        b.classList.toggle('active', b.dataset['align'] === (s.lyricAlign ?? 'left'));
      }
    });
  });

  paneSeg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-pane]') ?? null;
    if (btn === null) return;
    const pane = btn.dataset['pane'] as 'left' | 'right';
    void window.mr.updateSettings({ lyricPane: pane }).then((s) => {
      applyLyricsLayout(s.lyricAlign, s.lyricPane);
      for (const b of paneSeg.querySelectorAll<HTMLButtonElement>('button')) {
        b.classList.toggle('active', b.dataset['pane'] === (s.lyricPane ?? 'right'));
      }
    });
  });

  timelineSizeSeg.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-tsize]') ?? null;
    if (btn === null) return;
    const size = btn.dataset['tsize'] as 's' | 'm' | 'l';
    void window.mr.updateSettings({ timelineLyricSize: size }).then((s) => {
      applyTimelineLyricSize(s.timelineLyricSize);
      for (const b of timelineSizeSeg.querySelectorAll<HTMLButtonElement>('button')) {
        b.classList.toggle('active', b.dataset['tsize'] === (s.timelineLyricSize ?? 'm'));
      }
    });
  });
}
