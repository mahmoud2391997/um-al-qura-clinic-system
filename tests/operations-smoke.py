import urllib.request,urllib.error,json,http.cookiejar
base='http://127.0.0.1:3000';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def req(path,data=None,expected=200):
 r=urllib.request.Request(base+'/api/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Origin':base})
 try:
  with client.open(r) as v: status=v.status;result=json.load(v)
 except urllib.error.HTTPError as e: status=e.code;result=json.load(e)
 assert status==expected,(path,status,result)
 return result
req('demo',{'role':'owner'})
for path in ['equipment','equipment/maintenance','inventory','inventory/movements','finance/expenses','compliance','compliance/obligations']:assert len(req(path))>0,path
req('equipment',{'id':2,'action':'consume','quantity':1,'reference':'test'},400)
req('inventory/movements',{'item_id':1,'kind':'Issue','quantity':99999,'reason':'test'},400)
before=req('equipment');device=next(x for x in before if x['id']==1)
req('equipment',{'id':1,'action':'consume','quantity':1,'reference':'SMOKE-TEST'})
assert next(x for x in req('equipment') if x['id']==1)['used']==device['used']+1
req('demo',{'role':'assistant'})
for path in ['equipment','inventory','finance/expenses','compliance']:req(path,expected=403)
print('PASS: seven operation modules, blocked out-of-service usage, blocked stock overdraft, counter update, assistant denied operation access')
