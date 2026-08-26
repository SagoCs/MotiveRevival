import { deriveAccent } from './palette';

type AccentSet = { a: string; b: string; g: string };

let base: AccentSet | null = null;

function apply(set: AccentSet): void {
  const style = document.documentElement.style;
  style.setProperty('--acc-a', set.a);
  style.setProperty('--acc-b', set.b);
  style.setProperty('--acc-glow', set.g);
}

export const uiTheme = {
  setBase(palette: readonly string[] | null): void {
    base = deriveAccent(palette);
    apply(base);
  },
  pushPreview(palette: readonly string[] | null): void {
    apply(deriveAccent(palette));
  },
  popPreview(): void {
    apply(base ?? deriveAccent(null));
  },
};
