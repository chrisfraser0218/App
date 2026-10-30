"""Actual WKWebView acceptance client; only explicitly isolated private test profiles are permitted."""
import argparse,json,os,subprocess,time,urllib.request,uuid
from pathlib import Path
class NativeClient:
 def __init__(self,profile):
  self.profile=Path(profile).resolve()
  assert str(self.profile).startswith(('/tmp/finsight-desktop-test-','/private/tmp/finsight-desktop-test-'))
  assert self.profile.stat().st_mode&0o077==0
  self.base=Path(json.loads(self.profile.read_text())['dataHome']).resolve();self.automation=self.base/'automation'
  assert str(self.base).startswith(('/tmp/finsight-desktop-test-','/private/tmp/finsight-desktop-test-'))
 def state(self):
  files=sorted((self.base/'desktop').glob('session-*.json'),key=lambda p:p.stat().st_mtime,reverse=True)
  if not files:return {}
  return json.loads(files[0].read_text())
 def ready(self,timeout=90):
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   s=self.state()
   if s.get('status')=='error':raise RuntimeError(s['message'])
   if s.get('status')=='ready':
    assert s.get('test') is True
    req=urllib.request.Request('http://127.0.0.1:18480/api/desktop/health',headers={'X-FinSight-Session':s['token']})
    if json.load(urllib.request.urlopen(req))['instance']==s['instance']:
     try:
      page=self.command('snapshot',timeout=3)
      if page.get('title'):return s
     except RuntimeError:pass
   time.sleep(.25)
  raise RuntimeError('Native readiness timeout')
 def command(self,action,value='',timeout=40):
  assert self.state().get('test') is True or str(self.base).startswith('/private/tmp/finsight-desktop-test-'),'Never automate personal UI writes'
  identifier=uuid.uuid4().hex;tmp=self.automation/'command.tmp';tmp.write_text(json.dumps({'id':identifier,'action':action,'value':value,'instance':self.state()['instance']}));tmp.chmod(0o600);os.replace(tmp,self.automation/'command.json')
  until=time.monotonic()+timeout
  while time.monotonic()<until:
   try:
    response=json.loads((self.automation/'response.json').read_text())
    if response.get('id')==identifier:
     if response.get('error'):raise RuntimeError(response['error'])
     return response.get('result')
   except (FileNotFoundError,json.JSONDecodeError):pass
   time.sleep(.1)
  raise RuntimeError('Native operation timeout: '+action)
 def api(self,path,method='GET',body=None):
  request={'path':path,'method':method}
  if body is not None:request['body']=body
  result=self.command('api',json.dumps(request),timeout=90)
  assert 200<=result['status']<300,'Native API rejected '+path+': '+str(result['status'])
  return result['body']
 def navigate(self,section,title):
  self.command('navigate','#'+section)
  until=time.monotonic()+20
  while time.monotonic()<until:
   result=self.command('snapshot')
   if result.get('title')==title and 'We couldn’t load' not in result.get('text','') and 'Loading your financial picture' not in result.get('text',''):return result
   time.sleep(.2)
  raise RuntimeError('Native page did not render: '+section)
 def launch(self,app):subprocess.run(['/usr/bin/open','-n','-a',str(app),'--args','--verification-profile',str(self.profile)],check=True);return self.ready()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--profile',required=True);args=p.parse_args();client=NativeClient(args.profile);client.ready()
 for section,title in [('dashboard','Financial overview'),('transactions','Transactions'),('recurring','Recurring Transactions'),('forecast','Balance Forecast'),('calendar','Bill Calendar'),('insights','Spending Insights'),('assistant','AI Assistant'),('savings','Savings Goals'),('settings','Backup & Recovery')]:client.navigate(section,title)
 print('PASS: all nine major financial pages rendered in the real WKWebView through the authenticated native bridge; no development web server required.')
