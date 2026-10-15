import test from 'node:test';import assert from 'node:assert/strict';
import {demoEnabled,demoSession,restoreDemoSession} from '../lib/demo.js';
test('canonical demo flags override legacy settings and revoke existing sample tokens when disabled',async()=>{
 const previous=process.env.DEMO_MODE,legacy=process.env.CLINIC_DEMO;
 try {
  process.env.CLINIC_DEMO='0';
  for(const value of ['on','true','1']){process.env.DEMO_MODE=value;assert.equal(demoEnabled(),true)}
  const session=await demoSession('owner');assert.ok(await restoreDemoSession(session.token));
  for(const value of ['off','false','0']){process.env.DEMO_MODE=value;assert.equal(demoEnabled(),false);assert.equal(await restoreDemoSession(session.token),false)}
 } finally {if(previous===undefined)delete process.env.DEMO_MODE;else process.env.DEMO_MODE=previous;if(legacy===undefined)delete process.env.CLINIC_DEMO;else process.env.CLINIC_DEMO=legacy;}
});
