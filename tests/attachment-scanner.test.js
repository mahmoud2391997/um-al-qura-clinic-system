import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { httpsAttachmentScan } from '../lib/attachment-scanner.js';
const env = {
    CLINIC_SCAN_ENDPOINT: 'https://scanner.example.test/scan',
    CLINIC_SCAN_KEY: 'x'.repeat(32),
  },
  bytes = Buffer.from('Synthetic file'),
  sha256 = createHash('sha256').update(bytes).digest('hex');
test('HTTPS scanner enforces TLS, digest, limits and redirect refusal', async () => {
  for (const state of ['Clean', 'Infected'])
    assert.equal(
      await httpsAttachmentScan(bytes, env, async (url, options) => {
        assert.equal(url.href, env.CLINIC_SCAN_ENDPOINT);
        assert.equal(options.redirect, 'error');
        assert.equal(
          options.headers.Authorization,
          'Bearer ' + env.CLINIC_SCAN_KEY,
        );
        assert.equal(options.headers['X-Content-SHA256'], sha256);
        assert.deepEqual(options.body, bytes);
        return Response.json({ state, sha256 });
      }),
      state,
    );
  for (const result of [
    { state: 'Clean', sha256: 'wrong' },
    { state: 'Unknown', sha256 },
    { state: 'Clean' },
  ])
    await assert.rejects(() =>
      httpsAttachmentScan(bytes, env, async () => Response.json(result)),
    );
  await assert.rejects(() =>
    httpsAttachmentScan(
      bytes,
      env,
      async () => new Response('no', { status: 503 }),
    ),
  );
  await assert.rejects(() =>
    httpsAttachmentScan(
      bytes,
      env,
      async () =>
        new Response('x'.repeat(4097), {
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  await assert.rejects(() =>
    httpsAttachmentScan(bytes, env, async () => {
      throw Error('Network down');
    }),
  );
  for (const configuration of [
    { ...env, CLINIC_SCAN_ENDPOINT: 'http://scanner.test' },
    { ...env, CLINIC_SCAN_KEY: '' },
    { ...env, CLINIC_SCAN_ENDPOINT: 'https://user:password@scanner.test' },
  ])
    await assert.rejects(() =>
      httpsAttachmentScan(bytes, configuration, async () => {
        assert.fail('Invalid configuration must not send data');
      }),
    );
  await assert.rejects(() =>
    httpsAttachmentScan(Buffer.alloc(2 * 1024 * 1024 + 1), env),
  );
});
