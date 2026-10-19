import {saveServicePrice,listServicePrices,requestBelowCost,decideBelowCost,setAdjustmentPolicy,requestAdjustment,decideAdjustment,issueMaintenancePart,linkLeadVisit,funnelMetrics,filteredReport} from '../readiness-workflows.js';
import {asyncFilter} from '../async-collections.js';
import {patientVisible} from '../data-scopes.js';
export async function handleReadiness(context,phase){
const {req,path,method,body,db,permissions,auditedResponse,readinessActor,action}=context;
const readinessRoutes=['finance/service-prices','finance/below-cost','inventory/adjustment-policy','inventory/adjustment-requests','equipment/parts-issue','marketing/visits','reports/filtered'];
if(phase==='early'){
if(readinessRoutes.includes(path)){
      try{
        if(method==='GET'){
          if(path==='finance/service-prices')return auditedResponse(await listServicePrices(db,readinessActor));
          if(path==='reports/filtered')return auditedResponse(await filteredReport(db,Object.fromEntries(new URL(req.url).searchParams),readinessActor));
          if(path==='marketing/visits')return auditedResponse(await funnelMetrics(db,readinessActor));
          const permission=path.startsWith('finance/')?'finance.view':path.startsWith('inventory/')?'inventory.view':'equipment.view';
          if(!permissions.includes(permission))return auditedResponse({error:'غير مصرح'},403);
          if(path==='finance/below-cost')return auditedResponse(await asyncFilter(await db.prepare('SELECT id,patient_id,price_id,amount,reason,creator,status,reviewer,decision,invoice_id FROM below_cost_requests ORDER BY id').all(),row=>patientVisible(db,row.patient_id,readinessActor)));
          if(path==='inventory/adjustment-policy')return auditedResponse(await db.prepare('SELECT * FROM stock_adjustment_policy').all());
          if(path==='inventory/adjustment-requests')return auditedResponse(await db.prepare('SELECT * FROM stock_adjustment_requests ORDER BY id').all());
          return auditedResponse(await db.prepare('SELECT p.*,a.batch_id,a.quantity FROM maintenance_parts p JOIN stock_allocations a ON a.movement_id=p.movement_id ORDER BY p.id').all());
        }
        const result=path==='finance/service-prices'?await saveServicePrice(db,body,readinessActor):path==='finance/below-cost'?(body.action?await decideBelowCost(db,body,readinessActor):await requestBelowCost(db,body,readinessActor)):path==='inventory/adjustment-policy'?await setAdjustmentPolicy(db,body,readinessActor):path==='inventory/adjustment-requests'?(body.action?await decideAdjustment(db,body,readinessActor):await requestAdjustment(db,body,readinessActor)):path==='equipment/parts-issue'?await issueMaintenancePart(db,body,readinessActor):path==='marketing/visits'?await linkLeadVisit(db,body,readinessActor):null;
        if(result===null)return auditedResponse({error:'للقراءة فقط'},405);return auditedResponse(result);
      }catch(e){return auditedResponse({error:e.message},400)}
    }
}
}
