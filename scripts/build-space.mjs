import * as esbuild from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('sandbox/dist3d', { recursive: true, force: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ['sandbox/space/main.ts'],
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    outfile: 'sandbox/dist3d/main.js',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['sandbox/space/sim.ts'],
    platform: 'browser',
    target: 'chrome126',
    format: 'iife',
    outfile: 'sandbox/dist3d/space.js',
    loader: { '.woff': 'file', '.woff2': 'file', '.svg': 'file', '.png': 'file' },
    assetNames: 'assets/[name]-[hash]',
  }),
]);

cpSync('sandbox/space/index.html', 'sandbox/dist3d/index.html');
console.log('space build complete');
