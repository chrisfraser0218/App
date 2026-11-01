"""Fresh portable installation acceptance. Generated bundle and synthetic temp HOME data only."""
import argparse,json,os,subprocess,urllib.request,sys,tempfile,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'desktop/tests'))
from native_acceptance import NativeClient
from authentication_acceptance import sign_in,wait_title

class PortableClient(NativeClient):
    def __init__(self,profile):
        self.profile=Path(profile).resolve();self.base=Path(json.loads(self.profile.read_text())['dataHome']).resolve();self.automation=self.base/'automation'
        assert str(self.base).startswith('/private/tmp/finsight-portable-test-')
        assert self.profile.stat().st_mode&0o077==0

    def launch(self,app):
        executable=Path(app)/'Contents/MacOS/FinSightAI'
        self.native_process=subprocess.Popen([str(executable),'--verification-profile',str(self.profile)],stdout=subprocess.DEVNULL,stderr=(self.profile.parent/'native-errors.log').open('a'))
        return self.ready()
    def ready(self,timeout=180):
        until=time.monotonic()+timeout;previous=None
        while time.monotonic()<until:
            state=self.state()
            progress=(state.get('status'),state.get('message'))
            if progress!=previous:
                with (self.profile.parent/'startup-progress.jsonl').open('a') as log:log.write(json.dumps({'time':time.time(),'status':progress[0],'message':progress[1]})+'\n')
                previous=progress
            if state.get('status')=='error':raise RuntimeError(state['message'])
            if state.get('status')=='ready':
                request=urllib.request.Request('http://127.0.0.1:19480/api/desktop/health',headers={'X-FinSight-Session':state['token']})
                if json.load(urllib.request.urlopen(request))['instance']==state['instance']:
                    try:
                        if self.command('snapshot',timeout=3).get('title'):return state
                    except RuntimeError:pass
            time.sleep(.25)
        raise RuntimeError('Portable native readiness timeout')

def main():
    os.umask(0o077)
    p=argparse.ArgumentParser();p.add_argument('--app',type=Path,required=True);args=p.parse_args()
    app=args.app.resolve()
    assert app.is_relative_to(ROOT/'dist') and app.name=='FinSight AI.app','Never automate the existing Applications app'
    root=Path(tempfile.mkdtemp(prefix='finsight-portable-test-',dir='/tmp')).resolve();root.chmod(0o700)
    profile=root/'profile.json';profile.write_text(json.dumps({'dataHome':str(root/'data')}));profile.chmod(0o600)
    (root/'test-state.json').write_text(json.dumps({'profile':str(profile),'app':str(app)}))
    print('Synthetic profile:',profile,flush=True)
    c=PortableClient(profile);result={}
    try:
        c.launch(app);wait_title(c,'Welcome to FinSight AI');result['freshStartup']=True
        first='portable_'+uuid.uuid4().hex[:12];password='Synthetic portable acceptance password'
        sign_in(c,first,password,register=True)
        assert len(c.api('/categories'))==20
        for route in ['/transactions','/recurring-transactions','/planned-transactions']:assert c.api(route)==[]
        assert c.api('/savings-goals')['goals']==[]
        assert str(c.api('/account')['balance']) in ('0','0.0','0.00')
        result.update(emptyRegistration=True,ownedDefaultCategories=True)
        c.navigate('transactions','Transactions');c.command('click','Add transaction')
        for label,value in [('Description','Starbucks Coffee'),('Amount (USD)','8.75')]:c.command('fill',json.dumps({'label':label,'value':value}))
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            if 'Use suggestion' in c.command('snapshot').get('text',''):break
            time.sleep(.2)
        else:raise RuntimeError('Native AI suggestion did not appear')
        c.command('click','Use suggestion')
        groceries=next(cat['id'] for cat in c.api('/categories') if cat['name']=='Groceries')
        c.command('fill',json.dumps({'label':'Category','value':groceries}));c.command('click','Add transaction')
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            saved=c.api('/transactions')
            if saved:break
            time.sleep(.2)
        assert len(saved)==1 and saved[0]['categoryId']==groceries and float(c.api('/account')['balance'])==-8.75
        result.update(nativeTransactionForm=True,visibleRealAI=True,manualOverride=True,exactSavedBalance=True)
        for section,title in [('dashboard','Financial overview'),('transactions','Transactions'),('recurring','Recurring Transactions'),('forecast','Balance Forecast'),('calendar','Bill Calendar'),('insights','Spending Insights'),('assistant','AI Assistant'),('savings','Savings Goals'),('settings','Backup & Recovery')]:c.navigate(section,title)
        result['allNinePagesRendered']=True
        # Real external-volume acceptance requires hardware; do not bypass /Volumes validation.
        result['physicalExternalDriveVerified']=False
        before=c.api('/account');records=c.api('/transactions');goals=c.api('/savings-goals');categories=c.api('/categories')
        c.command('click','Log out');wait_title(c,'Welcome to FinSight AI');sign_in(c,first,password)
        assert c.api('/account')==before and c.api('/transactions')==records
        c.command('quit');c.native_process.wait(timeout=90)
        data=root/'data';config=json.loads((data/'installation.json').read_text());assert config['phase']=='ready' and config['port'] not in [5432,55432,55434]
        pg=app/'Contents/Resources/postgres/bin/pg_ctl'
        assert subprocess.run([str(pg),'-D',str(data/'postgres'),'status'],capture_output=True).returncode!=0
        c.launch(app);wait_title(c,'Welcome to FinSight AI');sign_in(c,first,password)
        assert c.api('/account')==before and c.api('/transactions')==records and c.api('/savings-goals')==goals and c.api('/categories')==categories
        c.command('click','Log out');wait_title(c,'Welcome to FinSight AI')
        sign_in(c,'portable_'+uuid.uuid4().hex[:12],password,register=True)
        assert c.api('/transactions')==[] and c.api('/savings-goals')['goals']==[]
        assert c.command('api',json.dumps({'path':'/transactions/'+records[0]['id']}))['status']==404
        result.update(loginLogout=True,ownedPostgresShutdown=True,restartPersistence=True,twoAccountIsolation=True)
        assert not c.command('snapshot').get('errors')
        result.update(nativeRendererErrors=0,physicalIntelMacVerified=False,networkDisabledVerified=False)
        (root/'result.json').write_text(json.dumps(result,indent=2));(ROOT/'dist/portable-native-result.json').write_text(json.dumps(result,indent=2))
        print('PASS: portable native startup, defaults, visible AI/manual override, saved balance, nine pages, isolation and restart persistence.',flush=True)
    finally:
        try:c.command('quit')
        except Exception:
            if getattr(c,'native_process',None) and c.native_process.poll() is None:c.native_process.terminate()
    print('Retained synthetic evidence:',root)
if __name__=='__main__':main()
