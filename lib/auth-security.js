export function loginAllowed(db,email,now=Date.now()){db.prepare('DELETE FROM login_attempts WHERE started<?').run(now-15*60*1000);return (db.prepare('SELECT failures FROM login_attempts WHERE email=?').get(email)?.failures||0)<5;}
export function loginFailure(db,email,now=Date.now()){db.prepare('INSERT INTO login_attempts(email,failures,started) VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET failures=failures+1').run(email,now);}
export function loginSuccess(db,email){db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);}
export function revokeSessions(db,id){if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))throw Error('الحساب غير موجود');return db.prepare('DELETE FROM sessions WHERE user_id=?').run(id).changes;}
