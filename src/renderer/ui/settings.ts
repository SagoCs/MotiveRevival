import { ICON_BACK, ICON_CLOSE, ICON_SETTINGS } from './icons';
import { fx, applyMotionFlags, applyLyricSize } from '../core/fx';

export function initSettingsPanel(onLibraryChanged: () => void): void {
  const must = <T extends Element>(sel: string): T => {
    const node = document.querySelector<T>(sel);
    if (node === null) throw new Error('missing ' + sel);
    return node;
  };

  const gearBtn = must<HTMLButtonElement>('#btn-settings');
  const modal = must<HTMLDivElement>('#settings-modal');
  const closeBtn = must<HTMLButtonElement>('#settings-close');
  const home = must<HTMLElement>('#settings-home');
  const librariesView = must<HTMLElement>('#libraries-view');

  const manageBtn = must<HTMLButtonElement>('#btn-manage-libraries');
  const backBtn = must<HTMLButtonElement>('#btn-libraries-back');
  const addBtn = must<HTMLButtonElement>('#btn-add-archive');
  const archiveSummary = must<HTMLUListElement>('#archive-summary');
  const archiveFullList = must<HTMLUListElement>('#archive-full-list');

  const masterToggle = must<HTMLInputElement>('#set-motion-master');
  const carouselToggle = must<HTMLInputElement>('#set-motion-carousel');
  const pulseToggle = must<HTMLInputElement>('#set-motion-pulse');
  const morphToggle = must<HTMLInputElement>('#set-motion-morph');
  const autofetchToggle = must<HTMLInputElement>('#set-autofetch');
  const savebesideToggle = must<HTMLInputElement>('#set-savebeside');
  const sizeSeg = must<HTMLElement>('#lyric-size-seg');

  if (
    modal === null ||
    closeBtn === null ||
    home === null ||
    librariesView === null ||
    manageBtn === null ||
    backBtn === null ||
    addBtn === null ||
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

  closeBtn.innerHTML = ICON_CLOSE;
  if (gearBtn !== null) {
    gearBtn.innerHTML = ICON_SETTINGS;
    gearBtn.classList.add('no-drag');
  }
  backBtn.innerHTML = ICON_BACK;

  let currentDirs: string[] = [];

  function renderArchiveRows(
    host: HTMLElement,
    dirs: readonly string[],
    removable: boolean,
  ): void {
    host.replaceChildren();
    if (dirs.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'oracle-hint mono dim';
      empty.textContent = 'No archives yet.';
      host.append(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const dir of dirs) {
      const row = document.createElement('li');
      row.className = 'archive-row';

      const pathSpan = document.createElement('span');
      pathSpan.className = 'mono dim archive-path';
      pathSpan.textContent = dir;
      pathSpan.title = dir;

      row.append(pathSpan);

      if (removable) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn btn-small archive-remove';
        removeBtn.setAttribute('aria-label', `Remove ${dir}`);
        removeBtn.innerHTML = ICON_CLOSE;
        removeBtn.dataset.dir = dir;
        row.append(removeBtn);
      }

      frag.append(row);
    }
    host.append(frag);
  }

  function renderSummary(dirs: readonly string[]): void {
    archiveSummary.replaceChildren();
    if (dirs.length === 0) {
      archiveSummary.append(hintLi('No archives yet.'));
      return;
    }
    const visible = dirs.slice(0, 5);
    renderArchiveRows(archiveSummary, visible, false);
    if (dirs.length > 5) {
      const more = document.createElement('li');
      more.className = 'archive-more';
      more.innerHTML = `+${dirs.length - 5} more — <span class="linkish">manage</span>`;
      more.addEventListener('click', () => showView(true));
      archiveSummary.append(more);
    }
  }

  function hintLi(text: string): HTMLElement {
    const li = document.createElement('li');
    li.className = 'oracle-hint mono dim';
    li.textContent = text;
    return li;
  }

  function refreshFrom(settings: import('../../shared/types').Settings): void {
    currentDirs = [...settings.musicDirs];
    renderSummary(currentDirs);
    renderArchiveRows(archiveFullList, currentDirs, true);
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
  }

  function showView(libraries: boolean): void {
    home.hidden = libraries;
    librariesView.hidden = !libraries;
  }

  async function openModal(): Promise<void> {
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('open'));
    showView(false);
    refreshFrom(await window.mr.getSettings());
  }

  function closeModal(): void {
    modal.classList.remove('open');
    modal.hidden = true;
  }

  if (gearBtn !== null) gearBtn.addEventListener('click', () => void openModal());
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  manageBtn.addEventListener('click', () => {
    renderArchiveRows(archiveFullList, currentDirs, true);
    showView(true);
  });
  backBtn.addEventListener('click', () => showView(false));

  addBtn.addEventListener('click', () => {
    void window.mr.archivesAdd().then((settings) => {
      refreshFrom(settings);
      renderArchiveRows(archiveFullList, currentDirs, true);
      onLibraryChanged();
    });
  });

  archiveFullList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button.archive-remove',
    );
    const dir = btn?.dataset['dir'];
    if (dir === undefined) return;
    void window.mr.archivesRemove(dir).then((settings) => {
      refreshFrom(settings);
      onLibraryChanged();
    });
  });

  function bindToggle(input: HTMLInputElement, key: 'motionEffects' | 'motionCarousel' | 'motionPulse' | 'motionMorph' | 'autoFetchLyrics' | 'lyricsSaveBeside'): void {
    input.addEventListener('change', () => {
      const patch = { [key]: input.checked } as Partial<import('../../shared/types').Settings>;
      if (key === 'motionEffects') fx.motion = input.checked;
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
}
