import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const profile = join(tmpdir(), 'motive-fresh-profile');
const music = join(tmpdir(), 'motive-fresh-music');

rmSync(profile, { recursive: true, force: true });
if (!existsSync(music)) mkdirSync(music, { recursive: true });

const electron = join(process.cwd(), 'node_modules', '.bin', 'electron.cmd');
const child = spawn('cmd', ['/c', electron, '.', `--user-data-dir=${profile}`], {
  cwd: process.cwd(),
  env: { ...process.env, MOTIVE_MUSIC_DIR: music },
  stdio: 'ignore',
  detached: true,
});
child.unref();
console.log(`fresh session: profile=${profile}`);
console.log(`fresh session: music=${music}`);
