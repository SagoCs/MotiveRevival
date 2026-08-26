import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

rmSync('dist-test', { recursive: true, force: true });

await esbuild.build({
  entryPoints: ['tests/lrc.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist-test/lrc.test.js',
});

const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'dist-test/lrc.test.js'], {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
