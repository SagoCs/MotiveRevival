import '@fontsource/sora/300.css';
import '@fontsource/ibm-plex-mono/400.css';
import './sim.css';

const boot = (): void => {
  const stage = document.querySelector('#stage');
  if (!(stage instanceof HTMLElement)) return;
  const card = document.createElement('div');
  card.className = 'boot-card';
  const title = document.createElement('div');
  title.className = 'boot-title';
  title.textContent = 'UNIVERSE SANDBOX';
  const hair = document.createElement('div');
  hair.className = 'boot-hair';
  const lineLeft = document.createElement('span');
  const gem = document.createElement('i');
  const lineRight = document.createElement('span');
  hair.append(lineLeft, gem, lineRight);
  const sub = document.createElement('div');
  sub.className = 'boot-sub';
  sub.textContent = 'void online';
  const keys = document.createElement('div');
  keys.className = 'boot-keys';
  keys.textContent = 'F11 fullscreen · Ctrl+R reload · Esc quit';
  card.append(title, hair, sub, keys);
  stage.append(card);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
