import { asyncReduce, asyncMap } from "./async-collections.js";
import { transaction } from './operations.js';
import { audit } from './db.js';
import { permission, requestFor, visible } from './purchasing.js';
import { validExpiry, omanDate } from './stock-batches.js';
import { ensureCashDayOpen } from './cashbox.js';
const finance = (actor, action) => {
  if (!actor.active || !actor.permissions.includes('finance.' + action)) throw Error('صلاحية المالية مطلوبة');
};
const round = n => Math.round(n * 1000) / 1000;
function text(value, label) {
  const s = String(value || '').trim();
  if (!s) throw Error(label + ' مطلوب');
  return s;
}
async function orderValue(db, o) {
  const request = await db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(o.request_id);
  return {
    ...o,
    items: JSON.parse(o.items || request.items),
    supplier: o.supplier || request.supplier,
    total: o.total ?? request.total
  };
}
async function invoicable(db, o) {
  return round(await asyncReduce(o.items, async (n, i) => n + (await db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM purchase_receipts WHERE order_id=? AND item_id=?').get(o.id, i.item_id)).n * i.price, 0));
}
export const extraPaths = ['purchasing/quotes', 'purchasing/policy', 'purchasing/attachments', 'purchasing/invoices', 'purchasing/invoice-orders'];
export async function listExtras(db, path, actor) {
  if (path === 'purchasing/policy') {
    if (!actor.active || actor.role !== 'owner') throw Error('إعداد السياسة للمالك');
    return [await db.prepare('SELECT * FROM purchasing_policy').get()];
  }
  if (path === 'purchasing/invoices') {
    finance(actor, 'view');
    return await asyncMap(await db.prepare('SELECT i.*,COALESCE(o.supplier,r.supplier) supplier FROM supplier_invoices i JOIN purchase_orders o ON o.id=i.order_id JOIN purchase_requests r ON r.id=o.request_id ORDER BY i.id DESC').all(), async i => ({
      ...i,
      paid: (await db.prepare('SELECT COALESCE(SUM(amount),0) n FROM supplier_payments WHERE invoice_id=?').get(i.id)).n,
      payments: await db.prepare('SELECT id,amount,method,date,reference FROM supplier_payments WHERE invoice_id=? ORDER BY id').all(i.id)
    }));
  }
  if (path === 'purchasing/invoice-orders') {
    finance(actor, 'view');
    return await asyncMap(await db.prepare("SELECT * FROM purchase_orders WHERE status IN ('Partial','Received') ORDER BY id DESC").all(), async o => {
      const order = await orderValue(db, o);
      return {
        id: o.id,
        supplier: order.supplier,
        available: round((await invoicable(db, order)) - (await db.prepare('SELECT COALESCE(SUM(amount),0) n FROM supplier_invoices WHERE order_id=?').get(o.id)).n)
      };
    });
  }
  permission(actor, 'view');
  const all = Number(actor.permissions.includes('purchasing.approve'));
  if (path === 'purchasing/quotes') return (await db.prepare('SELECT q.*,r.title FROM supplier_quotes q JOIN purchase_requests r ON r.id=q.request_id WHERE ? OR r.creator=? ORDER BY q.id DESC').all(all, actor.id)).map(q => ({
    ...q,
    items: JSON.parse(q.items)
  }));
  return await db.prepare('SELECT a.id,a.request_id,a.name,a.mime,a.size,a.actor,a.time FROM purchase_attachments a JOIN purchase_requests r ON r.id=a.request_id WHERE ? OR r.creator=? ORDER BY a.id DESC').all(all, actor.id);
}
export async function saveExtras(db, path, body, actor) {
  return await transaction(db, async () => {
    let before = null,
      after;
    if (path === 'purchasing/policy') {
      if (!actor.active || actor.role !== 'owner') throw Error('إعداد السياسة للمالك');
      for (const k of ['approval_limit', 'payment_limit']) if (body[k] === undefined || String(body[k]).trim() === '' || !Number.isFinite(Number(body[k])) || Number(body[k]) < 0) throw Error('حد الموافقة غير صحيح');
      before = await db.prepare('SELECT * FROM purchasing_policy').get();
      await db.prepare('UPDATE purchasing_policy SET approval_limit=?,payment_limit=? WHERE id=1').run(Number(body.approval_limit), Number(body.payment_limit));
      after = await db.prepare('SELECT * FROM purchasing_policy').get();
    } else if (path === 'purchasing/quotes') {
      if (body.action === 'approve') {
        permission(actor, 'approve');
        before = await db.prepare('SELECT * FROM supplier_quotes WHERE id=?').get(body.id);
        if (!before) throw Error('العرض غير موجود');
        await requestFor(db, before.request_id, actor);
        if (before.status !== 'Submitted') throw Error('العرض معتمد بالفعل');
        if (before.creator === actor.id) throw Error('لا تعتمد عرضًا أنشأته بنفسك');
        if (actor.role !== 'owner' && before.total > (await db.prepare('SELECT approval_limit FROM purchasing_policy').get()).approval_limit) throw Error('العرض يتجاوز حد الاعتماد؛ يلزم المالك');
        await db.prepare("UPDATE supplier_quotes SET status='Approved',reviewer=? WHERE id=?").run(actor.id, before.id);
        after = await db.prepare('SELECT * FROM supplier_quotes WHERE id=?').get(before.id);
      } else {
        permission(actor, 'create');
        const r = await requestFor(db, body.request_id, actor);
        if (r.status !== 'Approved') throw Error('الطلب يحتاج اعتمادًا قبل عروض الموردين');
        if (await db.prepare('SELECT id FROM purchase_orders WHERE request_id=?').get(r.id)) throw Error('أمر الشراء موجود؛ لا تضف عروضًا بعد التحويل');
        const base = JSON.parse(r.items);
        if (!Array.isArray(body.items) || body.items.length !== base.length) throw Error('العرض يجب أن يغطي كل أصناف الطلب');
        const used = new Set();
        const items = body.items.map(i => {
          const line = base.find(b => b.item_id === Number(i.item_id));
          const price = Number(i.price);
          if (!line || used.has(line.item_id) || !Number.isFinite(price) || price < 0) throw Error('أصناف أو أسعار العرض غير صحيحة');
          used.add(line.item_id);
          return {
            ...line,
            price
          };
        });
        const total = round(items.reduce((n, i) => n + i.quantity * i.price, 0));
        if (!Number.isFinite(total)) throw Error('الإجمالي غير صحيح');
        const id = Number((await db.prepare('INSERT INTO supplier_quotes(request_id,supplier,items,total,creator) VALUES(?,?,?,?,?)').run(r.id, text(body.supplier, 'المورد'), JSON.stringify(items), total, actor.id)).lastInsertRowid);
        after = await db.prepare('SELECT * FROM supplier_quotes WHERE id=?').get(id);
      }
    } else if (path === 'purchasing/attachments') {
      if (body.action === 'download') {
        permission(actor, 'view');
        const a = await db.prepare('SELECT * FROM purchase_attachments WHERE id=?').get(body.id);
        if (!a) throw Error('المرفق غير موجود');
        await requestFor(db, a.request_id, actor);
        return {
          file: {
            name: a.name,
            mime: a.mime,
            data: a.data
          }
        };
      }
      permission(actor, 'edit');
      const r = await requestFor(db, body.request_id, actor);
      if (r.creator !== actor.id && !actor.permissions.includes('purchasing.approve')) throw Error('المرفق غير متاح');
      const name = text(body.name, 'اسم الملف').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 120),
        mime = String(body.mime),
        data = String(body.data || '');
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mime) || !data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw Error('المسموح PDF أو PNG أو JPEG');
      const bytes = Buffer.from(data, 'base64');
      if (bytes.length > 2 * 1024 * 1024) throw Error('حجم الملف يتجاوز 2 ميجابايت');
      const signature = mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : bytes.subarray(0, 3).toString('hex') === 'ffd8ff';
      if (!signature) throw Error('محتوى الملف لا يطابق نوعه');
      if ((await db.prepare('SELECT COUNT(*) n FROM purchase_attachments WHERE request_id=?').get(r.id)).n >= 10 || (await db.prepare('SELECT COALESCE(SUM(size),0) n FROM purchase_attachments').get()).n + bytes.length > 10 * 1024 * 1024) throw Error('حد تخزين مرفقات الديمو ممتلئ');
      const id = Number((await db.prepare('INSERT INTO purchase_attachments(request_id,name,mime,size,data,actor) VALUES(?,?,?,?,?,?)').run(r.id, name, mime, bytes.length, data, actor.id)).lastInsertRowid);
      after = {
        id,
        request_id: r.id,
        name,
        mime,
        size: bytes.length
      };
    } else if (path === 'purchasing/invoices') {
      if (body.action === 'pay') {
        finance(actor, 'edit');
        const invoice = await db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(body.id);
        if (!invoice) throw Error('الفاتورة غير موجودة');
        const amount = round(Number(body.amount)),
          date = validExpiry(text(body.date, 'تاريخ السداد')),
          key = text(body.idempotency_key, 'معرف السداد'),
          method = String(body.method),
          reference = text(body.reference, 'مرجع السداد');
        if (date > omanDate()) throw Error('تاريخ السداد لا يكون في المستقبل');
        if (!Number.isFinite(amount) || amount <= 0 || !['Cash', 'Card', 'Transfer', 'Other'].includes(method)) throw Error('بيانات السداد غير صحيحة');
        const duplicate = await db.prepare('SELECT * FROM supplier_payments WHERE idempotency_key=?').get(key);
        if (duplicate) {
          if (duplicate.invoice_id !== invoice.id || duplicate.amount !== amount || duplicate.method !== method || duplicate.date !== date || duplicate.reference !== reference) throw Error('معرف السداد مستخدم لعملية مختلفة');
          return {
            before: null,
            after: duplicate
          };
        }
        if (actor.role !== 'owner' && amount > (await db.prepare('SELECT payment_limit FROM purchasing_policy').get()).payment_limit) throw Error('السداد يتجاوز حد الموظف؛ يلزم المالك');
        const paid = (await db.prepare('SELECT COALESCE(SUM(amount),0) n FROM supplier_payments WHERE invoice_id=?').get(invoice.id)).n;
        if (amount > round(invoice.amount - paid)) throw Error('السداد يتجاوز المتبقي');
        if (method === 'Cash') await ensureCashDayOpen(db, date);
        const id = Number((await db.prepare('INSERT INTO supplier_payments(invoice_id,amount,method,date,reference,actor,idempotency_key) VALUES(?,?,?,?,?,?,?)').run(invoice.id, amount, method, date, reference, actor.id, key)).lastInsertRowid);
        const order = await orderValue(db, await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(invoice.order_id));
        await db.prepare('INSERT INTO expenses(title,category,supplier,amount,date,method,reference,supplier_payment_id) VALUES(?,?,?,?,?,?,?,?)').run('سداد فاتورة مورد ' + invoice.number, 'مشتريات', order.supplier, amount, date, method, reference, id);
        after = await db.prepare('SELECT * FROM supplier_payments WHERE id=?').get(id);
      } else {
        finance(actor, 'create');
        const raw = await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.order_id);
        if (!raw) throw Error('أمر الشراء غير موجود');
        const o = await orderValue(db, raw),
          amount = round(Number(body.amount));
        const used = (await db.prepare('SELECT COALESCE(SUM(amount),0) n FROM supplier_invoices WHERE order_id=?').get(o.id)).n;
        if (!Number.isFinite(amount) || amount <= 0 || amount > round((await invoicable(db, o)) - used)) throw Error('الفاتورة تتجاوز قيمة المستلم غير المفوتر');
        const id = Number((await db.prepare('INSERT INTO supplier_invoices(order_id,number,amount,date,actor) VALUES(?,?,?,?,?)').run(o.id, text(body.number, 'رقم فاتورة المورد'), amount, validExpiry(text(body.date, 'تاريخ الفاتورة')), actor.id)).lastInsertRowid);
        after = await db.prepare('SELECT * FROM supplier_invoices WHERE id=?').get(id);
      }
    } else throw Error('الإجراء غير صحيح');
    await audit(actor.id, path + '.' + (body.action || 'save'), String(after.id), before, after, db);
    return {
      before,
      after
    };
  });
}
