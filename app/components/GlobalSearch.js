'use client';
import {useEffect,useRef,useState} from 'react';
import {useLanguage} from './LanguageProvider';
export default function GlobalSearch({api,permissions,onSelect}){
 const {t}=useLanguage(),[query,setQuery]=useState(''),[results,setResults]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),input=useRef(null);
 useEffect(()=>{const key=e=>{if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.closest('input,textarea,select,[contenteditable=true]')){e.preventDefault();input.current?.focus()}if(e.key==='Escape'){setQuery('');input.current?.blur()}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)},[]);
 useEffect(()=>{let active=true;if(query.trim().length<2){setResults([]);setError('');setLoading(false);return}setResults([]);setLoading(true);setError('');const timer=setTimeout(async()=>{
  const matches=[];let unavailable=false;
  const paths=['patients','appointments','finance'].filter(p=>permissions.includes(p+'.view'));
  const responses=await Promise.allSettled(paths.map(path=>api(path)));
  for(const [index,response] of responses.entries()){if(response.status==='rejected'){unavailable=true;continue}const path=paths[index],needle=query.trim().toLocaleLowerCase();for(const row of response.value){const fields=path==='patients'?[row.name,row.phone,row.id]:[row.patient,row.service,row.id];if(fields.some(x=>String(x||'').toLocaleLowerCase().includes(needle)))matches.push({path,id:row.id,title:path==='patients'?row.name:row.patient,detail:path==='patients'?row.phone:row.service})}}

  if(active){setResults(matches.slice(0,20));setError(unavailable?'تعذر البحث في بعض الأقسام؛ أعد المحاولة.':'');setLoading(false)}
 },250);return()=>{active=false;clearTimeout(timer)}},[query,api,permissions]);
 return <div className="globalsearch"><label className="sr-only" htmlFor="clinic-global-search">{t('بحث في المرضى والمواعيد والفواتير')}</label><input id="clinic-global-search" ref={input} type="search" role="combobox" aria-autocomplete="list" aria-haspopup="dialog" placeholder={t('ابحث عن مريض أو موعد أو فاتورة…')} value={query} onChange={e=>setQuery(e.target.value)} aria-controls="global-search-results" aria-expanded={query.trim().length>=2}/>{query.trim().length>=2&&<section className="searchresults card" id="global-search-results" aria-live="polite">{loading&&<p>{t('جاري البحث…')}</p>}{error&&<p role="alert">{t(error)}</p>}{!loading&&!results.length&&!error&&<p>{t('لا توجد نتائج ضمن صلاحيات حسابك.')}</p>}{results.map(r=><button type="button" className="secondary" key={r.path+r.id} onClick={()=>{onSelect(r);setQuery('')}}><b>{r.title}</b><span>{t({patients:'المرضى',appointments:'المواعيد',finance:'الفواتير'}[r.path])} · {r.id} · {r.detail}</span></button>)}</section>}</div>;
}
