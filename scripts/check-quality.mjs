import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = JSON.parse(
  readFileSync(new URL('../quality-files.json', import.meta.url), 'utf8'),
);
const result = spawnSync(
  process.execPath,
  [
    'node_modules/prettier/bin/prettier.cjs',
    process.argv.includes('--write') ? '--write' : '--check',
    ...files,
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
