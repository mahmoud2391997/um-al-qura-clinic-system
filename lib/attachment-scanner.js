import { createHash } from 'node:crypto';
// Operator-configured HTTPS adapter contract, independent of any vendor. Uploads
// cannot select an endpoint or assert a clean result. Failure keeps quarantine.
export async function httpsAttachmentScan(
  bytes,
  env = process.env,
  request = fetch,
) {
  const endpoint = new URL(env.CLINIC_SCAN_ENDPOINT);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    !env.CLINIC_SCAN_KEY ||
    env.CLINIC_SCAN_KEY.length < 32
  )
    throw Error('Invalid scanner configuration');
  if (bytes.length > 2 * 1024 * 1024) throw Error('Scanner payload limit');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const response = await request(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: 'Bearer ' + env.CLINIC_SCAN_KEY,
      'Content-Type': 'application/octet-stream',
      'X-Content-SHA256': digest,
    },
    body: bytes,
  });
  if (
    !response.ok ||
    !response.headers.get('content-type')?.includes('application/json')
  )
    throw Error('Scanner unavailable');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) throw Error('Invalid scanner response');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (result.sha256 !== digest || !['Clean', 'Infected'].includes(result.state))
    throw Error('Scanner did not certify this content');
  return result.state;
}
