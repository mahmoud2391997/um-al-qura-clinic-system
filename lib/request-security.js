import {createHash,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
const hash=value=>createHash('sha256').update(value).digest();
export function requestClientKey(headers,secret=process.env.CLINIC_TRUSTED_PROXY_TOKEN){
 const supplied=headers.get('x-clinic-proxy-token'),address=headers.get('x-clinic-client-ip');
 // Standard Request has no authenticated remote socket address. Never trust an
 // arbitrary X-Forwarded-For. Unresolved callers share a conservative bucket.
 const trusted=typeof secret==='string'&&secret.length>=32&&typeof supplied==='string'&&timingSafeEqual(hash(secret),hash(supplied));
 return hash(trusted&&isIP(address||'')?address:'unresolved-client').toString('hex');
}
export function mutationOriginAllowed(req,base){
 try{
  const origin=req.headers.get('origin');if(!origin)return false;
  const expected=new URL(base||req.url);
  if(!base&&req.headers.get('host'))expected.host=req.headers.get('host');
  return new URL(origin).origin===expected.origin;
 }catch{return false;}
}
export function sessionCookieOptions(maxAge,production=process.env.NODE_ENV==='production'){
 return {httpOnly:true,sameSite:'strict',secure:production,path:'/',maxAge};
}
