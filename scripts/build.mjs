import * as esbuild from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    outfile: 'dist/main.js',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    sourcemap: false,
    outfile: 'dist/preload.js',
  }),
  esbuild.build({
    ...common,
    entryPoints: ['src/renderer/index.ts'],
    platform: 'browser',
    target: 'chrome126',
    format: 'iife',
    outfile: 'dist/renderer.js',
    loader: { '.woff': 'file', '.woff2': 'file' },
    assetNames: 'fonts/[name]',
  }),
]);

cpSync('src/renderer/index.html', 'dist/index.html');
console.log('build complete');
