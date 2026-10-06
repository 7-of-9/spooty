#!/usr/bin/env python3
"""Publish verified DJ package files; credentials arrive only through hidden stdin."""
import os,sys,json,time,hashlib,mimetypes,urllib.request,urllib.parse,urllib.error,concurrent.futures,termios
from pathlib import Path
state_dir=Path(__file__).resolve().parents[2] / 'data' / 'dj-share-upload-state';state_dir.mkdir(exist_ok=True)
old=termios.tcgetattr(sys.stdin) if sys.stdin.isatty() else None
if old:
 new=old.copy();new[3]&=~termios.ECHO;termios.tcsetattr(sys.stdin,termios.TCSANOW,new)
print('Ready for upload JSON on stdin (input is hidden).',flush=True)
try:config=json.loads(sys.stdin.readline())
finally:
 if old:termios.tcsetattr(sys.stdin,termios.TCSANOW,old)
origin=config['origin'].rstrip('/');token=config['token'];tasks=config.get('tasks') or json.loads(Path(config['tasksFile']).read_text());chunk_size=16*1024*1024

def call(route,method='GET',data=None,headers=None,retry=True):
 h={'User-Agent':'Mozilla/5.0 FiftyDJUploader',**(headers or {})}
 if route.startswith('/admin/'):h['Authorization']='Bearer '+token
 if isinstance(data,dict):data=json.dumps(data).encode();h['Content-Type']='application/json'
 for attempt in range(4 if retry else 1):
  try:
   req=urllib.request.Request(origin+route,data=data,headers=h,method=method)
   with urllib.request.urlopen(req,timeout=150) as r:
    body=r.read();return r.status,dict(r.headers),json.loads(body) if body and r.headers.get('Content-Type','').startswith('application/json') else body
  except urllib.error.HTTPError as e:
   if e.code not in [408,429,500,502,503,504] or attempt==3 or not retry:raise RuntimeError('HTTP '+str(e.code)+' on '+method+' '+route.split('?')[0]) from None
   time.sleep(min(20,2**attempt))
  except (OSError,TimeoutError) as e:
   if attempt==3 or not retry:raise RuntimeError(type(e).__name__+' on '+method+' '+route.split('?')[0]) from None
   time.sleep(2**attempt)

def task(t):
 p=Path(t['path']);key=t['key'];size=p.stat().st_size
 sha=t.get('sha256')
 if not sha:
  h=hashlib.sha256()
  with p.open('rb') as f:
   for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
  sha=h.hexdigest()
 route='/media/'+urllib.parse.quote(key,safe='')
 try:
  _,h,_=call(route,'HEAD');h={k.lower():v for k,v in h.items()}
  if h.get('x-file-sha256')==sha and int(h.get('content-length',0))==size:
   print(json.dumps({'status':'cached','key':key,'bytes':size}),flush=True);return
 except RuntimeError as e:
  if not str(e).startswith('HTTP 404'):raise
 ct=t.get('contentType') or mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
 state_path=state_dir/(hashlib.sha256(key.encode()).hexdigest()+'.json')
 if size<=chunk_size:
  call('/admin/object?'+urllib.parse.urlencode({'key':key}),'PUT',p.read_bytes(),{'Content-Type':ct,'X-File-SHA256':sha,'X-File-Name':urllib.parse.quote(p.name)})
 else:
  state=json.loads(state_path.read_text()) if state_path.exists() else None
  if not state or state.get('sha256')!=sha or state.get('bytes')!=size:
   _,_,u=call('/admin/uploads/create','POST',{'key':key,'contentType':ct,'sha256':sha,'filename':p.name,'bytes':size},retry=False)
   state={**u,'sha256':sha,'bytes':size,'parts':[]};state_path.write_text(json.dumps(state))
  upload_id=state['uploadId'];parts=state['parts']
  with p.open('rb') as f:
   for i in range((size+chunk_size-1)//chunk_size):
    f.seek(i*chunk_size);part=f.read(chunk_size)
    if i<len(parts):continue
    query=urllib.parse.urlencode({'key':key,'uploadId':upload_id,'partNumber':i+1})
    _,_,result=call('/admin/uploads/part?'+query,'PUT',part,{'Content-Type':'application/octet-stream'})
    parts.append(result);state['parts']=parts;temp=state_path.with_suffix('.tmp');temp.write_text(json.dumps(state));temp.replace(state_path)
    if (i+1)%8==0:print(json.dumps({'status':'uploading','key':key,'parts':i+1,'totalParts':(size+chunk_size-1)//chunk_size}),flush=True)
  _,_,result=call('/admin/uploads/complete','POST',{'key':key,'uploadId':upload_id,'parts':parts},retry=False)
  assert result['size']==size
 _,h,_=call(route,'HEAD');h={k.lower():v for k,v in h.items()}
 assert int(h['content-length'])==size and h.get('x-file-sha256')==sha,(key,'remote verification mismatch')
 print(json.dumps({'status':'uploaded','key':key,'bytes':size}),flush=True)

with concurrent.futures.ThreadPoolExecutor(max_workers=config.get('concurrency',3)) as pool:
 list(pool.map(task,tasks))
print(json.dumps({'status':'complete','files':len(tasks),'bytes':sum(Path(t['path']).stat().st_size for t in tasks)}),flush=True)
