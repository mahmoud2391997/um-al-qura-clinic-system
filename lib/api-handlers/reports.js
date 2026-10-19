import {dashboardSummary} from '../dashboard.js';
import {exportRows,toCsv} from '../exports.js';
import {toPdf,toXlsx} from '../report-files.js';
export async function handleReports(context,phase){
const {path,method,body,db,audit,user,permissions,auditedResponse,mod}=context;
if(phase==='session'){
if (path === 'reports/export' && method === 'POST') {
      try {
        const format = body.format || 'csv';
        if (!['csv', 'pdf', 'xlsx'].includes(format)) throw Error('صيغة التقرير غير متاحة');
        const actor = { ...user, permissions };
        if (format === 'csv') return auditedResponse({csv: toCsv(await exportRows(db, String(body.path), actor))});
        const file = await exportRows(db, String(body.path), actor, {format, render: format === 'pdf' ? toPdf : toXlsx});
        return new Response(file, {headers:{
          'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="clinic-report.${format}"`,
          'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff',
        }});
      } catch (e) {
        return auditedResponse({
          error: e.message
        }, 403);
      }
    }
if(path==='dashboard'){if(method!=='GET')return auditedResponse({error:'Read only'},405);return auditedResponse(await dashboardSummary(db,{...user,permissions}));}
}
if(phase==='domain'){
if (path === 'reports/integrations' && user.role !== 'owner') return auditedResponse({
      error: 'سجل التكاملات مخصص للمالك'
    }, 403);
}
if(phase==='records'){
if (mod === 'audit' && method === 'GET') return auditedResponse(await db.prepare('SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON a.actor=u.id ORDER BY a.id DESC LIMIT 100').all());
}
}
