#!/usr/bin/env python3
"""Owned-process supervisor. Fixed local operations, private secrets, no shell, no cluster initialization."""
import argparse,fcntl,getpass,hashlib,json,os,re,secrets,shlex,signal,socket,subprocess,sys,threading,time,uuid,zipfile,zlib
from pathlib import Path

class StartupError(Exception):pass

def private_dir(path):
 if path.is_symlink():raise StartupError('Unsafe application data path')
 path.mkdir(parents=True,exist_ok=True,mode=0o700)
 if path.stat().st_uid!=os.getuid():raise StartupError('Application data must belong to the current user')
 path.chmod(0o700);return path

def private_json(path,value):
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value));temp.chmod(0o600);os.replace(temp,path)

def load_env(path):
 if path.is_symlink() or not path.is_file() or path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077:raise StartupError('Local credential file is missing or not owner-only')
 result={}
 for line in path.read_text().splitlines():
  if not line.strip() or line.lstrip().startswith('#'):continue
  key,sep,value=line.partition('=')
  if not sep or not re.fullmatch('[A-Z][A-Z0-9_]*',key):raise StartupError('Local configuration format is invalid')
  parts=shlex.split(value);result[key]=parts[0] if len(parts)==1 else value
 return result

def port_busy(port):
 with socket.socket() as s:
  s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
  try:s.bind(('127.0.0.1',port));return False
  except OSError:return True

def identity(pid):
 p=subprocess.run(['/bin/ps','-ww','-p',str(pid),'-o','lstart=,command='],capture_output=True,text=True)
 return p.stdout.strip() if p.returncode==0 else None

def same_process(row):return row.get('pid',0)>1 and bool(row.get('identity')) and identity(row['pid'])==row['identity']

def expected_migrations(jar):
 result={}
 with zipfile.ZipFile(jar) as z:
  for name in z.namelist():
   match=re.fullmatch(r'BOOT-INF/classes/db/migration/V(\d+)__.*\.sql',name)
   if match:
    crc=0
    for line in z.read(name).decode('utf-8-sig').splitlines():crc=zlib.crc32(line.encode(),crc)
    result[match.group(1)]=crc if crc<2**31 else crc-2**32
 return result

