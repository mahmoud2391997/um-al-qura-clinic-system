import test from 'node:test';import assert from 'node:assert/strict';import {allowed,defaultRoles,validPermissions} from '../lib/permissions.js';
test('default deny and inactive users',()=>{assert.equal(allowed({active:1},[],'clinical','edit'),false);assert.equal(allowed({active:0},['clinical.edit'],'clinical','edit'),false)});
test('assistant cannot modify clinical records',()=>{const p=defaultRoles.find(r=>r[0]==='assistant')[2];assert.equal(allowed({active:1},p,'clinical','edit'),false)});
test('module permissions do not grant another action',()=>{assert.equal(allowed({active:1},['patients.view'],'patients','edit'),false)});
test('unknown permission keys rejected',()=>{assert.equal(validPermissions(['patients.view']),true);assert.equal(validPermissions(['patients.all']),false)});
