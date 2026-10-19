import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { routerSource } from './lib/router-source.mjs';
const path = new URL('../lib/api-audit-policy.js', import.meta.url);
const hash = createHash('sha256').update(routerSource()).digest('hex');
writeFileSync(
  path,
  readFileSync(path, 'utf8').replace(
    /reviewedRouteSourceSha256\s*=\s*['"][a-f0-9]+['"]/,
    "reviewedRouteSourceSha256 = '" + hash + "'",
  ),
);
