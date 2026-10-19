import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {transaction} from './operations.js';
import {audit,hashPassword} from './db.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const schema='CREATE TABLE IF NOT EXISTS account_invitations(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,expires BIGINT NOT NULL)';
function owner(actor){if(!actor?.active||actor.role!=='owner'||!actor.permissions.includes('users.create'))throw Object.assign(Error('غير مصرح'),{status:403});}
export async function listInvitations(db,actor){owner(actor);await db.exec(schema);return db.prepare('SELECT u.id,u.name,u.email,u.role,i.expires FROM account_invitations i JOIN users u ON u.id=i.user_id ORDER BY i.expires').all();}
export async function inviteUser(db,body,actor,deliver,{ttlMinutes,now=Date.now()}={}){
 owner(actor);if(typeof deliver!=='function')throw Error('خدمة البريد غير مفعلة');
 if(!Number.isSafeInteger(ttlMinutes)||ttlMinutes<1)throw Error('يلزم تحديد مدة صلاحية الدعوة');
 const email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim();
 if(!name||name.length>200||!email||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!await db.prepare('SELECT id FROM roles WHERE id=?').get(body.role))throw Error('راجع بيانات الدعوة والدور');
 await db.exec(schema);
 const token=randomBytes(32).toString('hex'),hash=digest(token);
 const user=await transaction(db,async()=>{
  let user=await db.prepare('SELECT id,active FROM users WHERE email=?').get(email);
  if(user?.active)throw Error('الحساب موجود بالفعل');
  // Reissuing is restricted to an existing invitation; do not reactivate an administratively disabled account.
  if(user&&!await db.prepare('SELECT user_id FROM account_invitations WHERE user_id=?').get(user.id))throw Error('الحساب غير متاح للدعوة');
  if(!user){user={id:randomUUID()};await db.prepare('INSERT INTO users(id,name,email,password,role,active) VALUES(?,?,?,?,?,0)').run(user.id,name,email,'disabled',body.role);}
  await db.prepare('DELETE FROM account_invitations WHERE user_id=?').run(user.id);
  await db.prepare('INSERT INTO account_invitations(token_hash,user_id,expires) VALUES(?,?,?)').run(hash,user.id,now+ttlMinutes*60000);
  await audit(actor.id,'users.invitation.create',user.id,null,{role:body.role},db);return user;
 });
 try{await deliver({email,token,kind:'invite',ttlMinutes});}catch{await db.prepare('UPDATE account_invitations SET expires=0 WHERE token_hash=?').run(hash);throw Error('تعذر إرسال الدعوة');}
 return {ok:true,user_id:user.id};
}
export async function acceptInvitation(db,token,password,{now=Date.now(),encode=hashPassword}={}){
 if(!/^[a-f0-9]{64}$/.test(String(token||''))||String(password||'').length<12)throw Error('الرابط أو كلمة المرور غير صحيح');await db.exec(schema);
 return transaction(db,async()=>{
  const invitation=await db.prepare('DELETE FROM account_invitations WHERE token_hash=? AND expires>? RETURNING user_id').get(digest(token),now);
  if(!invitation||!await db.prepare('SELECT id FROM users WHERE id=? AND active=0').get(invitation.user_id))throw Error('الرابط انتهى أو استُخدم');
  await db.prepare('UPDATE users SET password=?,active=1 WHERE id=?').run(encode(String(password)),invitation.user_id);
  await db.prepare('DELETE FROM sessions WHERE user_id=?').run(invitation.user_id);await audit(invitation.user_id,'users.invitation.accept',invitation.user_id,null,{activated:true},db);return {ok:true};
 });
}

export async function cancelInvitations(db,userId){await db.exec(schema);await db.prepare('DELETE FROM account_invitations WHERE user_id=?').run(userId);}
