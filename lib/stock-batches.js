// Existing balances remain traceable as an opening batch, without inventing an expiry.
export function omanDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Muscat',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}
export function validExpiry(value) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw Error('تاريخ الصلاحية غير صحيح');
  return value;
}
export async function reconcileBatches(db, item) {
  const total = (await db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM stock_batches WHERE item_id=?').get(item.id)).n;
  if (Math.abs(total - item.quantity) > 0.000001) {
    if (total > item.quantity) throw Error('رصيد الدفعات غير مطابق للصنف');
    await db.prepare('INSERT INTO stock_batches(item_id,number,expiry,quantity,cost) VALUES(?,?,?,?,?)').run(item.id, 'OPENING-' + item.id, validExpiry(item.expiry), item.quantity - total, item.average_cost);
  }
}
export async function applyBatchMovement(db, item, body, qty) {
  await reconcileBatches(db, item);
  const today = omanDate(),
    allocations = [];
  if (body.kind === 'Receipt') {
    const number = String(body.batch_number || '').trim(),
      expiry = validExpiry(body.batch_expiry);
    if (!number) throw Error('رقم الدفعة مطلوب عند الاستلام');
    if (expiry && expiry < today) throw Error('لا يمكن استلام دفعة منتهية الصلاحية');
    const id = Number((await db.prepare('INSERT INTO stock_batches(item_id,number,expiry,quantity,cost) VALUES(?,?,?,?,?)').run(item.id, number, expiry, qty, Number(body.cost || 0))).lastInsertRowid);
    allocations.push({
      id,
      quantity: qty
    });
  } else if (body.kind === 'Issue') {
    const batches = await db.prepare("SELECT * FROM stock_batches WHERE item_id=? AND quantity>0 AND (expiry='' OR expiry>=?) ORDER BY CASE WHEN expiry='' THEN 1 ELSE 0 END,expiry,id").all(item.id, today);
    if (batches.reduce((n, b) => n + b.quantity, 0) + 0.000001 < qty) throw Error('الرصيد الصالح للصرف لا يكفي؛ الدفعات المنتهية لا تُصرف');
    let remaining = qty;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const used = Math.min(batch.quantity, remaining);
      await db.prepare('UPDATE stock_batches SET quantity=quantity-? WHERE id=?').run(used, batch.id);
      allocations.push({
        id: batch.id,
        quantity: used
      });
      remaining -= used;
    }
  } else {
    // Adjustment sets the total balance. Decrease removes expired stock first.
    let delta = qty - item.quantity;
    if (delta > 0) {
      const id = Number((await db.prepare('INSERT INTO stock_batches(item_id,number,expiry,quantity,cost) VALUES(?,?,?,?,?)').run(item.id, 'ADJUSTMENT', validExpiry(body.batch_expiry), delta, item.average_cost)).lastInsertRowid);
      allocations.push({
        id,
        quantity: delta
      });
    } else for (const batch of await db.prepare("SELECT * FROM stock_batches WHERE item_id=? AND quantity>0 ORDER BY CASE WHEN expiry<>'' AND expiry<? THEN 0 ELSE 1 END,expiry,id").all(item.id, today)) {
      if (delta >= 0) break;
      const removed = Math.min(batch.quantity, -delta);
      await db.prepare('UPDATE stock_batches SET quantity=quantity-? WHERE id=?').run(removed, batch.id);
      allocations.push({
        id: batch.id,
        quantity: -removed
      });
      delta += removed;
    }
  }
  return allocations;
}
