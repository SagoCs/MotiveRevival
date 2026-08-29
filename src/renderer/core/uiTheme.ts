import { deriveAccent, deriveHorizon } from './palette';

type AccentSet = { a: string; b: string; g: string };

let base: AccentSet | null = null;
let horizonBase: AccentSet = deriveHorizon(null);

function apply(set: AccentSet, floor: AccentSet): void {
  const style = document.documentElement.style;
  style.setProperty('--acc-a', set.a);
  style.setProperty('--acc-b', set.b);
  style.setProperty('--acc-glow', set.g);
  style.setProperty('--hz-a', floor.a);
  style.setProperty('--hz-b', floor.b);
  style.setProperty('--hz-glow', floor.g);
}

export const uiTheme = {
  setBase(palette: readonly string[] | null): void {
    base = deriveAccent(palette);
    horizonBase = deriveHorizon(palette);
    apply(base, horizonBase);
  },
  pushPreview(palette: readonly string[] | null): void {
    apply(deriveAccent(palette), deriveHorizon(palette));
  },
  popPreview(): void {
    apply(base ?? deriveAccent(null), horizonBase);
  },
};
