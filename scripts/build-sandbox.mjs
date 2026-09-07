import * as esbuild from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('sandbox/dist', { recursive: true, force: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ['sandbox/universe/main.ts'],
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    outfile: 'sandbox/dist/main.js',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['sandbox/universe/sim.ts'],
    platform: 'browser',
    target: 'chrome126',
    format: 'iife',
    outfile: 'sandbox/dist/sim.js',
    loader: { '.woff': 'file', '.woff2': 'file', '.svg': 'file', '.png': 'file' },
    assetNames: 'assets/[name]-[hash]',
  }),
]);

cpSync('sandbox/universe/index.html', 'sandbox/dist/index.html');
console.log('sandbox build complete');
