import test from 'node:test';import assert from 'node:assert/strict';
import {roleNavigation} from '../lib/role-navigation.js';
import {defaultRoles} from '../lib/permissions.js';
const groups=[{page:'dashboard'},...['patients','appointments','clinical','finance','tasks','reports','users','equipment','inventory','purchasing','quality','marketing'].map(p=>({children:[p,p+'/extra',p]}))];
for(const [role,,permissions]of defaultRoles)test('Navigation preserves permitted pages without duplicates: '+role,()=>{
 const can=p=>p==='dashboard'||permissions.includes(p.split('/')[0]+'.view');
 const nav=roleNavigation(role,groups,can,{}),pages=nav.flatMap(g=>g.page?[g.page]:g.children);
 assert(nav.length<=(role==='owner'?9:8));assert.equal(pages.length,new Set(pages).size);
 assert.deepEqual([...pages].sort(),[...new Set(groups.flatMap(g=>g.page?[g.page]:g.children))].filter(can).sort());
 assert(pages.every(can));
});
