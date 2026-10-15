import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';
const [mode,input,output,keyFile]=process.argv.slice(2);const key=Buffer.from(readFileSync(keyFile,'utf8').trim(),'base64url');if(key.length!==32)throw Error('Backup key must encode 32 bytes');
const b=readFileSync(input);let result;
if(mode==='encrypt'){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('FIVE-VPS-1'));const ciphertext=Buffer.concat([c.update(b),c.final()]);result=Buffer.concat([Buffer.from('FIVE-VPS-1'),iv,c.getAuthTag(),ciphertext]);}
else if(mode==='decrypt'){if(b.subarray(0,10).toString()!=='FIVE-VPS-1')throw Error('Invalid archive');const c=createDecipheriv('aes-256-gcm',key,b.subarray(10,22));c.setAAD(b.subarray(0,10));c.setAuthTag(b.subarray(22,38));result=Buffer.concat([c.update(b.subarray(38)),c.final()]);}else throw Error('encrypt or decrypt required');
writeFileSync(output,result,{mode:0o600,flag:'wx'});key.fill(0);result.fill(0);
