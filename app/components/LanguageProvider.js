'use client';
import {createContext,useContext,useEffect,useState,useCallback,useMemo} from 'react';
import {translateLabel} from '../../lib/ui-translations';
const LanguageContext=createContext({language:'ar',t:value=>value});
export function useLanguage(){return useContext(LanguageContext);}
export default function LanguageProvider({children}){
 const [language,setLanguage]=useState('ar'),[ready,setReady]=useState(false);
 useEffect(()=>{try{setLanguage(localStorage.getItem('clinic.language')==='en'?'en':'ar')}catch{}setReady(true)},[]);
 useEffect(()=>{document.documentElement.lang=language;document.documentElement.dir=language==='en'?'ltr':'rtl';if(ready)try{localStorage.setItem('clinic.language',language)}catch{}},[language,ready]);
 const t=useCallback(value=>translateLabel(value,language),[language]);
 const context=useMemo(()=>({language,t,setLanguage}),[language,t]);
 return <LanguageContext.Provider value={context}><div className="languagebar"><button type="button" className="secondary" aria-label={language==='ar'?'Switch to English':'التبديل إلى العربية'} onClick={()=>setLanguage(value=>value==='ar'?'en':'ar')}>{language==='ar'?'English':'العربية'}</button></div>{children}</LanguageContext.Provider>;
}

export function LanguageToggle(){const {language,setLanguage}=useLanguage();return <button type="button" className="secondary languagetoggle" aria-label={language==='ar'?'Switch to English':'التبديل إلى العربية'} onClick={()=>setLanguage(value=>value==='ar'?'en':'ar')}>{language==='ar'?'English':'العربية'}</button>}
