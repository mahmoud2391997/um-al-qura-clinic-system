// Synthetic, loopback-only acceptance: HTTPS adapter -> SMTP catcher -> actual clinic routes.
import assert from 'node:assert/strict';
import {createServer as httpsServer} from 'node:https';
import {createServer as tcpServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {mailHandler} from '../infra/mail-adapter/server.mjs';
import {verifyAuditMatrix} from './lib/audit-matrix.mjs';
import {verifySecurityBoundary} from './lib/security-boundary.mjs';
// Importing the database module must never open a normal workstation database.
process.env.CLINIC_DB=':memory:';
const {createDatabase,hashPassword}=await import('../lib/db.js');
const require=createRequire(import.meta.url);
const nodemailer=require(process.env.CLINIC_TEST_NODEMAILER || 'nodemailer');
const directory=mkdtempSync(join(tmpdir(),'clinic-mail-acceptance-'));
const messages=[];const sockets=new Set();let app;let logs='';
const smtp=tcpServer(socket=>{
 sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.setEncoding('utf8');socket.write('220 localhost synthetic catcher\r\n');
 let buffer='',data=false,lines=[];
 socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);if(data){if(line==='.') {messages.push(lines.join('\r\n'));lines=[];data=false;socket.write('250 captured\r\n')}else lines.push(line);continue;}
 if(/^(EHLO|HELO)/i.test(line))socket.write('250 localhost\r\n');else if(/^DATA/i.test(line)){data=true;socket.write('354 end with dot\r\n')}else if(/^QUIT/i.test(line))socket.end('221 bye\r\n');else socket.write('250 ok\r\n');}});
});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let adapter;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 await listen(smtp);
 const transport=nodemailer.createTransport({host:'127.0.0.1',port:smtp.address().port,secure:false,ignoreTLS:true});
 const key=randomBytes(32).toString('hex');
 adapter=httpsServer({key:readFileSync(join(directory,'key.pem')),cert:readFileSync(join(directory,'cert.pem'))},mailHandler({key,send:message=>transport.sendMail({from:'synthetic@example.test',...message})}));await listen(adapter);
 // Reserve a fresh application port, then release it immediately before startup.
 const reservation=tcpServer();await listen(reservation);const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const base='http://127.0.0.1:'+port;const filename=join(directory,'clinic.sqlite');const db=createDatabase(filename);
 const password=randomBytes(20).toString('hex');const newPassword=randomBytes(20).toString('hex');
 db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run('acceptance-owner','Synthetic Owner','owner@example.test',hashPassword(password),'owner');
 db.prepare('INSERT INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run('acceptance-physio','Synthetic Provider','physio@example.test',hashPassword(password),'physio');
 db.prepare("INSERT INTO patients(id,name,phone,creator) VALUES(1,'VISIBLE_SYNTHETIC','TEST','acceptance-physio'),(2,'PRIVATE_SYNTHETIC','TEST','acceptance-owner')").run();
 app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{cwd:resolve('.'),env:{...process.env,NODE_ENV:'development',DATABASE_URL:'',VERCEL:'',CLINIC_DB:filename,CLINIC_DEMO_ONLY:'0',CLINIC_EMAIL_ENDPOINT:'https://localhost:'+adapter.address().port+'/send',CLINIC_EMAIL_KEY:key,CLINIC_BASE_URL:'https://localhost:'+port,NODE_EXTRA_CA_CERTS:join(directory,'cert.pem')}});
 app.stdout.on('data',x=>logs=(logs+x).slice(-12000));app.stderr.on('data',x=>logs=(logs+x).slice(-12000));
 let ready=false;for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/setup');if(r.ok){ready=true;break}}catch{}await delay(500)}assert(ready,'Local application did not become ready');
 const call=async(path,body,cookie)=>{const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{origin:base,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json(),cookieOptions:r.headers.getSetCookie().find(x=>x.startsWith('clinic_session=')),cookie:r.headers.getSetCookie().find(x=>x.startsWith('clinic_session='))?.split(';')[0]}};
 if(process.env.CLINIC_SECURITY_ACCEPTANCE==='1')await verifySecurityBoundary({base,call});
 const old=await call('login',{email:'owner@example.test',password});assert.equal(old.status,200);assert(old.cookie);assert(old.cookieOptions.includes('HttpOnly'));assert(old.cookieOptions.includes('SameSite=strict'));assert(old.cookieOptions.includes('Path=/'));assert(old.cookieOptions.includes('Max-Age=28800'));assert(!old.cookieOptions.includes('Secure'),'Loopback development cookie is intentionally HTTP; production uses Secure in source');
 assert.equal((await call('password/request-reset',{email:'owner@example.test'})).status,200);assert.equal(messages.length,1);
 // Decode MIME quoted-printable wrapping before extracting the reset URL; never log it.
 const [headers,...bodyParts]=messages[0].split('\r\n\r\n');
 const raw=bodyParts.join('\r\n\r\n');
 const decoded=/Content-Transfer-Encoding: base64/i.test(headers)?Buffer.from(raw.replace(/\s/g,''),'base64').toString('utf8'):raw.replace(/=\r\n/g,'').replace(/=([A-F0-9]{2})/g,(_,x)=>String.fromCharCode(parseInt(x,16)));
 const token=decoded.match(/#reset=([a-f0-9]{64})/)?.[1];assert(token,'SMTP message contains reset link');
 assert.equal((await call('password/reset',{token,password:newPassword})).status,200);
 assert.equal((await call('me',null,old.cookie)).status,401);
 assert.equal((await call('login',{email:'owner@example.test',password})).status,401);
 const owner=await call('login',{email:'owner@example.test',password:newPassword});assert.equal(owner.status,200);
 assert.equal((await call('password/reset',{token,password:newPassword})).status,400);
 const clinician=await call('login',{email:'physio@example.test',password});assert.equal(clinician.status,200);
 const patients=await call('patients',null,clinician.cookie);assert.equal(patients.status,200);assert.deepEqual(patients.value.map(x=>x.id),[1]);
 assert.equal((await call('patients/profile/2',null,clinician.cookie)).status,403);
 assert.equal((await call('users',null,clinician.cookie)).status,403);
 assert.equal((await call('reports/export',{path:'users'},clinician.cookie)).status,403);
 const role=db.prepare("SELECT permissions FROM roles WHERE id='physio'").get();
 db.prepare("UPDATE roles SET permissions=? WHERE id='physio'").run(JSON.stringify([...JSON.parse(role.permissions),'patients.export']));
 const scopedExport=await call('reports/export',{path:'patients'},clinician.cookie);assert.equal(scopedExport.status,200);assert(scopedExport.value.csv.includes('VISIBLE_SYNTHETIC'));assert(!scopedExport.value.csv.includes('PRIVATE_SYNTHETIC'));
 const exported=await call('reports/export',{path:'patients'},owner.cookie);assert.equal(exported.status,200);assert(exported.value.csv.includes('PRIVATE_SYNTHETIC'));
 const rows=db.prepare("SELECT actor,action,entity,after_value FROM audit WHERE action LIKE 'data.%'").all();
 for(const action of ['data.read.success','data.read.denied','data.export','data.export.denied'])assert(rows.some(x=>x.action===action),action+' recorded');
 const ownRead=rows.filter(x=>x.actor==='acceptance-physio'&&x.action==='data.read.success'&&x.entity==='patients');assert.equal(ownRead.length,1);assert.equal(JSON.parse(ownRead[0].after_value).count,1);
 const ownExport=rows.find(x=>x.actor==='acceptance-physio'&&x.action==='data.export'&&x.entity==='patients');assert.equal(JSON.parse(ownExport.after_value).count,1);assert.equal(JSON.parse(ownExport.after_value).scopes.patients,'assigned');
 for(const row of rows){const metadata=JSON.parse(row.after_value);assert(metadata.role);assert(metadata.scopes);assert(!row.after_value.includes('SYNTHETIC'));assert(!row.after_value.includes(token));}
 if(process.env.CLINIC_AUDIT_MATRIX==='1')await verifyAuditMatrix({call,db,cookie:owner.cookie});
 db.close();transport.close();console.log('PASS: actual request-reset -> trusted local HTTPS adapter -> SMTP catcher -> reset -> new login; old password/session and reused token denied. Scoped reads, forbidden profile/users/export and metadata-only audits verified.');
}catch(error){console.error('Local acceptance failed:',error.message, error.stack?.split('\n').find(x=>x.includes('local-mail-acceptance.mjs:')));process.exitCode=1;}finally{
 if(app){app.kill('SIGTERM');await Promise.race([new Promise(r=>app.once('exit',r)),delay(5000)]);if(app.exitCode===null)app.kill('SIGKILL');}
 for(const socket of sockets)socket.destroy();await Promise.all([new Promise(r=>smtp.close(r)),...(adapter?[new Promise(r=>adapter.close(r))]:[])]);rmSync(directory,{recursive:true,force:true});
}
