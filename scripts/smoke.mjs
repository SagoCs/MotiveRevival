import { spawnSync } from 'node:child_process';

const CORE_PROBES = ['river-surface', 'shelf', 'artist-river'];
const ALL_PROBES = [
  'river-surface',
  'song-actions',
  'song-menu',
  'summon',
  'summon-preview',
  'v2-glide',
  'v2-views',
  'tab-swap',
  'timeline-swap',
  'shelf',
  'artist-river',
];

const args = process.argv.slice(2);
const full = args.includes('--all');
const extra = args.filter((a) => !a.startsWith('--'));
const probes = full ? ALL_PROBES : [...CORE_PROBES, ...extra];

const run = (cmd, cmdArgs, label) => {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`SMOKE FAILED at: ${label}`);
    process.exit(1);
  }
};

run('npm', ['run', 'typecheck'], 'typecheck');
run('npm', ['test'], 'unit tests');
run('npm', ['run', 'build'], 'build');
run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/launch-cdp.ps1'], 'cold launch');

const failed = [];
for (const probe of probes) {
  console.log(`\n=== probe-${probe} ===`);
  const result = spawnSync('node', [`scripts/probe-${probe}.mjs`], { stdio: 'inherit' });
  if (result.status !== 0) failed.push(probe);
}

if (failed.length > 0) {
  console.error(`\nSMOKE FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nSMOKE PASS');
