import {validateAsset, validateVendor, completeAssetMaintenance} from './assets.js';
import { asyncMap } from "./async-collections.js";
import { usedPackageSessions } from './package-returns.js';
import { assignedScope, scopeRows } from './data-scopes.js';
import { linkSessionBilling, sessionIncome } from './session-billing.js';
import { templateDefaults } from './clinical-programs.js';
import { bookWaiting, sellPackage } from './appointment-workflow.js';
import { replaceComponent, renewLicense, payObligation } from './equipment-renewals.js';
import { applyBatchMovement, reconcileBatches, omanDate } from './stock-batches.js';
import { closeCashDay, ensureCashDayOpen } from './cashbox.js';
import { operationPages } from './operations-config.js';
let transactionSequence = 0;
export async function transaction(db, fn) {
  const savepoint = 'clinic_tx_' + ++transactionSequence;
  await db.exec('SAVEPOINT ' + savepoint);
  try {
    const result = await fn();
    await db.exec('RELEASE SAVEPOINT ' + savepoint);
    return result;
  } catch (e) {
    await db.exec('ROLLBACK TO SAVEPOINT ' + savepoint);
    await db.exec('RELEASE SAVEPOINT ' + savepoint);
    throw e;
  }
}
function requireValue(v, message) {
  if (v === undefined || v === null || String(v).trim() === '') throw Error(message);
}
function positive(v, message, zero = false) {
  const n = Number(v);
  if (!Number.isFinite(n) || (zero ? n < 0 : n <= 0)) throw Error(message);
  return n;
}
export async function stockMovement(db, body, actor) {
  return await transaction(db, async () => {
    const item = await db.prepare('SELECT * FROM inventory WHERE id=?').get(body.item_id);
    if (!item) throw Error('الصنف غير موجود');
    const qty = positive(body.quantity, 'الكمية غير صحيحة', body.kind === 'Adjustment');
    if (!['Receipt', 'Issue', 'Adjustment'].includes(body.kind)) throw Error('نوع الحركة غير صحيح');
    requireValue(body.reason, 'سبب الحركة مطلوب');
    const cost = positive(body.cost || 0, 'التكلفة غير صحيحة', true);
    const next = body.kind === 'Receipt' ? item.quantity + qty : body.kind === 'Issue' ? item.quantity - qty : qty;
    if (next < 0) throw Error('الرصيد لا يسمح بالصرف');
    const allocations = await applyBatchMovement(db, item, body, qty);
    const average = body.kind === 'Receipt' ? (item.quantity * item.average_cost + qty * cost) / next : item.average_cost;
    await db.prepare('UPDATE inventory SET quantity=?,average_cost=? WHERE id=?').run(next, average, item.id);
    const movement = await db.prepare('INSERT INTO stock_movements(item_id,kind,quantity,cost,reference,reason,actor) VALUES(?,?,?,?,?,?,?)').run(item.id, body.kind, qty, cost, body.reference || '', body.reason, actor);
    for (const a of allocations) await db.prepare('INSERT INTO stock_allocations(movement_id,batch_id,quantity) VALUES(?,?,?)').run(Number(movement.lastInsertRowid), a.id, a.quantity);
    return {
      before: item,
      after: {
        ...item,
        quantity: next,
        average_cost: average
      },
      movement_id: Number(movement.lastInsertRowid)
    };
  });
}
export async function consumeEquipment(db, body, actor) {
  return await transaction(db, async () => {
    const device = await db.prepare('SELECT * FROM equipment WHERE id=?').get(body.id);
    if (!device) throw Error('الجهاز غير موجود');
    const fault = await db.prepare("SELECT id FROM maintenance WHERE equipment_id=? AND priority='Critical' AND status<>'Completed'").get(body.id);
    if (device.status !== 'Active' || fault) throw Error('الجهاز خارج الخدمة أو عليه عطل حرج');
    const qty = positive(body.quantity, 'عدد الاستخدامات يجب أن يكون موجبًا');
    if (!Number.isInteger(qty) || device.used + qty > device.capacity) throw Error('الاستخدام يتجاوز رصيد العداد');
    requireValue(body.reference, 'مرجع الجلسة مطلوب');
    await db.prepare('UPDATE equipment SET used=used+? WHERE id=?').run(qty, body.id);
    await db.prepare('UPDATE equipment_components SET used=used+? WHERE equipment_id=? AND end IS NULL').run(qty, body.id);
    await db.prepare('INSERT INTO equipment_usage(equipment_id,quantity,reference,actor) VALUES(?,?,?,?)').run(body.id, qty, body.reference, actor);
    return {
      before: device,
      after: {
        ...device,
        used: device.used + qty
      }
    };
  });
}
export async function listOperations(db, path, permissions = [], actor = null) {
  if (path === 'clinical/home-followup') return (await db.prepare('SELECT f.*,c.provider,p.name patient FROM program_followups f JOIN clinical c ON c.id=f.program_id JOIN patients p ON p.id=c.patient_id ORDER BY f.date DESC,f.id DESC').all()).map(r => ({
    ...r,
    adherence: Math.round(r.completed / r.planned * 100)
  }));
  if (path === 'inventory/batches') {
    for (const item of await db.prepare('SELECT * FROM inventory').all()) await reconcileBatches(db, item);
    const today = omanDate();
    return (await db.prepare('SELECT b.*,i.name item FROM stock_batches b JOIN inventory i ON i.id=b.item_id ORDER BY b.expiry,b.id').all()).map(b => ({
      ...b,
      status: !b.expiry ? 'بدون صلاحية محددة' : b.expiry < today ? 'منتهية' : Date.parse(b.expiry) - Date.parse(today) <= 30 * 86400000 ? 'قريبة الانتهاء' : 'صالحة'
    }));
  }
  if (path === 'appointments/waiting') return await db.prepare('SELECT w.*,p.name patient FROM waiting_list w JOIN patients p ON p.id=w.patient_id ORDER BY w.desired,w.id').all();
  if (path === 'tasks/escalations') return await db.prepare('SELECT e.task_id id,e.*,t.title FROM task_escalations e JOIN tasks t ON t.id=e.task_id ORDER BY e.time DESC').all();
  if (path === 'equipment/components') return await db.prepare('SELECT c.*,e.name device FROM equipment_components c JOIN equipment e ON e.id=c.equipment_id ORDER BY c.id DESC').all();
  if (path === 'compliance/history') return await db.prepare('SELECT v.*,l.title FROM license_versions v JOIN licenses l ON l.id=v.license_id ORDER BY v.id DESC').all();
  if (path === 'compliance/payments') return await db.prepare('SELECT p.*,o.title FROM obligation_payments p JOIN obligations o ON o.id=p.obligation_id ORDER BY p.id DESC').all();
  if (path === 'clinical/progress') return await asyncMap(await db.prepare('SELECT e.*,p.name patient FROM episodes e JOIN patients p ON p.id=e.patient_id ORDER BY e.id DESC').all(), async e => {
    const notes = (await db.prepare("SELECT d.structured FROM clinical_details d JOIN clinical c ON c.id=d.clinical_id WHERE d.episode_id=? AND c.approved=1 AND c.kind IN ('Assessment','Reassessment') ORDER BY c.id").all(e.id)).map(n => JSON.parse(n.structured || '{}'));
    const baseline = notes[0],
      latest = notes.at(-1);
    return {
      ...e,
      baseline: baseline?.pain ?? '',
      latest: latest?.pain ?? '',
      change: baseline?.pain !== undefined && latest?.pain !== undefined ? Number(latest.pain) - Number(baseline.pain) : '',
      measurements: JSON.stringify((latest?.measurements || []).map(m => {
        const first = (baseline?.measurements || []).find(b => b.name === m.name && b.unit === m.unit);
        return {
          ...m,
          baseline: first?.value ?? null,
          change: first ? Number(m.value) - Number(first.value) : null
        };
      }))
    };
  });
  if (path === 'finance/session-costs') return await asyncMap(await db.prepare('SELECT cc.*,c.patient_id,c.provider,c.episode,p.name patient FROM clinical_costs cc JOIN clinical c ON c.id=cc.clinical_id JOIN patients p ON p.id=c.patient_id ORDER BY cc.clinical_id DESC').all(), async r => {
    const income = await sessionIncome(db, r.clinical_id);
    return {
      ...r,
      ...income,
      profit: income.revenue === null ? null : Math.round((income.revenue - r.total) * 1000) / 1000,
      id: r.clinical_id,
      completeness: r.complete ? 'مكتملة حسب البيانات المسجلة' : 'ينقص زمن أو سعر وقت الممارس'
    };
  });
  if (path === 'finance/payments') return await db.prepare('SELECT t.*,p.name patient FROM payments t JOIN invoices i ON i.id=t.invoice_id JOIN patients p ON p.id=i.patient_id ORDER BY t.id DESC').all();
  if (path === 'finance/packages') return await asyncMap(await db.prepare('SELECT p.*,s.invoice_id,t.name patient,COUNT(u.id) used,p.total-COUNT(u.id) balance FROM packages p JOIN patients t ON t.id=p.patient_id LEFT JOIN package_usage u ON u.package_id=p.id LEFT JOIN package_sales s ON s.package_id=p.id GROUP BY p.id,s.invoice_id,t.name ORDER BY p.id DESC').all(), async p => ({
    ...p,
    used: await usedPackageSessions(db, p.id),
    balance: p.total - (await usedPackageSessions(db, p.id))
  }));
  if (path === 'reports/integrations') return await db.prepare('SELECT id,kind,reference,status,time FROM integration_jobs ORDER BY id DESC').all();
  if (path === 'reports') {
    const rows = [];
    const add = async (module, metric, sql, basis) => {
      if (permissions.includes(module + '.view')) rows.push({
        id: rows.length + 1,
        category: operationPages[module]?.label || module,
        metric,
        value: actor && (await assignedScope(db, actor, module)) && module === 'patients' ? (await scopeRows(db, 'patients', await db.prepare('SELECT * FROM patients WHERE active=1').all(), actor)).length : actor && (await assignedScope(db, actor, module)) && module === 'appointments' ? (await db.prepare("SELECT COUNT(*) n FROM appointments WHERE provider=? AND status='Completed'").get(actor.id)).n : (await db.prepare(sql).get()).value,
        basis: actor && (await assignedScope(db, actor, module)) ? 'السجلات المرتبطة بحسابك' : basis
      });
    };
    await add('patients', 'المرضى النشطون', 'SELECT COUNT(*) value FROM patients WHERE active=1', 'الملفات النشطة');
    await add('appointments', 'المواعيد المكتملة', "SELECT COUNT(*) value FROM appointments WHERE status='Completed'", 'كل المواعيد المسجلة');
    await add('finance', 'الفواتير', 'SELECT COALESCE(SUM(amount),0) value FROM invoices', 'إجمالي قيمة الفواتير');
    await add('finance', 'المحصّل', 'SELECT COALESCE(SUM(paid),0) value FROM invoices', 'المبالغ المسجلة على الفواتير');
    await add('finance', 'المتبقي', 'SELECT COALESCE(SUM(amount-paid),0) value FROM invoices', 'الفواتير ناقص المحصل');
    await add('inventory', 'أصناف منخفضة الرصيد', 'SELECT COUNT(*) value FROM inventory WHERE quantity<=minimum', 'الرصيد عند أو أقل من الحد الأدنى');
    await add('quality', 'متوسط الرضا', 'SELECT ROUND(AVG(score),2) value FROM satisfaction', 'الاستبيانات المسجلة من 5');
    await add('quality', 'شكاوى مفتوحة', "SELECT COUNT(*) value FROM complaints WHERE status<>'Closed'", 'كل الشكاوى غير المغلقة');
    await add('marketing', 'تحويل الاستفسارات', "SELECT COUNT(*) value FROM leads WHERE status='Converted'", 'حالة التحويل المسجلة يدويًا');
    return rows;
  }
  if (path === 'finance/costing') return (await db.prepare('SELECT * FROM costing ORDER BY id DESC').all()).map(r => {
    const total_cost = r.staff + r.consumables + r.device + r.overhead;
    return {
      ...r,
      total_cost,
      margin: r.price - total_cost,
      margin_percent: r.price ? Math.round((r.price - total_cost) / r.price * 10000) / 100 : 0,
      cost_status: r.price < total_cost ? 'أقل من التكلفة' : 'يغطي التكلفة'
    };
  });
  if (path === 'marketing/campaigns') return await asyncMap(await db.prepare("SELECT c.*,COUNT(l.id) lead_count,SUM(CASE WHEN l.status='Converted' THEN 1 ELSE 0 END) converted FROM campaigns c LEFT JOIN leads l ON l.campaign_id=c.id GROUP BY c.id ORDER BY c.id DESC").all(), async c => {
    const revenue = (await db.prepare("SELECT COALESCE(SUM(CASE WHEN p.kind='Payment' THEN p.amount ELSE -p.amount END),0) n FROM patient_campaigns pc JOIN invoices i ON i.patient_id=pc.patient_id JOIN payments p ON p.invoice_id=i.id WHERE pc.campaign_id=? AND p.time>=pc.assigned").get(c.id)).n;
    return {
      ...c,
      revenue,
      roi: c.budget ? (revenue - c.budget) / c.budget * 100 : null
    };
  });
  if (path === 'marketing') return await db.prepare('SELECT l.*,c.name campaign FROM leads l JOIN campaigns c ON c.id=l.campaign_id ORDER BY l.id DESC').all();
  if (path === 'equipment') return await db.prepare('SELECT *,capacity-used remaining FROM equipment ORDER BY id DESC').all();
  if (path === 'equipment/maintenance') return await db.prepare('SELECT m.*,e.name device FROM maintenance m JOIN equipment e ON e.id=m.equipment_id ORDER BY m.id DESC').all();
  if (path === 'inventory') return (await db.prepare('SELECT * FROM inventory ORDER BY id DESC').all()).map(r => ({
    ...r,
    stock_status: r.quantity <= r.minimum ? 'Low Stock' : 'Available'
  }));
  if (path === 'inventory/movements') return await db.prepare("SELECT m.*,i.name item,(SELECT GROUP_CONCAT(b.number || ' × ' || a.quantity, '، ') FROM stock_allocations a JOIN stock_batches b ON b.id=a.batch_id WHERE a.movement_id=m.id) batches FROM stock_movements m JOIN inventory i ON i.id=m.item_id ORDER BY m.id DESC").all();
  if (path === 'compliance') {
    const today = omanDate();
    return (await db.prepare('SELECT * FROM licenses ORDER BY expiry').all()).map(r => ({
      ...r,
      status: r.status === 'Under Renewal' ? r.status : r.expiry < today ? 'Expired' : Date.parse(r.expiry) - Date.parse(today) <= 30 * 86400000 ? 'Due Soon' : 'Valid'
    }));
  }
  const config = operationPages[path];
  return await db.prepare(`SELECT * FROM ${config.table} ORDER BY id DESC`).all();
}
export async function saveOperation(db, path, body, actor) {
  const config = operationPages[path];
  if (path === 'purchasing/vendors') return await validateVendor(db, body);
  if (path === 'equipment' && body.action !== 'consume') await validateAsset(db, body);
  if (path === 'clinical/templates') body.defaults = JSON.stringify(templateDefaults(body.defaults));
  if (path === 'finance/session-billing') return await linkSessionBilling(db, body, actor);
  if (config.readonly) throw Error('التقارير للقراءة فقط');
  if (path === 'appointments/waiting' && body.action === 'book') return await bookWaiting(db, body, actor);
  if (path === 'finance/packages' && body.action === 'sell') return await sellPackage(db, body, actor);
  if (path === 'equipment/components') return await replaceComponent(db, body, actor);
  if (path === 'compliance' && body.action === 'renew') return await renewLicense(db, body, actor);
  if (path === 'finance/policy') body.id = 1;
  if (path === 'finance/cashbox') return await closeCashDay(db, body, actor);
  if (path === 'finance/expenses') {
    if (body.id && (await db.prepare("SELECT id FROM financial_corrections WHERE kind='Expense' AND status='Approved' AND (source_id=? OR compensation_id=?)").get(body.id, body.id))) throw Error('قيد مرتبط بتصحيح معتمد لا يقبل التعديل');
    if (body.id && (await db.prepare('SELECT supplier_payment_id FROM expenses WHERE id=?').get(body.id))?.supplier_payment_id) throw Error('مصروف مرتبط بسداد مورد لا يقبل التعديل');
    if (body.method === 'Cash') await ensureCashDayOpen(db, body.date);
    if (body.id) {
      const old = await db.prepare('SELECT * FROM expenses WHERE id=?').get(body.id);
      if (old?.method === 'Cash') await ensureCashDayOpen(db, old.date);
    }
  }
  if (path === 'inventory/movements') return await stockMovement(db, body, actor);
  if (path === 'equipment' && body.action === 'consume') return await consumeEquipment(db, body, actor);
  if (path === 'equipment/maintenance' && body.id && body.action === 'complete') {
    return await completeAssetMaintenance(db, body);
  }
  if (path === 'compliance/obligations' && body.action === 'paid') {
    requireValue(body.due, 'تاريخ الاستحقاق المعروض مطلوب لتجنب تكرار السداد');
    return await payObligation(db, body.id, actor, body.due);
  }
  if (path === 'compliance') {
    requireValue(body.expiry, 'تاريخ انتهاء الترخيص مطلوب');
    if (body.id) {
      const old = await db.prepare('SELECT * FROM licenses WHERE id=?').get(body.id);
      if (old && (old.expiry !== body.expiry || old.reference !== body.reference || old.issued !== body.issued)) return await renewLicense(db, body, actor);
    }
  }
  for (const [key, label, type, options] of config.fields) {
    if (!['warranty', 'component', 'expiry', 'reference', 'model', 'serial', 'location', 'supplier', 'cost_center', 'resolution', 'parts', 'patient_id', 'evidence', 'purchase_date', 'purchase_cost', 'vendor_id', 'maintenance_interval_days', 'last_maintenance', 'next_maintenance'].includes(key)) requireValue(body[key], label + ' مطلوب');
    if (type === 'select' && !options.includes(body[key])) throw Error(label + ' غير صحيح');
    if (type === 'number' && !(path === 'equipment' && ['purchase_cost','maintenance_interval_days'].includes(key) && body[key] == null)) body[key] = positive(body[key] || 0, label + ' غير صحيح', true);
    if (type === 'date' && body[key] && !/^\d{4}-\d{2}-\d{2}$/.test(body[key])) throw Error(label + ' غير صحيح');
  }
  if (path === 'appointments/waiting' && !(await db.prepare('SELECT id FROM patients WHERE id=?').get(body.patient_id))) throw Error('المريض غير موجود');
  if (path === 'finance/packages') {
    if (!Number.isInteger(body.total) || body.total < 1) throw Error('عدد الجلسات يجب أن يكون عددًا صحيحًا موجبًا');
    if (!(await db.prepare('SELECT id FROM patients WHERE id=?').get(body.patient_id))) throw Error('المريض غير موجود');
    if (body.id) {
      const used = await usedPackageSessions(db, body.id);
      if (body.total < used) throw Error('عدد الجلسات أقل من المستخدم');
      const old = await db.prepare('SELECT * FROM packages WHERE id=?').get(body.id);
      const linked = await db.prepare('SELECT appointment_id FROM appointment_packages WHERE package_id=? LIMIT 1').get(body.id);
      if (linked && (Number(body.patient_id) !== old.patient_id || body.service !== old.service)) throw Error('لا يمكن تغيير المريض أو الخدمة بعد ربط المواعيد');
    }
  }
  if (path === 'quality/preventive' && body.status === 'Completed') requireValue(body.evidence, 'دليل الإتمام مطلوب');
  if (path === 'quality' && body.status === 'Closed') requireValue(body.resolution, 'دليل الإغلاق مطلوب');
  if (path === 'quality/satisfaction' && (!Number.isInteger(body.score) || body.score < 1 || body.score > 5)) throw Error('التقييم عدد صحيح من 1 إلى 5');
  if (path === 'finance/rates' && !(await db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('doctor','physio','physio_lead')").get(body.provider))) throw Error('اختر حساب ممارس نشط');
  if (path === 'marketing' && body.patient_id) {
    if (!(await db.prepare('SELECT id FROM patients WHERE id=?').get(body.patient_id))) throw Error('المريض غير موجود');
    const attributed = await db.prepare('SELECT campaign_id FROM patient_campaigns WHERE patient_id=?').get(body.patient_id);
    if (attributed && attributed.campaign_id !== Number(body.campaign_id)) throw Error('المريض منسوب لحملة أخرى؛ راجع النسبة قبل تغييرها');
  }
  if (path === 'marketing' && !(await db.prepare('SELECT id FROM campaigns WHERE id=?').get(body.campaign_id))) throw Error('الحملة غير موجودة');
  if (path === 'marketing/campaigns' && body.end < body.start) throw Error('نهاية الحملة قبل البداية');
  if (path === 'equipment' && body.id) {
    const current = await db.prepare('SELECT * FROM equipment WHERE id=?').get(body.id);
    if (current && (body.component !== current.component || Number(body.capacity) !== current.capacity || Number(body.replacement_cost) !== current.replacement_cost)) throw Error('استخدم استبدال القطعة لتغيير الرأس والسعة والتكلفة مع حفظ التاريخ');
  }
  if (path === 'equipment' && (!Number.isInteger(body.capacity) || body.capacity < 0)) throw Error('سعة العداد عدد صحيح');
  if (path === 'equipment' && body.id) {
    const old = await db.prepare('SELECT used FROM equipment WHERE id=?').get(body.id);
    if (old && body.capacity < old.used) throw Error('السعة لا تقل عن الاستخدام السابق؛ الاستبدال يحتاج قطعة جديدة');
  }
  if (path === 'equipment/maintenance' && !(await db.prepare('SELECT id FROM equipment WHERE id=?').get(body.equipment_id))) throw Error('الجهاز غير موجود');
  const fields = config.fields.map(f => f[0]);
  const vals = config.fields.map(([key,,type]) => path === 'equipment' && ['purchase_cost','maintenance_interval_days','vendor_id'].includes(key) && (body[key] == null || body[key] === '') ? null : path === 'marketing' && key === 'patient_id' && !body[key] ? null : type==='number'?Number(body[key]??0):body[key]??'');
  let before = null,
    id = body.id;
  if (id) {
    before = await db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).get(id);
    if (!before) throw Error('السجل غير موجود');
    await db.prepare(`UPDATE ${config.table} SET ${fields.map(k => k + '=?').join(',')} WHERE id=?`).run(...vals, id);
  } else {
    id = Number((await db.prepare(`INSERT INTO ${config.table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...vals)).lastInsertRowid);
  }
  if (path === 'marketing' && body.patient_id) await db.prepare('INSERT OR IGNORE INTO patient_campaigns(patient_id,campaign_id) VALUES(?,?)').run(body.patient_id, body.campaign_id);
  if (path === 'equipment/maintenance' && !body.id) await db.prepare('UPDATE maintenance SET opened=CURRENT_TIMESTAMP WHERE id=?').run(id);
  return {
    before,
    after: await db.prepare(`SELECT * FROM ${config.table} WHERE id=?`).get(id)
  };
}
