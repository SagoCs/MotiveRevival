const PANE_COUNT = 25;
const SLOT_GAP = 120;
const SPAN = PANE_COUNT * SLOT_GAP;
const FAR = -2400;

interface StressSet {
  items: HTMLDivElement[];
  inners: HTMLDivElement[];
  label: string;
}

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
  const flat = buildFlatSet();
  const slabs = buildSlabSet();
  plane.append(...flat.items, ...slabs.items);
  const readout = document.createElement('div');
  readout.className = 'spike-readout';
  readout.textContent =
    'F9 cycles: panes · slabs · off\narrows tune lean/turn · shift+arrows tune curve';
  scene.append(plane);
  stress.append(scene, readout);

  document.body.append(demo, stress);

  const demoSlab = demo.querySelector<HTMLDivElement>('.spike-slab3d');

  let mode = 0;
  let lean = 28;
  let turn = -18;
  let curve = -140;
  let raf = 0;
  let last = 0;
  let offset = 0;
  let velocity = 1500;
  const ring: number[] = [];
  let readoutAt = 0;

  const tuningText = (): string => `lean ${lean}° · turn ${turn}° · curve ${curve}`;

  const applyTuning = (): void => {
    if (demoSlab !== null) demoSlab.style.transform = `rotateX(${lean}deg) rotateY(${turn}deg)`;
    plane.style.transform = `rotateX(${lean}deg)`;
    for (const inner of slabs.inners) inner.style.transform = `rotateY(${turn}deg)`;
    readout.textContent = tuningText();
  };
  applyTuning();

  const step = (ts: number): void => {
    if (mode === 0) return;
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
    const active = mode === 1 ? flat : slabs;
    for (let i = 0; i < active.items.length; i++) {
      const el = active.items[i];
      if (el === undefined) continue;
      const raw = i * SLOT_GAP - offset;
      const y = ((raw % SPAN) + SPAN) % SPAN + FAR;
      const u = (y - FAR) / SPAN;
      const x = curve * Math.sin(u * Math.PI);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
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
      const tail = mode === 1 ? 'F9 slabs' : 'F9 off';
      readout.textContent = `${fps} fps · worst ${worst.toFixed(1)} ms · ${PANE_COUNT} ${active.label} · ${tail}\n${tuningText()}`;
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
    mode = (mode + 1) % 3;
    stress.classList.toggle('flat', mode === 1);
    stress.classList.toggle('slab', mode === 2);
    demo.classList.toggle('parked', mode !== 0);
    window.cancelAnimationFrame(raf);
    if (mode !== 0) {
      last = 0;
      readoutAt = 0;
      raf = window.requestAnimationFrame(step);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (mode === 0) return;
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    let used = true;
    if (event.shiftKey && event.key === 'ArrowLeft') curve = Math.max(-480, curve - 40);
    else if (event.shiftKey && event.key === 'ArrowRight') curve = Math.min(480, curve + 40);
    else if (event.key === 'ArrowLeft') turn = Math.max(-45, turn - 3);
    else if (event.key === 'ArrowRight') turn = Math.min(45, turn + 3);
    else if (event.key === 'ArrowUp') lean = Math.min(60, lean + 3);
    else if (event.key === 'ArrowDown') lean = Math.max(0, lean - 3);
    else used = false;
    if (!used) return;
    event.preventDefault();
    applyTuning();
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

function stressTitle(title: string): HTMLDivElement {
  const text = document.createElement('div');
  text.className = 'spike-text';
  const t = document.createElement('span');
  t.className = 'spike-title';
  t.textContent = title;
  text.append(t);
  return text;
}

function buildFlatSet(): StressSet {
  const items: HTMLDivElement[] = [];
  for (let i = 0; i < PANE_COUNT; i++) {
    const pane = document.createElement('div');
    pane.className = 'spike-glass spike-stress-pane';
    pane.append(stressTitle(`Pane ${String(i + 1).padStart(2, '0')}`));
    items.push(pane);
  }
  return { items, inners: [], label: 'panes' };
}

function buildSlabSet(): StressSet {
  const items: HTMLDivElement[] = [];
  const inners: HTMLDivElement[] = [];
  for (let i = 0; i < PANE_COUNT; i++) {
    const item = document.createElement('div');
    item.className = 'spike-stress-item';
    const inner = document.createElement('div');
    inner.className = 'spike-stress-inner';
    const top = document.createElement('div');
    top.className = 'spike-face spike-top';
    const side = document.createElement('div');
    side.className = 'spike-face spike-side';
    const front = document.createElement('div');
    front.className = 'spike-face spike-glass spike-front';
    front.append(stressTitle(`Slab ${String(i + 1).padStart(2, '0')}`));
    inner.append(top, side, front);
    item.append(inner);
    items.push(item);
    inners.push(inner);
  }
  return { items, inners, label: 'slabs' };
}
