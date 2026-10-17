// Presentation only: the caller's existing permission checks remain authoritative.
const daily={
 reception:['patients','appointments','finance','appointments/waiting','tasks'],
 assistant:['patients','appointments','appointments/waiting','tasks'],
 doctor:['appointments','clinical','patients','clinical/home-followup','tasks'],
 physio:['appointments','clinical','clinical/home-followup','patients','tasks'],
 physio_lead:['appointments','clinical','clinical/home-followup','patients','tasks'],
 finance:['finance','finance/payments','reports','patients','tasks'],
 owner:['patients','appointments','clinical','finance','tasks','reports'],
 manager:['patients','appointments','tasks','equipment','reports'],
 store:['inventory','purchasing/requests','purchasing/orders','tasks'],
 maintenance:['equipment','equipment/maintenance','tasks'],
 marketing:['marketing','marketing/campaigns','tasks'],
 quality:['quality','quality/preventive','reports','tasks'],
 technical:['users'],
};
export function roleNavigation(role,groups,can,labels){
 const pages=[...new Set(groups.flatMap(g=>g.page?[g.page]:g.children||[]))].filter(p=>can(p,'view'));
 const first=['dashboard',...(daily[role]||[])].filter((p,i,a)=>pages.includes(p)&&a.indexOf(p)===i);
 const more=pages.filter(p=>!first.includes(p));
 return [...first.map(page=>({id:page,page,label:labels[page]||page})),...(more.length?[{id:'more-group',label:'المزيد / الإعدادات',children:more}]:[])];
}
