import { extraPaths, listExtras, saveExtras } from '../purchasing-extras.js';
import { listPurchasing, savePurchasing } from '../purchasing.js';
export async function handlePurchasing(context, phase) {
  const { path, method, body, db, user, permissions, auditedResponse } =
    context;
  if (phase === 'session') {
    if (extraPaths.includes(path)) {
      const actor = {
        ...user,
        permissions,
      };
      try {
        if (method === 'GET')
          return auditedResponse(await listExtras(db, path, actor));
        if (path === 'purchasing/invoice-orders')
          return auditedResponse(
            {
              error: 'للقراءة فقط',
            },
            403,
          );
        const result = await saveExtras(db, path, body, actor);
        return auditedResponse(
          result.file
            ? result
            : {
                ok: true,
              },
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
    if (path.startsWith('purchasing/') && path !== 'purchasing/vendors') {
      if (
        ![
          'purchasing/requests',
          'purchasing/orders',
          'purchasing/receipts',
          'purchasing/catalog',
        ].includes(path)
      )
        return auditedResponse(
          {
            error: 'المسار غير موجود',
          },
          404,
        );
      const actor = {
        ...user,
        permissions,
      };
      try {
        if (method === 'GET')
          return auditedResponse(await listPurchasing(db, path, actor));
        if (['purchasing/catalog', 'purchasing/receipts'].includes(path))
          return auditedResponse(
            {
              error: 'السجل للقراءة فقط',
            },
            403,
          );
        await savePurchasing(db, path, body, actor);
        return auditedResponse({
          ok: true,
        });
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
}
