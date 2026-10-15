import {createServer} from 'node:http';import {timingSafeEqual,createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const digest=x=>createHash('sha256').update(x).digest();
export function mailHandler({key,send}){
 if(!key||key.length<32)throw Error('CLINIC_EMAIL_KEY must contain at least 32 characters');
 return async(req,res)=>{const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 if(req.url==='/health'&&req.method==='GET')return reply(200,{ok:true});
 if(req.url!=='/send'||req.method!=='POST')return reply(404,{ok:false});
 if(!timingSafeEqual(digest(req.headers.authorization||''),digest('Bearer '+key)))return reply(401,{ok:false});
 try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return reply(413,{ok:false})}const value=JSON.parse(body);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.to||'')||typeof value.subject!=='string'||!value.subject.trim()||value.subject.length>200||/[\r\n]/.test(value.subject)||typeof value.text!=='string'||!value.text.trim()||value.text.length>12000)return reply(400,{ok:false});
 await send({to:value.to,subject:value.subject,text:value.text});reply(200,{ok:true});
 }catch{reply(502,{ok:false})}
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {default:nodemailer}=await import('nodemailer');
 for(const k of ['SMTP_HOST','SMTP_FROM','CLINIC_EMAIL_KEY'])if(!process.env[k])throw Error(k+' is required');
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='true',requireTLS:process.env.NODE_ENV==='production'&&process.env.SMTP_SECURE!=='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined,connectionTimeout:10000,socketTimeout:15000});
 createServer(mailHandler({key:process.env.CLINIC_EMAIL_KEY,send:message=>transport.sendMail({from:process.env.SMTP_FROM,...message})})).listen(3000,'0.0.0.0');
}
