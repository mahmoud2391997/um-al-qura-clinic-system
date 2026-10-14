import { asyncMap, asyncEvery } from "./async-collections.js";
import { transaction, stockMovement } from './operations.js';
import { audit } from './db.js';
import { validExpiry } from './stock-batches.js';
export const permission = (actor, action) => {
  if (!actor.active || !actor.permissions.includes('purchasing.' + action)) throw Error('ليس لديك صلاحية المشتريات لهذا الإجراء');
};
export const visible = (request, actor) => request.creator === actor.id || actor.permissions.includes('purchasing.approve');
function required(value, label) {
  if (!String(value ?? '').trim()) throw Error(label + ' مطلوب');
  return String(value).trim();
}
async function itemsFor(db, input) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw Error('أضف أصناف الطلب');
  const seen = new Set();
  return await asyncMap(input, async row => {
    const id = Number(row.item_id),
      quantity = Number(row.quantity),
      price = Number(row.price);
    if (!Number.isInteger(id) || !(await db.prepare('SELECT id FROM inventory WHERE id=?').get(id))) throw Error('الصنف غير موجود');
    if (seen.has(id)) throw Error('لا تكرر الصنف في الطلب');
    seen.add(id);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) throw Error('الكمية أو السعر غير صحيح');
    return {
      item_id: id,
      quantity,
      price
    };
  });
}
export async function requestFor(db, id, actor) {
  const request = await db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(id);
  if (!request || !visible(request, actor)) throw Error('الطلب غير متاح');
  return request;
}
export async function listPurchasing(db, path, actor) {
  permission(actor, 'view');
  const all = actor.permissions.includes('purchasing.approve');
  if (path === 'purchasing/catalog') return await db.prepare('SELECT id,name,unit,quantity FROM inventory ORDER BY name').all();
  if (path === 'purchasing/requests') return (await db.prepare('SELECT p.*,u.name requester FROM purchase_requests p JOIN users u ON u.id=p.creator WHERE ? OR p.creator=? ORDER BY p.id DESC').all(Number(all), actor.id)).map(r => ({
    ...r,
    items: JSON.parse(r.items)
  }));
  if (path === 'purchasing/orders') return await asyncMap(await db.prepare('SELECT o.*,r.title,COALESCE(o.supplier,r.supplier) supplier,r.creator requester_id,COALESCE(o.items,r.items) items,COALESCE(o.total,r.total) total FROM purchase_orders o JOIN purchase_requests r ON r.id=o.request_id WHERE ? OR r.creator=? ORDER BY o.id DESC').all(Number(all), actor.id), async o => ({
    ...o,
    items: await asyncMap(JSON.parse(o.items), async i => ({
      ...i,
      received: (await db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM purchase_receipts WHERE order_id=? AND item_id=?').get(o.id, i.item_id)).n
    }))
  }));
  return await db.prepare('SELECT t.*,i.name item FROM purchase_receipts t JOIN inventory i ON i.id=t.item_id JOIN purchase_orders o ON o.id=t.order_id JOIN purchase_requests r ON r.id=o.request_id WHERE ? OR r.creator=? ORDER BY t.id DESC').all(Number(all), actor.id);
}
export async function savePurchasing(db, path, body, actor) {
  return await transaction(db, async () => {
    let before = null,
      after = null;
    if (path === 'purchasing/requests') {
      if (['approve', 'reject'].includes(body.action)) {
        permission(actor, 'approve');
        before = await requestFor(db, body.id, actor);
        if (before.status !== 'Submitted') throw Error('الطلب ليس بانتظار الموافقة');
        if (actor.role !== 'owner' && before.total > (await db.prepare('SELECT approval_limit FROM purchasing_policy WHERE id=1').get()).approval_limit) throw Error('القيمة تتجاوز حد الاعتماد؛ يلزم المالك');
        if (before.creator === actor.id) throw Error('لا يجوز اعتماد أو رفض طلبك بنفسك');
        const reason = body.action === 'reject' ? required(body.decision_reason, 'سبب الرفض') : String(body.decision_reason || '');
        await db.prepare('UPDATE purchase_requests SET status=?,reviewer=?,decision_reason=? WHERE id=?').run(body.action === 'approve' ? 'Approved' : 'Rejected', actor.id, reason, before.id);
        after = await db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(before.id);
      } else {
        if (body.id) {
          permission(actor, 'edit');
          before = await requestFor(db, body.id, actor);
          if (before.creator !== actor.id || before.status !== 'Draft') throw Error('التعديل لمقدم الطلب على المسودة فقط');
        } else permission(actor, 'create');
        const items = await itemsFor(db, body.items),
          total = items.reduce((n, i) => n + i.quantity * i.price, 0);
        if (!Number.isFinite(total)) throw Error('إجمالي الطلب غير صحيح');
        const values = [required(body.title, 'العنوان'), required(body.department, 'القسم'), validExpiry(required(body.needed, 'تاريخ الاحتياج')), required(body.priority, 'الأولوية'), required(body.reason, 'سبب الطلب'), String(body.supplier || ''), String(body.cost_center || ''), body.action === 'submit' ? 'Submitted' : 'Draft', JSON.stringify(items), total];
        if (!['Normal', 'High', 'Critical'].includes(body.priority)) throw Error('الأولوية غير صحيحة');
        let id = body.id;
        if (id) await db.prepare('UPDATE purchase_requests SET title=?,department=?,needed=?,priority=?,reason=?,supplier=?,cost_center=?,status=?,items=?,total=? WHERE id=?').run(...values, id);else id = Number((await db.prepare('INSERT INTO purchase_requests(title,department,needed,priority,reason,supplier,cost_center,status,items,total,creator) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...values, actor.id)).lastInsertRowid);
        after = await db.prepare('SELECT * FROM purchase_requests WHERE id=?').get(id);
      }
    } else if (path === 'purchasing/orders' && body.action === 'convert') {
      permission(actor, 'create');
      const request = await requestFor(db, body.request_id, actor);
      if (request.status !== 'Approved') throw Error('اعتماد الطلب مطلوب قبل أمر الشراء');
      const existing = await db.prepare('SELECT * FROM purchase_orders WHERE request_id=?').get(request.id);
      if (existing) return {
        before: null,
        after: existing
      };
      const quote = body.quote_id ? await db.prepare("SELECT * FROM supplier_quotes WHERE id=? AND request_id=? AND status='Approved'").get(body.quote_id, request.id) : null;
      if (body.quote_id && !quote) throw Error('عرض السعر المعتمد غير متاح');
      const id = Number((await db.prepare('INSERT INTO purchase_orders(request_id,creator,items,supplier,total,quote_id) VALUES(?,?,?,?,?,?)').run(request.id, actor.id, quote?.items || request.items, quote?.supplier || request.supplier, quote?.total ?? request.total, quote?.id || null)).lastInsertRowid);
      after = await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);
    } else if (path === 'purchasing/orders' && body.action === 'receive') {
      permission(actor, 'edit');
      const order = await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.id);
      if (!order) throw Error('أمر الشراء غير موجود');
      const request = await requestFor(db, order.request_id, actor);
      const key = required(body.idempotency_key, 'معرف الاستلام');
      if (key.length > 200) throw Error('معرف الاستلام غير صحيح');
      const existing = await db.prepare('SELECT * FROM purchase_receipts WHERE idempotency_key=?').get(key);
      if (existing) {
        if (existing.order_id !== order.id || existing.item_id !== Number(body.item_id) || existing.quantity !== Number(body.quantity) || existing.batch_number !== String(body.batch_number) || existing.batch_expiry !== String(body.batch_expiry || '') || existing.reference !== String(body.reference || '')) throw Error('معرف الاستلام مستخدم لعملية مختلفة');
        return {
          before: null,
          after: existing
        };
      }
      if (order.status === 'Received') throw Error('تم استلام أمر الشراء بالكامل');
      const line = JSON.parse(order.items || request.items).find(i => i.item_id === Number(body.item_id));
      if (!line) throw Error('الصنف ليس ضمن أمر الشراء');
      const qty = Number(body.quantity),
        received = (await db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM purchase_receipts WHERE order_id=? AND item_id=?').get(order.id, line.item_id)).n;
      if (!Number.isFinite(qty) || qty <= 0 || qty > line.quantity - received) throw Error('الكمية تتجاوز المتبقي في أمر الشراء');
      await stockMovement(db, {
        item_id: line.item_id,
        kind: 'Receipt',
        quantity: qty,
        cost: line.price,
        batch_number: body.batch_number,
        batch_expiry: body.batch_expiry,
        reference: 'PO-' + order.id + ' ' + String(body.reference || ''),
        reason: 'استلام أمر شراء معتمد'
      }, actor.id);
      const receiptId = Number((await db.prepare('INSERT INTO purchase_receipts(order_id,item_id,quantity,batch_number,batch_expiry,reference,actor,idempotency_key) VALUES(?,?,?,?,?,?,?,?)').run(order.id, line.item_id, qty, body.batch_number, body.batch_expiry || '', body.reference || '', actor.id, key)).lastInsertRowid);
      const complete = await asyncEvery(JSON.parse(order.items || request.items), async i => (await db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM purchase_receipts WHERE order_id=? AND item_id=?').get(order.id, i.item_id)).n >= i.quantity);
      before = order;
      await db.prepare('UPDATE purchase_orders SET status=? WHERE id=?').run(complete ? 'Received' : 'Partial', order.id);
      after = {
        ...(await db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(order.id)),
        receipt_id: receiptId
      };
    } else throw Error('إجراء المشتريات غير صحيح');
    await audit(actor.id, path + '.' + (body.action || 'save'), String(after.id), before, after, db);
    return {
      before,
      after
    };
  });
}
