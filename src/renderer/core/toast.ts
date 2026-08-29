import { el } from './dom';

let host: HTMLElement | null = null;
let timer = 0;

function ensureHost(): HTMLElement {
  if (host === null) {
    host = el('div', 'toast mono');
    document.body.append(host);
  }
  return host;
}

export function toast(message: string): void {
  const node = ensureHost();
  node.textContent = message;
  node.classList.add('show');
  if (timer !== 0) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    host?.classList.remove('show');
    timer = 0;
  }, 2200);
}

export function toastSong(action: string, title: string, tail: string): void {
  const node = ensureHost();
  const lead = el('span', 'toast-text');
  lead.textContent = `${action} `;
  const song = el('strong', 'toast-song');
  song.textContent = title;
  const rest = el('span', 'toast-text');
  rest.textContent = ` ${tail}`;
  node.replaceChildren(lead, song, rest);
  node.classList.add('show');
  if (timer !== 0) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    host?.classList.remove('show');
    timer = 0;
  }, 2200);
}
