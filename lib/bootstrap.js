import {createHash,timingSafeEqual} from 'node:crypto';
export function bootstrapAuthorized(token,secret){if(typeof secret!=='string'||secret.length<32||typeof token!=='string'||token.length>256)return false;const digest=value=>createHash('sha256').update(value).digest();return timingSafeEqual(digest(token),digest(secret));}
