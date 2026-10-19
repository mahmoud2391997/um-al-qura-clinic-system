// Self-contained drill: no operator config, real databases, service calls or host ports.
import {
  mkdtempSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
const directory = mkdtempSync(join(tmpdir(), 'clinic-pg-backup-drill-')),
  container = 'clinic-synthetic-backup-' + randomBytes(6).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
try {
  const infra = join(directory, 'infra'),
    config = join(directory, 'private'),
    files = join(directory, 'files');
  cpSync(new URL('../infra/', import.meta.url), infra, {
    recursive: true,
    filter: (path) =>
      !/(?:^|\/)(backups|\.backup-lock|\.deployment-lock|node_modules)(?:\/|$)/.test(
        path,
      ),
  });
  mkdirSync(config, { mode: 0o700 });
  writeFileSync(
    join(config, 'backup.key'),
    randomBytes(32).toString('base64url'),
    { mode: 0o600 },
  );
  for (const name of ['factory', 'feed']) {
    mkdirSync(join(files, name), { recursive: true });
    writeFileSync(
      join(files, name, 'synthetic.bin'),
      Buffer.from('Synthetic attachment ' + name),
    );
  }
  writeFileSync(
    join(infra, 'control.sh'),
    `#!/bin/sh
set -eu
case "$1" in
 ps) exit 0;;
 exec) shift 3; exec docker exec -i "$CLINIC_DRILL_CONTAINER" "$@";;
 cp) case "$2" in factory:*) cp -R "$CLINIC_DRILL_FILES/factory" "$3";; feed-site:*) cp -R "$CLINIC_DRILL_FILES/feed" "$3";; *) exit 2;; esac;;
 *) echo 'Synthetic drill refuses nonfixture control command' >&2;exit 2;;
esac
`,
  );
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '--network',
    'none',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    'postgres:17',
  );
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      docker('exec', container, 'pg_isready', '-U', 'postgres');
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert(ready, 'Synthetic PostgreSQL did not start');
  for (const database of ['factory', 'clinic', 'workforce']) {
    docker('exec', container, 'createdb', '-U', 'postgres', database);
    execFileSync(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        'postgres',
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
      ],
      {
        input:
          "CREATE TABLE synthetic_records(id BIGINT PRIMARY KEY,label TEXT);INSERT INTO synthetic_records VALUES(1,'Synthetic backup fixture'),(2,'Second synthetic row');CREATE TABLE documents(id BIGINT PRIMARY KEY,data TEXT);INSERT INTO documents VALUES(1,'JVBERi0xLjQKc3ludGhldGlj');",
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  }
  const env = {
    ...process.env,
    CONFIG_DIR: config,
    BACKUP_RETENTION_DAYS: '1',
    BACKUP_OFFSITE_HOOK: '',
    CLINIC_DRILL_CONTAINER: container,
    CLINIC_DRILL_FILES: files,
    POSTGRES_DRILL_IMAGE: 'postgres:17-alpine',
  };
  const backup = execFileSync('sh', ['./backup.sh'], {
    cwd: infra,
    env,
    encoding: 'utf8',
  });
  process.stdout.write(backup);
  const archive = join(
      infra,
      'backups',
      readdirSync(join(infra, 'backups')).find((name) => name.endsWith('.enc')),
    ),
    corrupt = join(directory, 'corrupt.enc'),
    bytes = readFileSync(archive);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  writeFileSync(corrupt, bytes, { mode: 0o600 });
  const bad = spawnSync('sh', ['./restore-drill.sh', corrupt], {
    cwd: infra,
    env,
    encoding: 'utf8',
  });
  assert.notEqual(bad.status, 0, 'Corrupt ciphertext must fail');
  console.log('PASS corrupted archive rejected');
  const started = Date.now();
  const restored = execFileSync('sh', ['./restore-drill.sh', archive], {
    cwd: infra,
    env,
    encoding: 'utf8',
  });
  process.stdout.write(restored);
  console.log('synthetic_drill_recovery_ms=' + String(Date.now() - started));
} finally {
  try {
    docker('rm', '-f', container);
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
