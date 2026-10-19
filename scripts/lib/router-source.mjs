import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
export function routerSource() {
  return [
    'app/api/[...path]/route.js',
    ...readdirSync(new URL('lib/api-handlers/', root))
      .filter((f) => f.endsWith('.js'))
      .sort()
      .map((f) => 'lib/api-handlers/' + f),
  ]
    .map((f) => readFileSync(new URL(f, root), 'utf8'))
    .join('\n// CLINIC_ROUTER_MODULE_BOUNDARY\n');
}
