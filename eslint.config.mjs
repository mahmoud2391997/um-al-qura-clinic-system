import { readFileSync } from 'node:fs';
import globals from 'globals';
const files = JSON.parse(
  readFileSync(new URL('./quality-files.json', import.meta.url), 'utf8'),
);
export default [
  { ignores: ['node_modules/**', '.next/**', '.local/**'] },
  {
    files,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-constant-binary-expression': 'error',
    },
  },
];
