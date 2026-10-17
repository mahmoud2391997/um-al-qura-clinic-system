export function appointmentEnd(start,minutes){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start||'')||!Number.isInteger(Number(minutes))||Number(minutes)<1||Number(minutes)>1440)throw Error('راجع بداية الموعد ومدته المعتمدة');
 const time=new Date(start+'Z');if(!Number.isFinite(+time)||time.toISOString().slice(0,16)!==start)throw Error('بداية الموعد غير صحيحة');
 return new Date(+time+Number(minutes)*60000).toISOString().slice(0,16);
}
export function nextVisibleSlot(start,minutes,provider,rows){
 let candidate=start;
 for(const row of [...rows].filter(r=>r.provider===provider&&!['Cancelled','No show'].includes(r.status)).sort((a,b)=>a.start.localeCompare(b.start))){
  if(row.start<appointmentEnd(candidate,minutes)&&row.end>candidate)candidate=row.end;
 }
 return candidate;
}
