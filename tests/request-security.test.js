import test from 'node:test';import assert from 'node:assert/strict';
import {requestClientKey,mutationOriginAllowed,sessionCookieOptions} from '../lib/request-security.js';
import {publicError} from '../lib/public-errors.js';
import {securityHeaders} from '../next.config.mjs';
import {loginAllowed,loginFailure} from '../lib/auth-security.js';
import {disposableDatabase,databaseDialects,databaseOptions} from './helpers/disposable-db.js';
test('client IP identity rejects spoofed forwarding headers and accepts only authenticated proxy IP headers',()=>{
 const secret='synthetic-proxy-token-'.repeat(2),headers=address=>new Headers({'x-clinic-client-ip':address,'x-clinic-proxy-token':secret});
 const a=requestClientKey(headers('192.0.2.1'),secret),b=requestClientKey(headers('192.0.2.2'),secret);assert.notEqual(a,b);
 const untrusted=requestClientKey(new Headers({'x-forwarded-for':'192.0.2.1'}),secret);
 assert.equal(untrusted,requestClientKey(headers('192.0.2.1'),'different-secret'.repeat(3)));
 assert.equal(untrusted,requestClientKey(headers('not-an-ip'),secret));assert.equal(untrusted,requestClientKey(new Headers(),undefined));
});
test('cookie mutations enforce scheme and origin; API errors cannot reflect unknown messages or traces',()=>{
 const request=origin=>({url:'https://clinic.example.test/api/patients',headers:new Headers(origin?{origin}:{})});
 assert.equal(mutationOriginAllowed(request('https://clinic.example.test')),true);assert.equal(mutationOriginAllowed(request('http://clinic.example.test')),false);assert.equal(mutationOriginAllowed(request('https://foreign.example.test')),false);assert.equal(mutationOriginAllowed(request()),false);
 for(const message of ['postgresql://user:secret@host/db','Error: secret\n at handler:1','رمز سري leaked-secret-value','duplicate key value violates unique constraint'])assert(!publicError(message).includes('secret'));
 const csp=securityHeaders.find(h=>h.key==='Content-Security-Policy').value;for(const directive of ["default-src 'self'","frame-ancestors 'none'","form-action 'self'","object-src 'none'"])assert(csp.includes(directive));
});
for(const dialect of databaseDialects)test(dialect+': independent account and IP buckets expire and prevent cross-account spray',databaseOptions(dialect),()=>disposableDatabase(dialect,async db=>{
 const now=1000000;for(let i=0;i<5;i++)await loginFailure(db,'ip:login:synthetic',now);
 assert.equal(await loginAllowed(db,'ip:login:synthetic',now+1),false);assert.equal(await loginAllowed(db,'different-account@example.test',now+1),true);
 assert.equal(await loginAllowed(db,'ip:login:other-ip',now+1),true);assert.equal(await loginAllowed(db,'ip:login:synthetic',now+900001),true);
}));

test('production cookies are Secure, HttpOnly, Strict and scoped to the application',()=>{
 assert.deepEqual(sessionCookieOptions(28800,true),{httpOnly:true,sameSite:'strict',secure:true,path:'/',maxAge:28800});
 assert.equal(sessionCookieOptions(3600,false).secure,false);
});
