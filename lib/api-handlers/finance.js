import { captureInvoiceFacts } from '../financial-report.js';
import { priceForRecord, snapshotPrice } from '../readiness-workflows.js';
import { correctFinancialRecord } from '../financial-corrections.js';
import { returnPackageSession } from '../package-returns.js';
import { financeRequest, correctCashClosure } from '../finance-workflow.js';
import {
  recordPayment,
  discountInvoice,
  enforceFinanceLimit,
} from '../finance.js';
import { transaction } from '../operations.js';
import { allowed } from '../permissions.js';
export async function handleFinance(context, phase) {
  const {
    path,
    method,
    body,
    db,
    audit,
    user,
    permissions,
    auditedResponse,
    privateResponse,
    mod,
    action,
  } = context;
  if (phase === 'session') {
    if (path === 'finance/staff') {
      if (method !== 'GET' || !allowed(user, permissions, 'finance', 'view'))
        return auditedResponse(
          {
            error: 'صلاحية المالية مطلوبة',
          },
          403,
        );
      return auditedResponse(
        await db
          .prepare(
            "SELECT id,name FROM users WHERE active=1 AND role IN ('doctor','physio','physio_lead')",
          )
          .all(),
      );
    }
  }
  if (phase === 'domain') {
    if (path === 'finance/policy' && user.role !== 'owner')
      return auditedResponse(
        {
          error: 'ضبط الحدود المالية مخصص لمالك المجمع',
        },
        403,
      );
    if (mod === 'finance' && method === 'POST') {
      try {
        await enforceFinanceLimit(db, body, user.role === 'owner');
      } catch (e) {
        return auditedResponse(
          {
            error: e.message,
          },
          403,
        );
      }
    }
    if (
      path === 'finance/cashbox' &&
      method === 'POST' &&
      !allowed(user, permissions, 'finance', 'approve')
    )
      return auditedResponse(
        {
          error: 'إقفال الصندوق يحتاج صلاحية اعتماد المالية',
        },
        403,
      );
    if (path === 'finance/corrections') {
      try {
        if (method === 'POST')
          return auditedResponse(
            await correctFinancialRecord(db, body, {
              ...user,
              permissions,
            }),
          );
        return auditedResponse(
          await db
            .prepare(
              'SELECT id,kind,source_id,reason,creator,status,reviewer,decision,compensation_id,time FROM financial_corrections WHERE ? OR creator=? ORDER BY id DESC',
            )
            .all(
              Number(
                user.role === 'owner' ||
                  permissions.includes('finance.approve'),
              ),
              user.id,
            ),
        );
      } catch (e) {
        return auditedResponse(
          {
            error: e.message,
          },
          400,
        );
      }
    }
    if (path === 'finance/package-returns') {
      try {
        if (method === 'POST')
          return auditedResponse(
            await returnPackageSession(db, body, {
              ...user,
              permissions,
            }),
          );
        return auditedResponse(
          await db
            .prepare(
              'SELECT * FROM package_returns WHERE ? OR creator=? ORDER BY id DESC',
            )
            .all(
              Number(
                user.role === 'owner' ||
                  permissions.includes('finance.approve'),
              ),
              user.id,
            ),
        );
      } catch (e) {
        return auditedResponse(
          {
            error: e.message,
          },
          400,
        );
      }
    }
    if (path === 'finance/approvals') {
      try {
        if (method === 'POST')
          return auditedResponse(
            await financeRequest(db, body, {
              ...user,
              permissions,
            }),
          );
        return auditedResponse(
          await db
            .prepare(
              'SELECT * FROM finance_requests WHERE ? OR creator=? ORDER BY id DESC',
            )
            .all(
              Number(
                user.role === 'owner' ||
                  permissions.includes('finance.approve'),
              ),
              user.id,
            ),
        );
      } catch (e) {
        return auditedResponse(
          {
            error: e.message,
          },
          400,
        );
      }
    }
    if (path === 'finance/cash-corrections' && method === 'POST') {
      try {
        return auditedResponse(
          await correctCashClosure(db, body, {
            ...user,
            permissions,
          }),
        );
      } catch (e) {
        return auditedResponse(
          {
            error: e.message,
          },
          400,
        );
      }
    }
  }
  if (phase === 'records') {
    if (mod === 'finance') {
      if (method === 'GET')
        return privateResponse(
          await db
            .prepare(
              'SELECT i.*,p.name patient FROM invoices i JOIN patients p ON p.id=i.patient_id ORDER BY i.id DESC',
            )
            .all(),
        );
      if (body.id) {
        const result =
          body.action === 'discount'
            ? await discountInvoice(db, body, user.id)
            : await recordPayment(db, body, user.id);
        await audit(
          user.id,
          'finance.' + (body.action || 'payment'),
          String(body.id),
          result.before,
          result.after,
        );
        return auditedResponse({
          ok: true,
        });
      }
      const amount = Number(body.amount);
      if (
        !body.patient_id ||
        !body.service ||
        !Number.isFinite(amount) ||
        amount <= 0
      )
        return auditedResponse(
          {
            error: 'راجع بيانات الفاتورة',
          },
          400,
        );
      await transaction(db, async () => {
        const price = await priceForRecord(db, body.service, undefined, amount);
        const result = await db
          .prepare(
            'INSERT INTO invoices(patient_id,service,amount) VALUES(?,?,?)',
          )
          .run(body.patient_id, body.service, amount);
        await captureInvoiceFacts(db, Number(result.lastInsertRowid));
        if (price)
          await snapshotPrice(
            db,
            'invoice',
            Number(result.lastInsertRowid),
            price,
            amount,
          );
      });
      await audit(user.id, 'finance.invoice', 'new', null, body);
      return auditedResponse({
        ok: true,
      });
    }
  }
}
