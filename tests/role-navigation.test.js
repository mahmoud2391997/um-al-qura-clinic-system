import test from 'node:test';import assert from 'node:assert/strict';
import {roleNavigation,moreNavigationGroups} from '../lib/role-navigation.js';
import {defaultRoles} from '../lib/permissions.js';
const groups=[{page:'dashboard'},...['patients','appointments','clinical','finance','tasks','reports','users','equipment','inventory','purchasing','quality','marketing'].map(p=>({children:[p,p+'/extra',p]}))];
for(const [role,,permissions]of defaultRoles)test('Navigation preserves permitted pages without duplicates: '+role,()=>{
 const can=p=>p==='dashboard'||permissions.includes(p.split('/')[0]+'.view');
 const nav=roleNavigation(role,groups,can,{}),pages=nav.flatMap(g=>g.page?[g.page]:g.children);
 assert(nav.length<=(role==='owner'?9:8));assert.equal(pages.length,new Set(pages).size);
 assert.deepEqual([...pages].sort(),[...new Set(groups.flatMap(g=>g.page?[g.page]:g.children))].filter(can).sort());
 assert(pages.every(can));
});

test('More sections keep every allowed page once and prefer specific sections over catch-all',()=>{
 const sections=moreNavigationGroups(['finance/a','patients/a','new/a'],[
  {id:'readiness-group',label:'Readiness',children:['finance/a','patients/a']},
  {id:'finance-group',label:'Finance',children:['finance/a']},
  {id:'care-group',label:'Care',children:['patients/a','patients/a']}
 ]);
 assert.deepEqual(sections.map(g=>g.id),['finance-group','care-group','other-pages']);
 assert.deepEqual(sections.flatMap(g=>g.children),['finance/a','patients/a','new/a']);
});
