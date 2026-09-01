const PANE_COUNT = 25;
const SLOT_GAP = 120;
const SPAN = PANE_COUNT * SLOT_GAP;
const FAR = -2400;

export function initCrystalSpike(): void {
  const demo = document.createElement('div');
  demo.id = 'spike-demo';
  demo.append(
    buildUnit(slabNode('Winterlight Vow', 'Aurelian Skies'), 'CRYSTAL SLAB'),
    buildUnit(paneNode('Gossamer Meridian', 'Northfold Choir'), 'FLAT PANE'),
  );

  const stress = document.createElement('div');
  stress.id = 'spike-stress';
  const scene = document.createElement('div');
  scene.className = 'spike-stress-scene';
  const plane = document.createElement('div');
  plane.className = 'spike-stress-plane';
  const panes: HTMLDivElement[] = [];
  for (let i = 0; i < PANE_COUNT; i++) {
    const pane = document.createElement('div');
    pane.className = 'spike-glass spike-stress-pane';
    const text = document.createElement('div');
    text.className = 'spike-text';
    const title = document.createElement('span');
    title.className = 'spike-title';
    title.textContent = `Pane ${String(i + 1).padStart(2, '0')}`;
    text.append(title);
    pane.append(text);
    plane.append(pane);
    panes.push(pane);
  }
  const readout = document.createElement('div');
  readout.className = 'spike-readout';
  readout.textContent = 'starting…';
  scene.append(plane);
  stress.append(scene, readout);

  document.body.append(demo, stress);

  let running = false;
  let raf = 0;
  let last = 0;
  let offset = 0;
  let velocity = 1500;
  const ring: number[] = [];
  let readoutAt = 0;

  const step = (ts: number): void => {
    if (!running) return;
    const dtMs = last === 0 ? 16 : Math.min(50, ts - last);
    last = ts;
    ring.push(dtMs);
    if (ring.length > 60) ring.shift();
    const dt = dtMs / 1000;
    velocity *= Math.exp(-1.3 * dt);
    if (Math.abs(velocity) < 70) {
      velocity = (700 + Math.random() * 1500) * (Math.random() < 0.5 ? -1 : 1);
    }
    offset = ((offset + velocity * dt) % SPAN + SPAN) % SPAN;
    for (let i = 0; i < panes.length; i++) {
      const el = panes[i];
      if (el === undefined) continue;
      const raw = i * SLOT_GAP - offset;
      const y = ((raw % SPAN) + SPAN) % SPAN + FAR;
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    }
    if (ts - readoutAt > 250) {
      readoutAt = ts;
      let sum = 0;
      let worst = 0;
      for (const d of ring) {
        sum += d;
        if (d > worst) worst = d;
      }
      const fps = ring.length > 0 ? (1000 / (sum / ring.length)).toFixed(1) : '0.0';
      readout.textContent = `${fps} fps · worst ${worst.toFixed(1)} ms · ${PANE_COUNT} panes · F9 stops`;
    }
    raf = window.requestAnimationFrame(step);
  };

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'F9') return;
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    running = !running;
    stress.classList.toggle('on', running);
    demo.classList.toggle('parked', running);
    if (running) {
      last = 0;
      readoutAt = 0;
      raf = window.requestAnimationFrame(step);
    } else {
      window.cancelAnimationFrame(raf);
    }
  });
}

function buildUnit(node: HTMLElement, tag: string): HTMLElement {
  const unit = document.createElement('div');
  unit.className = 'spike-unit';
  const label = document.createElement('span');
  label.className = 'spike-tag';
  label.textContent = tag;
  unit.append(node, label);
  return unit;
}

function textBlock(title: string, artist: string): HTMLDivElement {
  const text = document.createElement('div');
  text.className = 'spike-text';
  const t = document.createElement('span');
  t.className = 'spike-title';
  t.textContent = title;
  const a = document.createElement('span');
  a.className = 'spike-artist';
  a.textContent = artist;
  text.append(t, a);
  return text;
}

function slabNode(title: string, artist: string): HTMLElement {
  const scene = document.createElement('div');
  scene.className = 'spike-scene';
  const slab = document.createElement('div');
  slab.className = 'spike-slab3d';
  const top = document.createElement('div');
  top.className = 'spike-face spike-top';
  const side = document.createElement('div');
  side.className = 'spike-face spike-side';
  const front = document.createElement('div');
  front.className = 'spike-face spike-glass spike-front';
  front.append(textBlock(title, artist));
  slab.append(top, side, front);
  scene.append(slab);
  return scene;
}

function paneNode(title: string, artist: string): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'spike-pane spike-glass';
  pane.append(textBlock(title, artist));
  return pane;
}
