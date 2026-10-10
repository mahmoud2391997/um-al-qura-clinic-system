import {transaction} from './operations.js';
export function clinicDay(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Muscat',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
const money=n=>Math.round(n*100)/100;
export function ensureCashDayOpen(db,date){if(db.prepare('SELECT id FROM cash_closures WHERE date=?').get(date))throw Error('اليوم مقفل؛ لا يمكن تعديل حركاته النقدية');}
export function closeCashDay(db,body,actor,now=new Date()){return transaction(db,()=>{
 if(body.id)throw Error('الإقفال المعتمد لا يقبل التعديل');
 const date=String(body.date||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>=clinicDay(now))throw Error('اختر يومًا منتهيًا؛ بتوقيت سلطنة عمان');
 ensureCashDayOpen(db,date);
 for(const key of ['opening','counted'])if(body[key]===undefined||body[key]===null||String(body[key]).trim()===''||!Number.isFinite(Number(body[key]))||Number(body[key])<0)throw Error('الرصيد الافتتاحي والنقد المعدود مطلوبان بقيم غير سالبة');
 const totals=db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='Payment' THEN amount ELSE 0 END),0) collections,COALESCE(SUM(CASE WHEN kind='Refund' THEN amount ELSE 0 END),0) refunds FROM payments WHERE method='Cash' AND date(time,'+4 hours')=?").get(date);
 const expenses=db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM expenses WHERE method='Cash' AND date=?").get(date).amount;
 const opening=money(Number(body.opening)),counted=money(Number(body.counted));
 const expected=money(opening+totals.collections-totals.refunds-expenses),difference=money(counted-expected);
 const reason=String(body.reason||'').trim();if(difference!==0&&!reason)throw Error('سبب فرق الصندوق مطلوب');
 const result=db.prepare('INSERT INTO cash_closures(date,opening,collections,refunds,expenses,expected,counted,difference,reason,actor) VALUES(?,?,?,?,?,?,?,?,?,?)').run(date,opening,money(totals.collections),money(totals.refunds),money(expenses),expected,counted,difference,reason,actor);
 return {before:null,after:db.prepare('SELECT * FROM cash_closures WHERE id=?').get(result.lastInsertRowid)};
});}
