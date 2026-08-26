import { ICON_CLOSE, ICON_SETTINGS } from './icons';
import { fx } from '../core/fx';

export function initSettingsPanel(onLibraryChanged: () => void): void {
  const gearBtn = document.querySelector<HTMLButtonElement>('#btn-settings');
  const modal = document.querySelector<HTMLDivElement>('#settings-modal');
  const closeBtn = document.querySelector<HTMLButtonElement>('#settings-close');
  const changeBtn = document.querySelector<HTMLButtonElement>('#btn-change-dir');
  const dirLabel = document.querySelector<HTMLSpanElement>('#settings-dir');
  const motionToggle = document.querySelector<HTMLInputElement>('#setting-motion');
  const autofetchToggle = document.querySelector<HTMLInputElement>('#setting-autofetch');

  if (!gearBtn || !modal || !closeBtn || !changeBtn || !dirLabel || !motionToggle || !autofetchToggle) return;

  gearBtn.innerHTML = ICON_SETTINGS;
  closeBtn.innerHTML = ICON_CLOSE;
  gearBtn.classList.add('no-drag');

  const setOpen = async (open: boolean): Promise<void> => {
    modal.hidden = !open;
    requestAnimationFrame(() => modal.classList.toggle('open', open));
    if (open) {
      const settings = await window.mr.getSettings();
      dirLabel.textContent = settings.musicDir;
      motionToggle.checked = settings.motionEffects !== false;
      autofetchToggle.checked = settings.autoFetchLyrics !== false;
    }
  };

  gearBtn.addEventListener('click', () => void setOpen(true));
  closeBtn.addEventListener('click', () => void setOpen(false));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) void setOpen(false);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) void setOpen(false);
  });

  motionToggle.addEventListener('change', () => {
    fx.motion = motionToggle.checked;
    void window.mr.updateSettings({ motionEffects: motionToggle.checked });
  });

  autofetchToggle.addEventListener('change', () => {
    void window.mr.updateSettings({ autoFetchLyrics: autofetchToggle.checked });
  });

  changeBtn.addEventListener('click', () => {
    void (async () => {
      const settings = await window.mr.setMusicDir();
      if (!settings) return;
      dirLabel.textContent = settings.musicDir;
      onLibraryChanged();
    })();
  });
}
