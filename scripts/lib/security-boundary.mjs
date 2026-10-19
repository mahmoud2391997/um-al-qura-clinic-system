import assert from 'node:assert/strict';
export async function verifySecurityBoundary({base,call,proxyHeaders={}}){
 const response=await fetch(base+'/api/environment');assert(response.headers.get('cache-control').includes('no-store'),'API responses are not browser-cached');
 for(const [header,value]of [['x-content-type-options','nosniff'],['x-frame-options','DENY'],['referrer-policy','strict-origin-when-cross-origin']])assert.equal(response.headers.get(header),value,'Application '+header);
 assert(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert.equal(response.headers.get('x-powered-by'),null);
 for(const origin of [undefined,'https://foreign.example.test']){
  const denied=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify({email:'unknown@example.test',password:'synthetic-password-only'})});assert.equal(denied.status,403,'Missing/foreign origin rejected');
 }
 for(let i=0;i<5;i++)assert.equal((await call('login',{email:'rate-limit@example.test',password:'synthetic-password-only'},null,proxyHeaders)).status,401);
 assert.equal((await call('login',{email:'rate-limit@example.test',password:'synthetic-password-only'},null,proxyHeaders)).status,429);
 assert.equal((await call('login',{email:'separate@example.test',password:'synthetic-password-only'},null,{...proxyHeaders,'x-clinic-client-ip':'192.0.2.112'})).status,401,'Failure throttle is account-specific');
 assert.equal((await call('login',{email:'spray-other@example.test',password:'synthetic-password-only'},null,proxyHeaders)).status,429,'IP bucket stops cross-account spraying');
 const automation=await fetch(base+'/api/automation/run',{method:'POST',headers:{authorization:'Bearer invalid-synthetic-key'}});assert.equal(automation.status,403,'Scheduler requires independent secret');
 console.log('PASS: actual app security headers, missing/foreign origin rejection, five-failure login throttle/account isolation and scheduler secret boundary.');
}
