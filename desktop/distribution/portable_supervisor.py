#!/usr/bin/env python3
"""Separate recipient lifecycle. No access to legacy app storage, service or database."""
import fcntl, hashlib, json, os, secrets, signal, socket, subprocess, sys, threading, time, uuid
from pathlib import Path
import supervisor_core as core
from supervisor_core import StartupError, private_dir, private_json, identity, expected_migrations, port_busy
from portable_config import data_home, load, FORMAT

class Supervisor(core.Supervisor):
    def __init__(self,args):
        os.umask(0o077)
        self.args=args;self.packaged=Path(args.resources).resolve();self.parent=args.parent;self.parent_identity=identity(self.parent)
        self.production=not args.profile;self.read_only=args.read_only
        if self.read_only:raise StartupError('Portable read-only initialization is not supported')
        self.base=data_home(args.profile)
        if self.base.exists() and any(p.name not in (('desktop','automation') if args.profile else ('desktop',)) for p in self.base.iterdir()) and not (self.base/'installation.json').exists():
            raise StartupError('Unrecognized existing directory; refusing to adopt or initialize it')
        private_dir(self.base);self.desktop=private_dir(self.base/'desktop');self.state=Path(args.state)
        if self.state.parent.resolve()!=self.desktop or not __import__('re').fullmatch(r'session-[a-f0-9]{32}\.json',self.state.name):raise StartupError('Invalid session path')
        self.lock_handle=None;self.children=[];self.stop=threading.Event();self.instance=str(uuid.uuid4());self.token=secrets.token_hex(32);self.ai_token=secrets.token_hex(32);self.resource=self.packaged
        self.env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8','DEBUG':'false','PYTHONNOUSERSITE':'1','PYTHONDONTWRITEBYTECODE':'1'}
        self.pg_verified=False
    def provision(self):
        import shutil,re
        manifest=json.loads((self.packaged/'manifest.json').read_text());build=manifest['buildId']
        if manifest.get('distribution')!='portable-v1' or not re.fullmatch('[a-f0-9]{20}',build):raise StartupError('Portable release identity required')
        root=private_dir(self.desktop/'releases');release=root/build
        if not release.exists():
            self.publish('starting','Preparing bundled local runtimes…');partial=root/('.partial-'+uuid.uuid4().hex)
            shutil.copytree(self.packaged,partial,symlinks=True)
            for name,sha in manifest['payloadFiles'].items():
                if not (partial/name).resolve().is_relative_to(partial.resolve()) or hashlib.sha256((partial/name).read_bytes()).hexdigest()!=sha:raise StartupError('Release integrity check failed')
            os.rename(partial,release)
        for name,sha in manifest['files'].items():
            if hashlib.sha256((release/name).read_bytes()).hexdigest()!=sha:raise StartupError('Runtime integrity check failed')
        self.resource=release;py=release/'python/Python.framework/Versions/3.11';self.python=py/'bin/python3.11'
        self.env.update(PYTHONHOME=str(py),PYTHONPATH=str(release/'site-packages')+':'+str(release/'scripts')+':'+str(release),FINSIGHT_PG_BIN=str(release/'postgres/bin'),FINSIGHT_DATA_HOME=str(self.base),FINSIGHT_BACKUP_PYTHON=str(self.python),FINSIGHT_BACKUP_SCRIPT=str(release/'scripts/backup_manager.py'))
        os.environ.update(self.env);sys.path.insert(0,str(release/'scripts'))
    def request(self,path,ai=False):
        import urllib.request
        port=19481 if ai else 19480;header='X-FinSight-AI' if ai else 'X-FinSight-Session';token=self.ai_token if ai else self.token
        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(port)+path,headers={header:token}),timeout=2) as response:return json.load(response)
    def pg(self,tool,args,input=None):
        result=subprocess.run([str(self.resource/'postgres/bin'/tool),*map(str,args)],input=input,text=True,env=self.pg_env,capture_output=True,timeout=120)
        if result.returncode:raise StartupError('Private PostgreSQL operation failed; existing files retained for recovery')
        return result.stdout.strip()
    def sql(self,database,query):
        return self.pg('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-d',database],query)
    def database(self):
        config_path=self.base/'installation.json'
        if not config_path.exists():
            # Swift may create desktop/session metadata, never financial storage.
            if any(p.name not in (('desktop','automation') if self.args.profile else ('desktop',)) for p in self.base.iterdir()):raise StartupError('Existing data without identity; initialization refused')
            with socket.socket() as s:
                s.bind(('127.0.0.1',0));port=s.getsockname()[1]
            if port in (5432,55432,55434):raise StartupError('Reserved database port; retry startup')
            c={'format':FORMAT,'id':uuid.uuid4().hex,'dataHome':str(self.base),'port':port,'adminPassword':secrets.token_hex(32),'appPassword':secrets.token_hex(32),'phase':'initializing'}
            private_json(config_path,c)
        self.config=load(self.base);c=self.config;cluster=self.base/'postgres';run=private_dir(self.base/'run')
        from backup_manager import Manager
        self.manager=Manager()
        if len(str(run).encode())>75:raise StartupError('Application data path is too long for a private PostgreSQL socket')
        self.pg_env=dict(self.env,PGHOST=str(run),PGPORT=str(c['port']),PGUSER='finsight_admin',PGPASSWORD=c['adminPassword'],PGCONNECT_TIMEOUT='5',PGSSLMODE='disable')
        if not cluster.exists():
            if c['phase']!='initializing':raise StartupError('Existing database is missing; automatic reinitialization refused')
            stage=self.base/'postgres.initializing'
            if stage.exists():raise StartupError('Interrupted database initialization retained; deliberate recovery required')
            password=self.base/('.init-password-'+uuid.uuid4().hex)
            fd=os.open(password,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            try:
                with os.fdopen(fd,'w') as f:f.write(c['adminPassword']+'\n')
                self.publish('starting','Creating your private local database…')
                self.pg('initdb',['-D',stage,'-U','finsight_admin','--pwfile',password,'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--locale=C'])
                with (stage/'postgresql.conf').open('a') as f:
                    f.write("\nlisten_addresses = '127.0.0.1'\nport = "+str(c['port'])+"\nunix_socket_directories = '"+str(run).replace("'","''")+"'\nunix_socket_permissions = 0700\npassword_encryption = 'scram-sha-256'\n")
                os.rename(stage,cluster)
            finally:password.unlink(missing_ok=True)
        if cluster.is_symlink() or not (cluster/'PG_VERSION').is_file() or (cluster/'PG_VERSION').read_text().strip()!='15':raise StartupError('Owned PostgreSQL 15 cluster required; no replacement created')
        status=subprocess.run([str(self.resource/'postgres/bin/pg_ctl'),'-D',str(cluster),'status'],env=self.pg_env,capture_output=True)
        if status.returncode:
            if port_busy(c['port']):raise StartupError('Private database port is occupied; foreign server will not be adopted or stopped')
            self.pg('pg_ctl',['-D',cluster,'-l',private_dir(self.base/'logs')/'postgres.log','-w','start'])
        if Path(self.sql('postgres','SHOW data_directory;')).resolve()!=cluster:raise StartupError('Database identity mismatch; refusing access')
        self.pg_verified=True
        if c['phase']=='initializing':
            # Passwords travel over private stdin, never process args or logs.
            self.sql('postgres',"SET log_statement='none'; SET log_min_error_statement='panic';\nDO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='finsight_app') THEN CREATE ROLE finsight_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+c['appPassword']+"'; END IF; END $$;\n")
            if self.sql('postgres',"SELECT count(*) FROM pg_database WHERE datname='finsight';")=='0':self.sql('postgres','CREATE DATABASE finsight OWNER finsight_app;')
            c['phase']='database-ready';private_json(config_path,c)
        self.env.update(DB_URL='jdbc:postgresql://127.0.0.1:'+str(c['port'])+'/finsight',DB_USERNAME='finsight_app',DB_PASSWORD=c['appPassword'])
        self.manager.check_database()
    def start_services(self):
        expected=expected_migrations(self.resource/'backend.jar')
        has_history=self.sql('finsight',"SELECT to_regclass('public.flyway_schema_history') IS NOT NULL;")=='t'
        if has_history:
            rows=self.manager.json_sql('finsight',"SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT version,checksum,success FROM flyway_schema_history) t;")
            if any(not r['success'] or r['version'] not in expected or r['checksum']!=expected[r['version']] for r in rows):raise StartupError('Incompatible migration history; no downgrade attempted')
            if set(expected)-{r['version'] for r in rows}:
                with self.manager.lock():
                    backup=self.manager.create('desktop-pre-upgrade');self.manager.restore_test(backup,False)
        else:
            if self.config['phase']!='database-ready' or self.sql('finsight',"SELECT count(*) FROM pg_tables WHERE schemaname='public';")!='0':raise StartupError('Unknown schema; automatic migration refused')
        for port in (19480,19481):
            if port_busy(port):raise StartupError('A required app port is occupied. Close the conflicting app; no process was stopped')
        self.env.update(PORT='19480',SERVER_ADDRESS='127.0.0.1',SERVER_SHUTDOWN='graceful',SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE='45s',AI_SERVICE_URL='http://127.0.0.1:19481',FINSIGHT_DESKTOP_ENABLED='true',FINSIGHT_DESKTOP_SESSION_TOKEN=self.token,FINSIGHT_AI_SESSION_TOKEN=self.ai_token,FINSIGHT_DESKTOP_INSTANCE=self.instance,FINSIGHT_DESKTOP_READ_ONLY='false',SPRING_WEB_RESOURCES_STATIC_LOCATIONS=(self.resource/'frontend').as_uri()+'/',RECURRING_PROCESSING_ENABLED='true',FINSIGHT_BACKUP_ENABLED='true')
        self.publish('starting','Starting local categorization…');ai=self.spawn([self.python,'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','19481','--no-access-log'],self.resource/'ai');self.wait_ready(ai,True)
        self.publish('starting','Starting your financial workspace…');api=self.spawn([self.resource/'java/bin/java','-Xms64m','-Xmx512m','-jar',self.resource/'backend.jar'],self.resource);self.wait_ready(api)
        self.config['phase']='ready';private_json(self.base/'installation.json',self.config)
        temp=self.desktop/('.current-'+uuid.uuid4().hex);temp.symlink_to(self.resource,target_is_directory=True);os.replace(temp,self.desktop/'current')
        self.publish('ready','Ready',port=19480,token=self.token,readOnly=False,test=not self.production,resources=str(self.resource))
    def shutdown(self):
        # Even a partial startup must close only the independently verified owned cluster.
        if self.children:super().shutdown()
        if self.pg_verified:
            with self.manager.lock():
                if self.sql('postgres',"SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid();")!='0':raise StartupError('Private database still has clients; left running safely')
                self.pg('pg_ctl',['-D',self.base/'postgres','-m','fast','-w','stop'])
            self.pg_verified=False
        self.publish('stopped','Closed safely. Backups resume when this app is reopened.')

core.Supervisor=Supervisor
if __name__=='__main__':core.main()
