export const readinessPages={
 'finance/service-prices':{label:'الخدمات والأسعار المؤرخة',fields:[['name','اسم الخدمة'],['department','القسم'],['effective_date','تاريخ السريان','date'],['amount','السعر','number'],['floor','الحد الأدنى المعتمد','number'],['duration_minutes','مدة الحجز المعتمدة بالدقائق (اختياري)','number']]},
 'finance/below-cost':{label:'طلبات تجاوز الحد الأدنى',fields:[['patient_id','رقم المريض','number'],['service','اسم الخدمة المعتمدة'],['amount','السعر المطلوب','number'],['reason','سبب التجاوز']]},
 'inventory/adjustment-policy':{label:'حدود اعتماد الجرد',fields:[['quantity_limit','حد فرق الكمية','number'],['value_limit','حد قيمة الفرق','number']]},
 'inventory/adjustment-requests':{label:'طلبات تسوية الجرد',fields:[['item_id','رقم الصنف','number'],['quantity','الرصيد الفعلي','number'],['reason','سبب التسوية']]},
 'equipment/parts-issue':{label:'صرف قطع غيار للصيانة',fields:[['ticket_id','رقم تذكرة الصيانة','number'],['item_id','رقم صنف المخزون','number'],['quantity','الكمية','number'],['reason','سبب الصرف']]},
 'marketing/visits':{label:'رحلة الاستفسار إلى الزيارة',fields:[['lead_id','رقم الاستفسار','number'],['appointment_id','رقم الموعد','number']]},
 'reports/filtered':{label:'مؤشرات الزيارات بالفترة والنطاق',readonly:true,fields:[['from','من تاريخ','date'],['to','إلى تاريخ','date'],['service','الخدمة'],['provider','معرف الممارس'],['department','القسم']]}
};
