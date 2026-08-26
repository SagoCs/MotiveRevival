import { ICON_CLOSE, ICON_MAXIMIZE, ICON_MINIMIZE } from './icons';

export function initWindowControls(): void {
  const minBtn = document.querySelector<HTMLButtonElement>('#win-min');
  const maxBtn = document.querySelector<HTMLButtonElement>('#win-max');
  const closeBtn = document.querySelector<HTMLButtonElement>('#win-close');

  if (minBtn !== null) {
    minBtn.innerHTML = ICON_MINIMIZE;
    minBtn.addEventListener('click', () => window.mr.window.minimize());
  }
  if (maxBtn !== null) {
    maxBtn.innerHTML = ICON_MAXIMIZE;
    maxBtn.addEventListener('click', () => window.mr.window.maximize());
  }
  if (closeBtn !== null) {
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', () => window.mr.window.close());
  }
}
