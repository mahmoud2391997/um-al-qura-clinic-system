import { endpointPermissions } from '../lib/endpoint-policy.js';
import { routerSource } from '../scripts/lib/router-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeInventory } from '../scripts/lib/audit-inventory.mjs';
import {
  endpointPolicy,
  findEndpoint,
  endpointAllowed,
} from '../lib/api-audit-policy.js';
import { operationPages } from '../lib/operations-config.js';
import { extraPaths } from '../lib/purchasing-extras.js';
import { documentPaths } from '../lib/documents.js';

test('every dispatched path and module registry has an explicit method policy', () => {
  const inventory = routeInventory(routerSource());
  for (const path of [
    ...inventory.paths,
    ...Object.keys(operationPages),
    ...extraPaths,
    ...documentPaths.flatMap((p) => [p, p + '/targets']),
  ]) {
    assert(
      endpointPolicy.some((e) => e.path === path),
      'Missing method policy: ' + path,
    );
  }
  assert.equal(
    new Set(endpointPolicy.map((e) => e.method + ' ' + e.path)).size,
    endpointPolicy.length,
  );
  assert.equal(findEndpoint('GET', 'patients/anything'), undefined);
  assert.equal(findEndpoint('POST', 'roles/anything'), undefined);
  assert.equal(findEndpoint('GET', 'patients/profile/1').scope, 'patients');
  assert.equal(findEndpoint('GET', 'patients/profile/nope'), undefined);
  for (const entry of endpointPolicy) {
    assert(entry.authentication);
    assert(entry.scope);
    assert(entry.audit);
  }
});
test('session routes reject inactive actors and no-grant actors before payload validation', () => {
  const empty = { active: 1, role: 'no-grants', permissions: [] };
  for (const entry of endpointPolicy.filter(
    (e) => e.authentication === 'session',
  )) {
    assert.equal(endpointAllowed(entry, { ...empty, active: 0 }), false);
    if (entry.permission || entry.anyPermissions || entry.exportPermission)
      assert.equal(
        endpointAllowed(entry, empty),
        false,
        entry.method + ' ' + entry.path,
      );
  }
  assert.equal(
    endpointAllowed(findEndpoint('GET', 'finance/service-prices'), {
      ...empty,
      permissions: ['appointments.view'],
    }),
    true,
  );
  assert.equal(
    endpointAllowed(
      findEndpoint('POST', 'reports/export'),
      { ...empty, permissions: ['patients.export'] },
      { path: 'patients' },
    ),
    false,
  );
});

test('audit history exposes no application mutation route', () => {
  assert.equal(findEndpoint('POST', 'audit'), undefined);
  assert.equal(findEndpoint('POST', 'audit/verify'), undefined);
});

test('every reviewed write action refuses a role missing any required grant even when other mutation grants exist', () => {
  const bodies = [
    {},
    { id: 1 },
    { id: 1, action: 'approve' },
    { id: 1, action: 'reject' },
    { id: 1, action: 'download' },
    { id: 1, action: 'pay' },
    { patient: { name: 'Synthetic' } },
  ];
  for (const entry of endpointPolicy.filter(
    (e) =>
      e.authentication === 'session' &&
      e.method === 'POST' &&
      !e.exportPermission,
  ))
    for (const body of bodies) {
      const required = endpointPermissions(entry, body);
      if (!required.length) continue;
      assert.equal(
        endpointAllowed(entry, { active: 1, permissions: required }, body),
        true,
        entry.path,
      );
      for (const missing of required) {
        const permissions = required.filter((p) => p !== missing);
        permissions.push(missing.split('.')[0] + '.archive');
        assert.equal(
          endpointAllowed(entry, { active: 1, permissions }, body),
          false,
          entry.path + ' missing ' + missing,
        );
      }
    }
});
