export function checkProductionEnvironment(env=process.env) {
 if (env.NODE_ENV !== 'production') return;
 const errors=[];
 const required=(key,n=1)=>{if((env[key]||'').trim().length<n)errors.push(key+' is required (minimum '+n+' characters)')};
 required('DATABASE_URL'); required('CLINIC_SETUP_TOKEN',32);
 const url=env['DATABASE_URL'];try{if(!['postgres:','postgresql:'].includes(new URL(url).protocol))throw Error()}catch{errors.push('A PostgreSQL connection URL is required')}
 required('CLINIC_AUTOMATION_SECRET',32); required('CLINIC_BASE_URL'); if(env.CLINIC_DEMO_ONLY==='1')errors.push('CLINIC_DEMO_ONLY is forbidden for real production'); try{if(new URL(env.CLINIC_BASE_URL).protocol!=='https:')throw Error()}catch{errors.push('CLINIC_BASE_URL must use HTTPS')}
 for(const key of ['DEMO_MODE','WORKFORCE_DEMO_MODE','CLINIC_DEMO'])if(env[key]&&!['on','off','true','false','1','0'].includes(env[key].trim().toLowerCase()))errors.push(key+' has an unknown value');
 if(errors.length)throw Error('Production configuration invalid:\n- '+errors.join('\n- '));
}
if(process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href){try{checkProductionEnvironment()}catch(e){console.error(e.message);process.exitCode=1}}