class Supervisor:
 def __init__(self,args):
  os.umask(0o077)
  self.args=args;self.packaged=Path(args.resources).resolve();self.parent=args.parent;self.parent_identity=identity(self.parent)
  self.production=not args.profile;self.read_only=args.read_only;self.profile={}
  self.base=Path.home()/'Library/Application Support/FinSight AI'
  if args.profile:
   path=Path(args.profile).resolve()
   if not str(path).startswith(('/tmp/finsight-desktop-test-','/private/tmp/finsight-desktop-test-')) or path.stat().st_mode&0o077 or path.stat().st_uid!=os.getuid():raise StartupError('Verification profile must be a private synthetic fixture')
   self.profile=json.loads(path.read_text());self.base=Path(self.profile['dataHome']).resolve()
   if not str(self.base).startswith(('/tmp/finsight-desktop-test-','/private/tmp/finsight-desktop-test-')):raise StartupError('Verification data must be isolated')
  private_dir(self.base);self.desktop=private_dir(self.base/'desktop');self.state=Path(args.state)
  if self.state.parent.resolve()!=self.desktop.resolve() or not re.fullmatch(r'session-[a-f0-9]{32}\.json',self.state.name):raise StartupError('Invalid private session path')
  self.lock_handle=None;self.children=[];self.stop=threading.Event();self.instance=str(uuid.uuid4());self.token=secrets.token_hex(32);self.ai_token=secrets.token_hex(32);self.resource=self.packaged
  self.env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8','DEBUG':'false','PYTHONNOUSERSITE':'1','PYTHONDONTWRITEBYTECODE':'1'}
 def publish(self,status,message,**extra):private_json(self.state,{'status':status,'message':message,'instance':self.instance,**extra})
 def provision(self):
  manifest=json.loads((self.packaged/'manifest.json').read_text());build=manifest['buildId']
  if not re.fullmatch('[a-f0-9]{20}',build):raise StartupError('Invalid packaged runtime manifest')
  root=private_dir(self.desktop/'releases');release=root/build
  if not release.exists():
   import shutil
   self.publish('starting','Preparing bundled local runtimes…');partial=root/('.partial-'+uuid.uuid4().hex)
   shutil.copytree(self.packaged,partial,symlinks=True)
   for name,sha in manifest.get('payloadFiles',manifest['files']).items():
    if not (partial/name).resolve().is_relative_to(partial.resolve()) or hashlib.sha256((partial/name).read_bytes()).hexdigest()!=sha:raise StartupError('Packaged file verification failed')
   os.rename(partial,release)
  for name,sha in manifest['files'].items():
   if hashlib.sha256((release/name).read_bytes()).hexdigest()!=sha:raise StartupError('Installed runtime verification failed')
  self.resource=release;py=release/'python/Python.framework/Versions/3.11';self.python=py/'bin/python3.11'
  self.env.update(PYTHONHOME=str(py),PYTHONPATH=str(release/'site-packages')+':'+str(release/'scripts'),FINSIGHT_PG_BIN=str(release/'postgres/bin'),FINSIGHT_DATA_HOME=str(self.base),FINSIGHT_BACKUP_PYTHON=str(self.python),FINSIGHT_BACKUP_SCRIPT=str(release/'scripts/backup_manager.py'))
  sys.path.insert(0,str(release/'scripts'))
  os.environ.update(self.env)
  if not self.production:os.environ.update(FINSIGHT_BACKUP_TEST_MODE='true',FINSIGHT_BACKUP_EXPECTED_DATA='/tmp/finsight-isolated-verification-12473ab7c796/postgres',FINSIGHT_BACKUP_DATABASES='finsight_phase6_desktop',PGHOST='127.0.0.1',PGPORT='55434',PGUSER='finsight_verify_admin',PGPASSWORD=self.profile['password'])
  from backup_manager import Manager
  self.manager=Manager();self.env.update({k:v for k,v in os.environ.items() if k.startswith(('FINSIGHT_BACKUP_TEST','FINSIGHT_BACKUP_EXPECTED','FINSIGHT_BACKUP_DATABASES','PG'))})
 def database(self):
  m=self.manager;cluster=Path(m.expected_data)
  if not (cluster/'PG_VERSION').is_file() or (cluster/'PG_VERSION').read_text().strip()!='15':raise StartupError('Existing PostgreSQL 15 data is required. No empty replacement will be created.')
  m.require_space(self.base)
  status=subprocess.run([str(m.tools/'pg_ctl'),'-D',str(cluster),'status'],env=self.env,capture_output=True)
  if status.returncode:
   if self.production:raise StartupError('The existing PostgreSQL server is stopped. Automatic database startup is awaiting owner approval; no cluster or service was changed. Use the established local PostgreSQL startup procedure, then Retry.')
   if port_busy(int(m.env['PGPORT'])):raise StartupError('The database port belongs to another server; no process was stopped.')
   self.publish('starting','Starting the existing local PostgreSQL cluster…')
   args=['-D',cluster,'-l',private_dir(self.base/'logs')/'database-startup.log','start']
   if not self.production:args+=['-o','-h 127.0.0.1 -p 55434 -k /tmp/finsight-isolated-verification-12473ab7c796']
   m.command('pg_ctl',args)
  m.check_database()
  if self.production:
   configured=load_env(self.base/'backend.env');url=configured.get('DB_URL','')
   if not re.fullmatch(r'jdbc:postgresql://(?:127\.0\.0\.1|localhost):55432/finsight_demo',url):raise StartupError('Local database configuration differs from the preserved account; startup refused.')
   if m.sql('finsight_demo',"SELECT count(*) FROM accounts WHERE id='00000000-0000-0000-0000-000000000002';")!='1':raise StartupError('Existing financial account missing; refusing to seed an empty replacement.')
   self.env.update(configured)
  else:self.env.update(DB_URL='jdbc:postgresql://127.0.0.1:55434/finsight_phase6_desktop',DB_USERNAME='finsight_verify_admin',DB_PASSWORD=self.profile['password'])
 def request(self,path,ai=False):
  import urllib.request
  port=18481 if ai else 18480;header='X-FinSight-AI' if ai else 'X-FinSight-Session';token=self.ai_token if ai else self.token
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(port)+path,headers={header:token}),timeout=2) as r:return json.load(r)
 def spawn(self,cmd,cwd):
  p=subprocess.Popen([str(x) for x in cmd],env=self.env,cwd=cwd,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  row={'pid':p.pid,'identity':identity(p.pid),'runtime':str(self.resource)};self.children.append((p,row));private_json(self.desktop/'owned.json',{'children':[r for _,r in self.children],'token':self.token,'aiToken':self.ai_token,'instance':self.instance})
  return p
 def wait_ready(self,process,ai=False):
  until=time.monotonic()+90
  while time.monotonic()<until and not self.stop.is_set():
   if process.poll() is not None:raise StartupError('A bundled local service exited during startup. Data was not replaced; check runtime compatibility or retry.')
   try:
    result=self.request('/health' if ai else '/api/desktop/health',ai)
    if result.get('instance')==self.instance:
     for child,row in self.children:
      if child is process:row['identity']=identity(process.pid)
     private_json(self.desktop/'owned.json',{'children':[r for _,r in self.children],'token':self.token,'aiToken':self.ai_token,'instance':self.instance})
     return
   except Exception:pass
   self.stop.wait(.25)
  raise StartupError('Local service readiness timed out; no unrelated process was adopted.')
 def recover(self):
  path=self.desktop/'owned.json'
  if not path.exists():return
  record=json.loads(path.read_text())
  # Only exact previously recorded process identity, never port owners or guessed pids.
  live=[r for r in record.get('children',[]) if same_process(r) and str(r.get('runtime','')).startswith(str(self.desktop/'releases')+'/') and str(r['runtime']) in r['identity']]
  if live:
   self.publish('starting','Finishing services from an interrupted previous launch…')
   with self.manager.lock():
    for r in reversed(live):
     if same_process(r):os.kill(r['pid'],signal.SIGTERM)
    deadline=time.monotonic()+60
    while any(same_process(r) for r in live) and time.monotonic()<deadline:time.sleep(.25)
    if any(same_process(r) for r in live):raise StartupError('Previous owned services are still draining. Retry after they finish; they were not force-killed.')
  path.unlink(missing_ok=True)
 def start_services(self):
  expected=expected_migrations(self.resource/'backend.jar');rows=self.manager.json_sql(self.manager.sources[0],"SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT version,checksum,success FROM flyway_schema_history) t;")
  for row in rows:
   if not row['success'] or row['version'] not in expected or row['checksum']!=expected[row['version']]:raise StartupError('Database schema does not match this application. Use a compatible build; automatic rollback is refused.')
  pending=set(expected)-{r['version'] for r in rows}
  gate=None
  if pending:
   if self.read_only:raise StartupError('Read-only verification cannot apply a database migration.')
   gate=self.manager.lock();gate.__enter__();self.publish('starting','Verifying a full local backup before schema updates…')
   backup=self.manager.create('desktop-pre-upgrade');self.manager.restore_test(backup,False)
  try:
   for port in [18480,18481]:
    if port_busy(port):raise StartupError('A required desktop service port is in use. Close the conflicting application; no process was terminated.')
   self.env.update(PORT='18480',SERVER_ADDRESS='127.0.0.1',SERVER_SHUTDOWN='graceful',SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE='45s',AI_SERVICE_URL='http://127.0.0.1:18481',FINSIGHT_DESKTOP_ENABLED='true',FINSIGHT_DESKTOP_SESSION_TOKEN=self.token,FINSIGHT_AI_SESSION_TOKEN=self.ai_token,FINSIGHT_DESKTOP_INSTANCE=self.instance,FINSIGHT_DESKTOP_READ_ONLY=str(self.read_only).lower(),SPRING_WEB_RESOURCES_STATIC_LOCATIONS=(self.resource/'frontend').as_uri()+'/',RECURRING_PROCESSING_ENABLED='false' if self.read_only else 'true')
   if not self.production:self.env.update(FINSIGHT_BACKUP_ENABLED='true')
   self.publish('starting','Starting local AI categorization and analysis…');ai=self.spawn([self.python,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','18481','--no-access-log'],self.resource/'ai');self.wait_ready(ai,True)
   self.publish('starting','Starting the financial API and checking readiness…');api=self.spawn([self.resource/'java/bin/java','-Xms64m','-Xmx512m','-jar',self.resource/'backend.jar'],self.resource);self.wait_ready(api)
  finally:
   if gate:gate.__exit__(None,None,None)
  if self.production:
   temp=self.desktop/('.current-'+uuid.uuid4().hex);temp.symlink_to(self.resource,target_is_directory=True);os.replace(temp,self.desktop/'current')
  self.publish('ready','Ready',port=18480,token=self.token,readOnly=self.read_only,test=not self.production,resources=str(self.resource))
 def shutdown(self):
  if not self.children:return
  self.publish('stopping','Waiting for active backup or restore operations to finish…')
  while True:
   try:
    with self.manager.lock():
     # Java drains API writes while the shared gate prevents new maintenance jobs.
     for p,row in reversed(self.children):
      if p.poll() is None:p.terminate()
      try:p.wait(timeout=60)
      except subprocess.TimeoutExpired:
       self.publish('stopping','A local service is still draining. It has not been force-killed.');p.wait()
     break
   except Exception as e:
    if e.__class__.__name__!='Busy':raise
    self.stop.wait(.5);time.sleep(.25)
  (self.desktop/'owned.json').unlink(missing_ok=True);self.publish('stopped','Closed safely. PostgreSQL remains available for scheduled backups.')
 def run(self):
  lock_path=self.desktop/'application.lock'
  if lock_path.is_symlink():raise StartupError('Unsafe application lock path')
  handle=lock_path.open('a');self.lock_handle=handle
  try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise StartupError('FinSight is already running or finishing a backup. Switch to it or wait and retry.')
  self.provision();self.database();self.recover();self.start_services()
  def commands():
   for line in sys.stdin:
    if line.strip()=='quit':self.stop.set();return
   self.stop.set()
  threading.Thread(target=commands,daemon=True).start()
  ticks=0
  while not self.stop.wait(1):
   ticks+=1
   if ticks%5==0:
    try:self.manager.check_database();self.request('/api/desktop/health')
    except Exception:raise StartupError('A local financial service is unavailable. Close/reopen to restart safely; data was not reset.')
   if identity(self.parent)!=self.parent_identity:self.stop.set();break
   if any(p.poll() is not None for p,_ in self.children):raise StartupError('A local service stopped unexpectedly. Quit/reopen to restart safely; financial data is preserved.')

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--resources',required=True);parser.add_argument('--state',required=True);parser.add_argument('--parent',type=int,required=True);parser.add_argument('--profile');parser.add_argument('--read-only',action='store_true');args=parser.parse_args();supervisor=None;failure=None
 try:
  supervisor=Supervisor(args)
  signal.signal(signal.SIGTERM,lambda *_:supervisor.stop.set());signal.signal(signal.SIGINT,lambda *_:supervisor.stop.set())
  supervisor.run()
 except Exception as e:
  failure=str(e) if isinstance(e,StartupError) or e.__class__.__name__ in ['BackupError','Busy'] else 'Local startup failed. No data was reset. Check the packaged runtime and private configuration.'
  if supervisor:supervisor.publish('error',failure)
 finally:
  if supervisor:
   try:supervisor.shutdown()
   except Exception:supervisor.publish('error','Services are still finishing. Existing database and backups were not stopped.')
   if failure:supervisor.publish('error',failure)
if __name__=='__main__':main()
