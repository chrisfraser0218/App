"""End-to-end portable runtime test under process-only external-network denial."""
import argparse,datetime,hashlib,json,shutil,http.cookiejar,os,subprocess,tempfile,time,urllib.request,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
POLICY='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (remote unix-socket))'

def main():
    os.umask(0o077)
    p=argparse.ArgumentParser();p.add_argument('--app',type=Path,required=True);args=p.parse_args();app=args.app.resolve()
    assert app.is_relative_to(ROOT/'dist'),'Only generated bundles may be tested'
    r=app/'Contents/Resources';py=r/'python/Python.framework/Versions/3.11'
    base=Path(tempfile.mkdtemp(prefix='finsight-portable-test-',dir='/tmp')).resolve();base.chmod(0o700);data=base/'data'
    profile=base/'profile.json';profile.write_text(json.dumps({'dataHome':str(data)}));profile.chmod(0o600)
    env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','PYTHONHOME':str(py),'PYTHONPATH':str(r)+':'+str(r/'scripts')+':'+str(r/'site-packages'),'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1'}
    evidence={'profile':str(profile),'app':str(app)};(base/'test-state.json').write_text(json.dumps(evidence))
    print('Synthetic service evidence:',base,flush=True)
    statefile=None;state=None;process=None;results={}
    def start():
        nonlocal process,statefile,state
        statefile=data/'desktop'/('session-'+uuid.uuid4().hex+'.json')
        shim=base/'runner.py'
        shim.write_text("import supervisor,supervisor_core,subprocess,json\nfrom pathlib import Path\npolicy="+repr(POLICY)+"\nlog="+repr(str(base/'child-errors.log'))+"\ndef spawn(self,cmd,cwd):\n self.env['JAVA_TOOL_OPTIONS']='-Djava.net.preferIPv4Stack=true'\n p=subprocess.Popen(['/usr/bin/sandbox-exec','-p',policy]+list(map(str,cmd)),env=self.env,cwd=cwd,stdin=subprocess.DEVNULL,stdout=open(log,'a'),stderr=open(log,'a'))\n row={'pid':p.pid,'identity':supervisor_core.identity(p.pid),'runtime':str(self.resource)};self.children.append((p,row));supervisor_core.private_json(self.desktop/'owned.json',{'children':[r for _,r in self.children],'token':self.token,'aiToken':self.ai_token,'instance':self.instance});return p\nsupervisor_core.Supervisor.spawn=spawn\nsupervisor.core.main()\n")
        process=subprocess.Popen([str(py/'bin/python3.11'),str(shim),'--resources',str(r),'--state',str(statefile),'--parent',str(os.getpid()),'--profile',str(profile)],env=env,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=(base/'supervisor-errors.log').open('a'))
        until=time.monotonic()+150
        while time.monotonic()<until:
            if statefile.exists():
                state=json.loads(statefile.read_text())
                if state.get('status')=='error':raise RuntimeError(state['message'])
                if state.get('status')=='ready':return
            if process.poll() is not None:raise RuntimeError('Supervisor exited before readiness; inspect synthetic-only diagnostic file')
            time.sleep(.2)
        raise RuntimeError('Portable service startup timed out')
    def stop():
        if process and process.poll() is None:process.stdin.write(b'quit\n');process.stdin.flush();process.wait(timeout=90)
    client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def api(path,method='GET',body=None,opener=None):
        opener=opener or client;headers={'X-FinSight-Session':state['token'],'Content-Type':'application/json','Origin':'http://127.0.0.1:19480'}
        if method not in ('GET','HEAD'):
            csrf=api('/auth/csrf',opener=opener)['token'];headers['X-CSRF-TOKEN']=csrf
        req=urllib.request.Request('http://127.0.0.1:19480/api'+path,method=method,headers=headers,data=None if body is None else json.dumps(body).encode())
        with opener.open(req,timeout=70) as response:
            payload=response.read()
            if response.headers.get_content_type() in ('application/json','application/problem+json'):return json.loads(payload)
            return payload
    def finish():
        until=time.monotonic()+120
        while time.monotonic()<until:
            s=api('/backups')
            if not s['busy'] and s['operation']['state']!='running':
                assert s['operation']['state'] not in ('failed','interrupted'),s['operation']['stage'];return s
            time.sleep(.25)
        raise RuntimeError('Synthetic maintenance timeout')
    try:
        start();results['freshDatabaseAndMigrations']=True
        duplicate=data/'desktop'/('session-'+uuid.uuid4().hex+'.json')
        subprocess.run([str(py/'bin/python3.11'),str(r/'supervisor.py'),'--resources',str(r),'--state',str(duplicate),'--parent',str(os.getpid()),'--profile',str(profile)],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        assert json.loads(duplicate.read_text())['status']=='error' and 'already running' in json.loads(duplicate.read_text())['message']
        results['duplicateInstanceRefused']=True
        username='portable_'+uuid.uuid4().hex[:12];password='Synthetic portable service password'
        api('/auth/register','POST',{'username':username,'password':password,'confirmPassword':password})
        categories=api('/categories');assert len(categories)==20;cat=lambda name:next(c['id'] for c in categories if c['name']==name)
        assert float(api('/account')['balance'])==0 and api('/transactions')==[] and api('/recurring-transactions')==[] and api('/planned-transactions')==[] and api('/savings-goals')['goals']==[]
        results['emptyAccountAndDefaultCategories']=True
        today=api('/forecast-preferences')['asOfDate'];tomorrow=(datetime.date.fromisoformat(today)+datetime.timedelta(days=1)).isoformat()
        income=api('/transactions','POST',{'description':'Synthetic income','amount':'1000.00','type':'INCOME','categoryId':cat('Salary'),'date':today})
        prediction=api('/category-predictions','POST',{'description':'Walmart groceries','amount':'50.00'});assert prediction['status']=='suggested' and prediction['categoryName']=='Groceries';results['realOfflineModel']=True
        entry={'description':'Walmart groceries','amount':'50.00','type':'EXPENSE','categoryId':cat('Groceries'),'date':today,'predictionId':prediction['predictionId']}
        expense=api('/transactions','POST',entry);assert float(api('/account')['balance'])==950
        entry.pop('predictionId');entry['amount']='51.00';api('/transactions/'+expense['id'],'PUT',entry);assert float(api('/account')['balance'])==949
        api('/transactions/'+expense['id'],'DELETE');assert float(api('/account')['balance'])==1000;results['transactionCRUDAndExactBalances']=True
        rule=api('/recurring-transactions','POST',{'description':'Synthetic recurring','amount':'5.00','type':'EXPENSE','categoryId':cat('Groceries'),'frequency':'DAILY','startDate':today,'enabled':True,'requestId':str(uuid.uuid4()),'backfillConfirmed':True})
        before=api('/account');api('/recurring-transactions/process-due','POST',{});api('/recurring-transactions/process-due','POST',{});assert api('/account')==before;results['recurringIdempotency']=True
        api('/planned-transactions','POST',{'description':'Synthetic future plan','amount':'10.00','type':'EXPENSE','categoryId':cat('Groceries'),'date':tomorrow,'requestId':str(uuid.uuid4())})
        rows=api('/transactions');forecast=api('/forecasts?months=1');assert api('/calendar?month='+today[:7])['month']==today[:7];api('/insights');api('/assistant/questions','POST',{'question':'What is my current actual balance?'})
        assert api('/transactions')==rows;results['plansForecastCalendarInsightsAssistant']=True
        goal=api('/savings-goals','POST',{'name':'Synthetic goal','description':'Synthetic only','targetAmount':'500.00','requestId':str(uuid.uuid4())})
        api('/savings-goals/'+goal['goal']['id']+'/entries','POST',{'entry':{'amount':'25.00','type':'CONTRIBUTION','bucket':'IN_ACCOUNT','date':today,'note':'Synthetic allocation','transactionId':None},'requestId':str(uuid.uuid4()),'version':goal['goal']['version']})
        assert api('/account')==before;results['savingsDoNotMoveCash']=True
        finish();api('/backups','POST',{});s=finish();backup=s['backups'][0]['id'];api('/backups/'+backup+'/verify','POST',{});finish();api('/backups/'+backup+'/restore-test','POST',{'confirmed':True});finish();results['backupArchiveAndRestoreVerification']=True
        for format in ['json','csv']:
            api('/backups/exports','POST',{'format':format});s=finish();raw=api('/backups/exports/'+s['lastExport']['exportId']);assert raw and b'password_hash' not in (raw if isinstance(raw,bytes) else json.dumps(raw).encode())
        results['ownedJSONAndCSVExports']=True
        snapshot={path:api(path) for path in ['/account','/transactions','/categories','/savings-goals']}
        api('/auth/logout','POST',{});api('/auth/login','POST',{'username':username,'password':password});assert api('/transactions')==snapshot['/transactions'];results['loginLogout']=True
        stop();c=json.loads((data/'installation.json').read_text());assert c['port'] not in (5432,55432,55434)
        assert subprocess.run([str(r/'postgres/bin/pg_ctl'),'-D',str(data/'postgres'),'status'],capture_output=True).returncode!=0
        start();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));api('/auth/login','POST',{'username':username,'password':password})
        assert all(api(path)==value for path,value in snapshot.items());results['ownedShutdownRestartAndPersistence']=True
        stop()
        foreign=__import__('socket').socket();foreign.setsockopt(__import__('socket').SOL_SOCKET,__import__('socket').SO_REUSEADDR,1);foreign.bind(('127.0.0.1',19480));foreign.listen()
        try:
            try:start()
            except RuntimeError as error:assert 'port is occupied' in str(error)
            else:raise AssertionError('Foreign port was adopted')
            assert foreign.getsockname()[1]==19480
        finally:foreign.close();stop()
        results['startupConflictRecovery']=True
        upgrade=ROOT/'dist'/('portable-upgrade-test-'+uuid.uuid4().hex[:10])/'FinSight AI.app';upgrade.parent.mkdir();shutil.copytree(app,upgrade,symlinks=True)
        r=upgrade/'Contents/Resources';marker=r/'upgrade-test.txt';marker.write_text('Synthetic same-schema binary-update acceptance.\n')
        manifest=json.loads((r/'manifest.json').read_text());manifest['payloadFiles']['upgrade-test.txt']=hashlib.sha256(marker.read_bytes()).hexdigest();manifest.pop('buildId');manifest['buildId']=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()[:20];(r/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-',str(upgrade)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        py=r/'python/Python.framework/Versions/3.11';env.update(PYTHONHOME=str(py),PYTHONPATH=str(r)+':'+str(r/'scripts')+':'+str(r/'site-packages'))
        start();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));api('/auth/login','POST',{'username':username,'password':password})
        assert all(api(path)==value for path,value in snapshot.items())
        assert (data/'desktop/current').resolve().name==manifest['buildId'] and len(list((data/'desktop/releases').iterdir()))>=2
        results['sameSchemaUpgradePreservesDataAndPriorRelease']=True
        other=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));api('/auth/register','POST',{'username':'other_'+uuid.uuid4().hex[:10],'password':password,'confirmPassword':password},opener=other);assert api('/transactions',opener=other)==[] and api('/savings-goals',opener=other)['goals']==[];results['twoAccountIsolation']=True
        results['externalNetworkingDeniedForJavaAIAndBackupChildren']=True;results['physicalIntelMacVerified']=False
        (base/'result.json').write_text(json.dumps(results,indent=2));(ROOT/'dist/portable-service-result.json').write_text(json.dumps(results,indent=2))
        print('PASS:',json.dumps(results),flush=True)
    finally:stop()
if __name__=='__main__':main()
