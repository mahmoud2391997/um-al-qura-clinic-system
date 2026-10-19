// Starts an isolated synthetic demo and runs the existing visual/browser checks.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
const output = resolve(
  process.env.CLINIC_UI_ARTIFACTS || '.local/hardening-browser',
);
mkdirSync(output, { recursive: true });
let app,
  logs = '';
try {
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port;
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: '',
    VERCEL: '',
    CLINIC_DB: ':memory:',
    DEMO_MODE: 'on',
    CLINIC_DEMO_ONLY: '0',
    CLINIC_UI_ARTIFACTS: output,
  };
  app = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    { env, stdio: 'pipe' },
  );
  app.stdout.on('data', (chunk) => (logs = (logs + chunk).slice(-40000)));
  app.stderr.on('data', (chunk) => (logs = (logs + chunk).slice(-40000)));
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + '/api/environment')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw Error('Synthetic browser server failed to start');
  const run = async (script, args = [], extra = {}) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...env, ...extra },
      stdio: 'inherit',
    });
    const code = await new Promise((r) => child.once('exit', r));
    if (code !== 0) throw Error('Browser check failed: ' + script);
  };
  if (process.env.CLINIC_UI_SKIP_VISUAL !== '1')
    await run('scripts/ui-visual-acceptance.mjs', [base]);
  await run('scripts/ui-booking-visual.mjs', [base], {
    CLINIC_UI_ARTIFACTS: resolve(output, 'booking'),
  });
  app.kill('SIGTERM');
  await Promise.race([new Promise((r) => app.once('exit', r)), delay(5000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
  app = null;
  for (const [width, height] of [
    [360, 640],
    [768, 1024],
    [1440, 900],
  ])
    await run('scripts/ui-language-acceptance.mjs', [], {
      CLINIC_UI_WIDTH: String(width),
      CLINIC_UI_HEIGHT: String(height),
      CLINIC_UI_ARTIFACTS: resolve(output, 'language-' + width),
    });

  rmSync(resolve(output, 'server-failure.log'), { force: true });
  console.log('PASS synthetic browser matrix; artifacts: ' + output);
} catch (error) {
  writeFileSync(resolve(output, 'server-failure.log'), logs);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (app) {
    app.kill('SIGTERM');
    await Promise.race([new Promise((r) => app.once('exit', r)), delay(5000)]);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
}
