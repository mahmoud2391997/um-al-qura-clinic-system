import urllib.request,urllib.error,json,http.cookiejar,secrets
base='http://127.0.0.1:3000';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def req(path,data=None,expected=200):
 r=urllib.request.Request(base+'/api/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Origin':base})
 try:
  with client.open(r) as v: status=v.status;result=json.load(v)
 except urllib.error.HTTPError as e: status=e.code;result=json.load(e)
 assert status==expected,(path,status,result)
 return result
password=secrets.token_urlsafe(24)
req('patients',expected=401)
req('setup',{'name':'Test Owner','email':'owner@test.invalid','password':password})
req('login',{'email':'owner@test.invalid','password':password})
req('patients',{'name':'Test Patient','phone':'000000','birth':'2000-01-01','gender':'male'})
req('patients',{'name':'Other Patient','phone':'000000'},409)
p=req('patients')[0]['id']
req('appointments',{'patient_id':p,'provider':'Test Provider','start':'2026-10-11T10:00','end':'2026-10-11T10:30','service':'Test'})
req('appointments',{'patient_id':p,'provider':'Test Provider','start':'2026-10-11T10:15','end':'2026-10-11T10:45'},409)
a=req('appointments')[0]['id'];req('appointments',{'id':a,'status':'Arrived'});assert req('appointments')[0]['arrived']
req('users',{'name':'Assistant','email':'assistant@test.invalid','password':password,'role':'assistant'})
req('users',{'name':'Physio','email':'physio@test.invalid','password':password,'role':'physio'})
req('finance',{'patient_id':p,'service':'Test','amount':100});i=req('finance')[0]['id'];req('finance',{'id':i,'payment':40});req('finance',{'id':i,'payment':70},400)
req('logout',{});req('login',{'email':'assistant@test.invalid','password':password});req('clinical',{'patient_id':p,'episode':'Test','content':'Test'},403);req('roles',expected=403)
req('logout',{});req('login',{'email':'physio@test.invalid','password':password});req('clinical',{'patient_id':p,'episode':'Test','content':'Assessment'});c=req('clinical')[0]['id'];req('clinical',{'id':c,'action':'approve'});req('clinical',{'id':c,'content':'Overwrite'},409);req('clinical',{'patient_id':p,'episode':'Test','content':'Correction','kind':'Addendum','parent_id':c})
print('PASS: login, roles, duplicate warning, appointment conflict, arrival, partial payment, assistant denial, clinical lock and addendum')
