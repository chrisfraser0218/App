"""Real app lifecycle fault tests, restricted to a private synthetic verification profile."""
import argparse,fcntl,json,os,signal,socket,subprocess,time,urllib.error,urllib.request
from pathlib import Path
from native_acceptance import NativeClient

def wait_for(fn,timeout=90):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  value=fn()
  if value:return value
  time.sleep(.2)
 raise RuntimeError('Lifecycle acceptance timeout')
def alive(pid):
 try:os.kill(pid,0);return True
 except ProcessLookupError:return False

def run(c,app,cold_database=False):
 c.ready();baseline=c.api('/account');cluster=Path('/tmp/finsight-isolated-verification-12473ab7c796/postgres');assert (cluster/'PG_VERSION').read_text().strip()=='15'
 def owned():return json.loads((c.base/'desktop/owned.json').read_text())['children']
 def host():
  lines=subprocess.check_output(['/bin/ps','-axo','pid=,command='],text=True).splitlines()
  expected=str(app/'Contents/MacOS/FinSightAI')+' --verification-profile '
  rows=[int(line.strip().split(' ',1)[0])for line in lines if expected in line and Path(line.split(expected,1)[1].strip()).resolve()==c.profile]
  assert len(rows)==1,'One exact synthetic host required';return rows[0]
 def launch():
  previous=c.state().get('instance');start=time.monotonic();subprocess.run(['/usr/bin/open','-n','-a',str(app),'--args','--verification-profile',str(c.profile)],check=True)
  wait_for(lambda:c.state().get('instance')!=previous);c.ready();return round(time.monotonic()-start,2)
 def quit(hold=False):
  pid=host();children=owned();pgpid=int((cluster/'postmaster.pid').read_text().splitlines()[0]);gate=(c.base/'backups/managed/operation.lock').open('a')
  if hold:fcntl.flock(gate,fcntl.LOCK_EX|fcntl.LOCK_NB)
  c.command('quit')
  if hold:
   time.sleep(2);assert alive(pid) and all(alive(r['pid'])for r in children),'Maintenance interrupted';fcntl.flock(gate,fcntl.LOCK_UN)
  gate.close();wait_for(lambda:not alive(pid));assert all(not alive(r['pid'])for r in children);assert alive(pgpid),'PostgreSQL must remain for backups'
 quit(True);warm=launch();assert c.api('/account')==baseline
 # Real unauthenticated local requests must fail, not expose data.
 for url in ['http://127.0.0.1:18480/api/account','http://127.0.0.1:18481/health']:
  try:urllib.request.urlopen(url);raise AssertionError('Unauthenticated API exposed')
  except urllib.error.HTTPError as e:assert e.code==403
 children=owned();ai=next(r for r in children if '-m uvicorn' in r['identity']);os.kill(ai['pid'],signal.SIGTERM)
 wait_for(lambda:c.state().get('status')=='error');wait_for(lambda:all(not alive(r['pid'])for r in children));assert c.command('status')['error']
 c.command('retry');wait_for(lambda:c.state().get('status')=='ready');c.ready();assert c.api('/account')==baseline
 quit();conflict=socket.socket();conflict.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);conflict.bind(('127.0.0.1',18480));conflict.listen()
 previous=c.state().get('instance');subprocess.run(['/usr/bin/open','-n','-a',str(app),'--args','--verification-profile',str(c.profile)],check=True);wait_for(lambda:c.state().get('instance')!=previous and c.state().get('status')=='error');assert 'port' in c.state()['message'].lower();assert conflict.getsockname()[1]==18480
 conflict.close();c.command('retry');wait_for(lambda:c.state().get('status')=='ready');c.ready();assert c.api('/account')==baseline
 # Simulate abrupt native-host exit: supervisor must drain its own children.
 pid=host();children=owned();os.kill(pid,signal.SIGTERM);wait_for(lambda:all(not alive(r['pid'])for r in children));wait_for(lambda:not alive(pid));launch();assert c.api('/account')==baseline
 quit()
 cold=None
 if cold_database:
  # Stop/restart only the existing isolated cluster, never initdb or personal PostgreSQL.
  pg='/opt/homebrew/opt/postgresql@15/bin';environment=dict(os.environ,PGPASSWORD=json.loads(c.profile.read_text())['password'])
  query=subprocess.check_output([pg+'/psql','-X','-h','127.0.0.1','-p','55434','-U','finsight_verify_admin','-d','finsight_phase6_desktop','-Atc',"SELECT current_setting('data_directory') || '|' || (SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid());"],env=environment,text=True).strip();assert query==str(cluster)+'|0','Other isolated clients are active'
  subprocess.run([pg+'/pg_ctl','-D',str(cluster),'-m','fast','stop'],check=True,stdout=subprocess.DEVNULL);cold=launch();assert c.api('/account')==baseline
  pgpid=int((cluster/'postmaster.pid').read_text().splitlines()[0]);command=subprocess.check_output(['/bin/ps','-ww','-p',str(pgpid),'-o','command='],text=True);assert '/desktop/releases/' in command and '/postgres/bin/postgres' in command,'PostgreSQL was not started from bundled runtime'
 result={'graceful_quit_waits_for_maintenance':True,'reopen_preserves_synthetic_records':True,'unauthenticated_services_denied':True,'service_crash_recovery':True,'port_conflict_no_foreign_kill':True,'native_crash_drains_children':True,'existing_cluster_cold_start_bundled_postgres':cold is not None,'warm_ready_seconds':warm,'cold_database_ready_seconds':cold}
 return result
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--profile',required=True);parser.add_argument('--app',required=True);parser.add_argument('--cold-database',action='store_true',help='Requires separate owner approval to stop/start the existing isolated cluster');args=parser.parse_args();result=run(NativeClient(args.profile),Path(args.app).resolve(),args.cold_database);Path('/tmp/finsight-phase6-lifecycle-result.json').write_text(json.dumps(result));print('PASS: native graceful quit/maintenance wait, reopen persistence, local API authentication, service crash/retry, port conflict safety and abrupt host recovery. Cold database restart is opt-in only. '+json.dumps({k:v for k,v in result.items()if k.endswith('seconds')}))
