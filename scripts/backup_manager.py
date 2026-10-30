#!/usr/bin/env python3
"""Local-only PostgreSQL maintenance. Stdlib only; stdout contains operation metadata, never records/secrets."""
import argparse
import contextlib
import csv
import datetime as dt
import fcntl
import getpass
import hashlib
import io
import json
import os
import plistlib
from pathlib import Path
import re
import select
import shutil
import stat
import subprocess
import sys
import uuid
import zipfile
from zoneinfo import ZoneInfo

UTC = dt.timezone.utc
SOURCES = ['finsight_demo', 'finsight_test', 'postgres', 'finsight_local_maintenance']
USER_ID = '00000000-0000-0000-0000-000000000001'
DEFAULTS = dict(enabled=True, time='02:00', timeZone='America/New_York', daily=7, weekly=4, monthly=3,
                restoreEveryDays=7, externalDirectory='', externalOverdueDays=7, version=0)
class BackupError(Exception): pass
class Busy(BackupError): pass

def ident(value): return '"' + value.replace('"', '""') + '"'
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()
def private_dir(path):
    path = Path(path)
    if path.is_symlink(): raise BackupError('Symbolic-link storage is refused')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.stat().st_uid != os.getuid(): raise BackupError('Storage must belong to the current local user')
    path.chmod(0o700)
    if path.stat().st_mode & 0o077:raise BackupError("Backup storage does not enforce owner-only permissions")
    return path

def read_json(path, default=None):
    if not path.exists(): return default
    if path.is_symlink() or not path.is_file(): raise BackupError('Unsafe metadata path')
    return json.loads(path.read_text())
def write_json(path, value):
    if path.is_symlink(): raise BackupError('Unsafe metadata path')
    temp = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out, sort_keys=True, indent=2); out.write('\n'); out.flush(); os.fsync(out.fileno())
    os.replace(temp, path)

def retention_keep(rows, settings):
    """Union of latest backup in each of N calendar days, ISO weeks and months; safety copies are pinned."""
    keep = {r['id'] for r in rows if r.get('reason') == 'safety'}
    rows = sorted(rows, key=lambda r: r['createdAt'], reverse=True)
    if rows: keep.add(rows[0]['id'])
    keep.update(r['id'] for r in rows[:settings['daily']]) # Recent undo points, including multiple manual versions in one day.
    restored=[r for r in rows if r.get('verification')=='restore_verified']
    if restored:keep.add(restored[0]['id'])
    for field, bucket in [('daily', lambda d:d.date().isoformat()), ('weekly',lambda d:str(d.isocalendar()[:2])), ('monthly',lambda d:d.strftime('%Y-%m'))]:
        seen = set()
        for row in rows:
            key = bucket(dt.datetime.fromisoformat(row['createdAt']))
            if key not in seen and len(seen) < settings[field]: seen.add(key); keep.add(row['id'])
    return keep

def local_external_volume(info):
    return bool(isinstance(info,dict) and str(info.get('DeviceNode','')).startswith('/dev/disk')
                and info.get('Internal') is False and info.get('BusProtocol') in
                {'USB','Thunderbolt','FireWire','SATA','PCI-Express','PCIe','SAS'})

class Manager:
    def __init__(self, now=None):
        os.umask(0o077)
        self.base = Path(os.getenv('FINSIGHT_DATA_HOME', str(Path.home() / 'Library/Application Support/FinSight AI'))).absolute()
        self.test = os.getenv('FINSIGHT_BACKUP_TEST_MODE') == 'true'
        if self.test and not str(self.base).startswith(('/tmp/finsight-', '/private/tmp/finsight-')): raise BackupError('Test storage must be explicitly isolated')
        self.expected_data = os.getenv('FINSIGHT_BACKUP_EXPECTED_DATA', str(self.base / 'postgres'))
        if not self.test and self.expected_data != str(self.base / 'postgres'): raise BackupError('Personal cluster identity cannot be overridden')
        self.sources = os.getenv('FINSIGHT_BACKUP_DATABASES', ','.join(SOURCES)).split(',') if self.test else SOURCES
        if any(not re.fullmatch('[a-z][a-z0-9_]{0,62}', d) for d in self.sources): raise BackupError('Invalid database configuration')
        self.root = private_dir(self.base / 'backups'); self.managed = private_dir(self.root / 'managed')
        self.exports = private_dir(self.managed / 'exports')
        self.tools = Path(os.getenv('FINSIGHT_PG_BIN', '/opt/homebrew/opt/postgresql@15/bin'))
        self.env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
        self.env.update(PGHOST=str(self.base / 'run'), PGPORT='55432', PGUSER=getpass.getuser(), PGCONNECT_TIMEOUT='5', PGSSLMODE='disable', PGTZ='UTC', PGOPTIONS='-c timezone=UTC', PGAPPNAME='finsight-backup')
        if self.test:
            for key in ['PGHOST','PGPORT','PGUSER','PGPASSWORD']: 
                if key in os.environ:self.env[key] = os.environ[key]
            if self.env['PGHOST'] != '127.0.0.1' or self.env['PGPORT'] != '55434' or not self.expected_data.startswith(('/tmp/finsight-isolated-verification-', '/private/tmp/finsight-isolated-verification-')):
                raise BackupError('Test connection must use the existing isolated verification cluster')
        self.now_override = now
        if self.test and os.getenv('FINSIGHT_BACKUP_TEST_NOW'): self.now_override = dt.datetime.fromisoformat(os.environ['FINSIGHT_BACKUP_TEST_NOW'])
    def now(self): return self.now_override or dt.datetime.now(UTC)
    def stamp(self): return self.now().isoformat()
    def config(self): return read_json(self.managed / 'settings.json', DEFAULTS.copy())
    def history(self): return read_json(self.managed / 'history.json', [])
    @contextlib.contextmanager
    def lock(self):
        path = self.managed / 'operation.lock'
        if path.is_symlink(): raise BackupError('Unsafe lock path')
        with path.open('a') as handle:
            try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise Busy('Another backup, verification, export or recovery operation is running')
            try: yield
            finally: fcntl.flock(handle, fcntl.LOCK_UN)
    def busy(self):
        try:
            with self.lock(): return False
        except Busy: return True
    def command(self, tool, args, input=None):
        try:
            p = subprocess.run([str(self.tools / tool), *map(str,args)], input=input, text=True, capture_output=True, env=self.env, timeout=600)
        except (OSError,subprocess.TimeoutExpired): raise BackupError('PostgreSQL tool unavailable or timed out; check local services and PostgreSQL 15 tools')
        if p.returncode:
            if 'no space left' in p.stderr.lower():raise BackupError('Insufficient free disk space; existing valid backups were preserved')
            raise BackupError('PostgreSQL operation failed; connection and SQL details withheld')
        return p.stdout
    def sql_args(self, db): return ['-X','-qAt','-v','ON_ERROR_STOP=1','-d',db]
    def sql(self, db, query, snapshot=None):
        if snapshot:
            if not re.fullmatch('[A-Fa-f0-9-]+',snapshot): raise BackupError('Invalid snapshot')
            query = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '"+snapshot+"';"+query
        return self.command('psql',self.sql_args(db),query).strip()
    def json_sql(self, db, query, snapshot=None): return json.loads(self.sql(db,query,snapshot) or 'null')
    def check_database(self):
        db=self.sources[0]
        if self.sql(db,'SHOW data_directory;') != self.expected_data: raise BackupError('Database directory does not match the configured protected cluster')
        if int(self.sql(db,'SHOW server_version_num;')) // 10000 != 15: raise BackupError('PostgreSQL server major version must be 15')
        for tool in ['pg_dump','pg_restore','psql']:
            if not re.search(r'\b15\.',self.command(tool,['--version'])): raise BackupError('Matching PostgreSQL 15 tools are required')
    @contextlib.contextmanager
    def snapshot(self,db):
        try: process=subprocess.Popen([str(self.tools/'psql'),*self.sql_args(db)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,env=self.env)
        except OSError: raise BackupError('PostgreSQL snapshot could not start')
        try:
            process.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n');process.stdin.flush()
            if not select.select([process.stdout],[],[],15)[0]: raise BackupError('Snapshot connection timed out')
            snapshot=process.stdout.readline().strip()
            if not re.fullmatch('[A-Fa-f0-9-]+',snapshot): raise BackupError('Snapshot connection failed')
            yield snapshot
        finally:
            try:process.stdin.write('ROLLBACK;\n\\q\n');process.stdin.flush();process.communicate(timeout=10)
            except (BrokenPipeError,subprocess.TimeoutExpired):process.kill();process.wait()
    def inventory(self,db,snapshot=None):
        names=self.json_sql(db,"SELECT COALESCE(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='public';",snapshot)
        result={'tables':{},'sequences':{},'balances':[]}
        for table in names:
            name='"public".'+ident(table)
            statement=f'SELECT to_jsonb(t)::text FROM {name} t ORDER BY to_jsonb(t)::text COLLATE "C";'
            if snapshot:statement="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '"+snapshot+"';"+statement
            p=subprocess.Popen([str(self.tools/'psql'),*self.sql_args(db)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=self.env)
            p.stdin.write(statement.encode());p.stdin.close();h=hashlib.sha256();count=0
            for line in p.stdout:h.update(line);count+=1
            p.stdout.close()
            if p.wait():raise BackupError('Table fingerprint verification failed')
            result['tables'][name]={'rows':count,'sha256':h.hexdigest()}
        sequences=self.json_sql(db,"SELECT COALESCE(json_agg(sequencename ORDER BY sequencename),'[]'::json) FROM pg_sequences WHERE schemaname='public';",snapshot)
        for name in sequences:result['sequences']['"public".'+ident(name)]=None # Sequence state is not MVCC; pg_dump preserves its native value.
        if 'accounts' in names and 'transactions' in names:
            result['balances']=self.json_sql(db,"""SELECT COALESCE(json_agg(x ORDER BY id),'[]'::json) FROM (
                SELECT a.id::text,a.user_id::text,a.starting_balance::text,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type='INCOME'),0)::text AS income,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type='EXPENSE'),0)::text AS expenses,
                (a.starting_balance+COALESCE(SUM(t.amount) FILTER (WHERE t.type='INCOME'),0)-COALESCE(SUM(t.amount) FILTER (WHERE t.type='EXPENSE'),0))::text AS balance
                FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id AND t.user_id=a.user_id GROUP BY a.id,a.user_id,a.starting_balance) x;""",snapshot)
        return result
    def require_space(self,path,estimate=0):
        if shutil.disk_usage(path).free < max(256*1024*1024,estimate*2+64*1024*1024):raise BackupError('Insufficient free disk space; existing valid backups were preserved')
    def stage(self,text):
        op=read_json(self.managed/'operation.json',{})
        op.update(stage=text);write_json(self.managed/'operation.json',op)
    def add_history(self,row):
        rows=self.history();rows.append(row);write_json(self.managed/'history.json',rows)
    def safe_path(self,backup_id):
        if not isinstance(backup_id,str) or not re.fullmatch('[a-z0-9][a-z0-9-]{5,100}',backup_id):raise BackupError('Invalid backup identifier')
        parent=self.managed if backup_id.startswith('bkp-') else self.root
        path=parent/backup_id
        if path.is_symlink() or not path.is_dir() or path.resolve().parent!=parent.resolve():raise BackupError('Backup is unavailable or unsafe')
        return path
    def archive_files(self,path,manifest):
        files=['manifest.json']
        if (path/'manifest.sha256').exists():files.append('manifest.sha256')
        if manifest.get('formatVersion')==1 and set(manifest.get('archives',{}))!=set(self.sources):raise BackupError('Expected application databases are missing from managed backup')
        for db,archive in manifest.get('archives',{}).items():
            if db not in self.sources:raise BackupError('Archive contains an unexpected application database')
            filename=archive.get('file','')
            if filename!=db+'.dump':raise BackupError('Unsafe archive filename')
            files.append(filename)
        if self.sources[0] not in manifest.get('archives',{}):raise BackupError('Expected application database is missing')
        files.append('globals.sql')
        allowed={'postgresql.conf.copy','postgresql.auto.conf.copy','pg_hba.conf.copy','pg_ident.conf.copy','PG_VERSION.copy'}
        for name in manifest.get('config',{}):
            if name not in allowed:raise BackupError('Unsafe configuration filename')
            files.append(name)
        for filename in files:
            f=path/filename
            if f.is_symlink() or not f.is_file() or f.resolve().parent!=path.resolve():raise BackupError('Backup file is missing or unsafe')
        return files
    def validate(self,backup_id,decode=True):
        if decode and not re.search(r'\b15\.',self.command('pg_restore',['--version'])):raise BackupError('Matching PostgreSQL 15 restore tools are required')
        path=self.safe_path(backup_id);m=read_json(path/'manifest.json')
        self.archive_files(path,m)
        if (path/'manifest.sha256').exists() and (path/'manifest.sha256').read_text().strip()!=digest(path/'manifest.json'):raise BackupError('Manifest checksum mismatch')
        if digest(path/'globals.sql')!=m['globals_sha256']:raise BackupError('Global-role checksum mismatch')
        for name,sha in m.get('config',{}).items():
            if digest(path/name)!=sha:raise BackupError('Configuration copy checksum mismatch')
        for db,a in m['archives'].items():
            if digest(path/a['file'])!=a['sha256']:raise BackupError('Backup checksum mismatch; do not restore this archive')
            if decode:
                toc=self.command('pg_restore',['--list',path/a['file']])
                if not re.search(r'Dumped from database version: 15\.',toc) or not re.search(r'Dumped by pg_dump version: 15\.',toc):raise BackupError('Backup PostgreSQL compatibility check failed')
                self.command('pg_restore',['--file','/dev/null',path/a['file']])
            if db not in m.get('snapshots',{}):raise BackupError('Database verification metadata missing')
        return path,m
    def create(self,reason='manual'):
        self.check_database();estimate=sum(int(self.sql(d,'SELECT pg_database_size(current_database());')) for d in self.sources);self.require_space(self.managed,estimate)
        backup_id='bkp-'+self.now().strftime('%Y%m%d%H%M%S')+'-'+uuid.uuid4().hex[:12]
        partial=private_dir(self.managed/('.partial-'+backup_id));final=self.managed/backup_id
        m={'formatVersion':1,'createdAt':self.stamp(),'reason':reason,'serverMajor':15,'archives':{},'snapshots':{},'config':{},'encrypted':False}
        try:
            self.stage('Creating native PostgreSQL archives')
            self.command('pg_dumpall',['--globals-only','--file',partial/'globals.sql'])
            m['globals_sha256']=digest(partial/'globals.sql')
            for name in ['postgresql.conf','postgresql.auto.conf','pg_hba.conf','pg_ident.conf','PG_VERSION']:
                source=Path(self.expected_data)/name
                if source.is_file() and not source.is_symlink():
                    target=partial/(name+'.copy');shutil.copyfile(source,target);target.chmod(0o600);m['config'][target.name]=digest(target)
            for db in self.sources:
                with self.snapshot(db) as snap:
                    self.command('pg_dump',['--format=custom','--create','--snapshot',snap,'--file',partial/(db+'.dump'),db])
                    m['snapshots'][db]=self.inventory(db,snap)
                m['archives'][db]={'file':db+'.dump','sha256':digest(partial/(db+'.dump')),'bytes':(partial/(db+'.dump')).stat().st_size,'databaseBytes':int(self.sql(db,'SELECT pg_database_size(current_database());'))}
            write_json(partial/'manifest.json',m)
            (partial/'manifest.sha256').write_text(digest(partial/'manifest.json')+'\n')
            for f in partial.iterdir():f.chmod(0o600)
            # A crash before validation must not promote this directory to a successful backup.
            os.rename(partial,final)
            self.stage('Verifying checksums, archive decoding and PostgreSQL compatibility')
            self.validate(backup_id)
            row={'id':backup_id,'createdAt':m['createdAt'],'reason':reason,'verification':'archive_verified','verifiedAt':self.stamp(),'bytes':sum(a['bytes'] for a in m['archives'].values()),'encrypted':False}
            write_json(final/'verification.json',row);self.add_history(row)
            return backup_id
        except Exception:
            # Preserve failed partials for diagnosis. They are never successful history or retention candidates.
            raise
    def verify(self,backup_id):
        self.validate(backup_id)
        row={'id':backup_id,'createdAt':self.stamp(),'reason':'verification','verification':'archive_verified','verifiedAt':self.stamp()}
        self.add_history(row);return {'backupId':backup_id,'verification':'archive_verified'}
    def restore_test(self,backup_id,safety=True):
        self.check_database();path,m=self.validate(backup_id)
        if safety:self.create('safety')
        self.require_space(self.managed,sum(a.get('databaseBytes',a.get('bytes',0)*4) for a in m['archives'].values()))
        mapping={};self.stage('Restoring protected isolated copies; active databases stay unchanged')
        for db,a in m['archives'].items():
            target='finsight_backup_verify_'+uuid.uuid4().hex[:20]
            # A brand-new name, never an existing or active database, and never DROP/--clean.
            self.sql(self.sources[0],'CREATE DATABASE '+ident(target)+' TEMPLATE template0;')
            mapping[db]=target
            write_json(self.safe_path(backup_id)/'restore-copy-mapping.json',mapping) if backup_id.startswith('bkp-') else None
            self.command('pg_restore',['--exit-on-error','--no-owner','--no-privileges','--dbname',target,path/a['file']])
            actual=self.inventory(target);expected=m['snapshots'][db]
            if actual['tables']!=expected['tables'] or actual['balances']!=expected['balances'] or set(actual['sequences'])!=set(expected['sequences']):raise BackupError('Restored data does not match backup fingerprints, counts or exact balances')
            for name,state in expected['sequences'].items():
                if state is not None and self.sql(target,'SELECT last_value,is_called FROM '+name+';')!=state:raise BackupError('Legacy sequence verification failed')
        result={'backupId':backup_id,'verification':'restore_verified','restoredAt':self.stamp(),'copies':mapping,'activeReplacement':False}
        # Reports live in managed state, including for immutable legacy archives.
        write_json(self.managed/('restore-'+uuid.uuid4().hex+'.json'),result)
        self.add_history({'id':backup_id,'createdAt':self.stamp(),'reason':'restore-test','verification':'restore_verified','verifiedAt':self.stamp()})
        return {k:v for k,v in result.items() if k!='copies'}
    def list_backups(self):
        rows=[];events=self.history()
        for parent in [self.managed,self.root]:
            for path in sorted(parent.iterdir(),reverse=True):
                if path.name.startswith('.') or path.is_symlink() or not path.is_dir() or path==self.managed:continue
                try:
                    m=read_json(path/'manifest.json',{})
                    if not m.get('archives'):continue
                    event=next((e for e in reversed(events) if e.get('id')==path.name and e.get('verification') in ['archive_verified','restore_verified','failed']),{})
                    verified=read_json(path/'verification.json',{}) if parent==self.managed else {}
                    if event.get('verification')!='failed' and any(e.get('id')==path.name and e.get('verification')=='restore_verified' for e in events):event={**event,'verification':'restore_verified'}
                    match=re.search(r'(\d{8})T(\d{6})Z',path.name)
                    legacy_date=dt.datetime.strptime(''.join(match.groups()),'%Y%m%d%H%M%S').replace(tzinfo=UTC).isoformat() if match else 'Legacy creation date unavailable'
                    rows.append({'id':path.name,'createdAt':m.get('createdAt',m.get('created_at_utc',legacy_date)),'reason':m.get('reason','legacy-protected'),'verification':event.get('verification',verified.get('verification','not-verified-in-manager')),'verifiedAt':event.get('verifiedAt',verified.get('verifiedAt')),'legacy':parent==self.root,'bytes':sum(a.get('bytes',0) for a in m['archives'].values()),'encrypted':False})
                except (ValueError,OSError,BackupError):continue
        return rows
    def prune(self):
        rows=[]
        for row in self.list_backups():
            if row['legacy'] or row['verification'] not in ['archive_verified','restore_verified']:continue
            try:self.validate(row['id'],False);rows.append(row)
            except BackupError:continue
        keep=retention_keep(rows,self.config());newest=max((r['createdAt'] for r in rows),default='')
        for row in rows:
            if row['id'] in keep or row['createdAt']>=newest:continue
            path=self.safe_path(row['id'])
            if any(f.is_symlink() or not f.is_file() for f in path.iterdir()):continue
            # Only managed directories that passed integrity checks; migration/safety/last-valid copies stay protected.
            shutil.rmtree(path)
            self.add_history({'id':row['id'],'createdAt':self.stamp(),'reason':'retention','verification':'retired'})
    def save_config(self,input):
        if set(input)-set(DEFAULTS):raise BackupError('Unknown backup setting')
        current=self.config()
        if type(input.get('version')) is not int or input.get('version')!=current['version']:raise BackupError('Settings changed; reload before saving')
        c={**current,**input}
        if type(c['enabled']) is not bool or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d',str(c['time'])):raise BackupError('Choose a valid backup time')
        try:ZoneInfo(c['timeZone'])
        except Exception:raise BackupError('Choose a valid local time zone')
        for field in ['daily','weekly','monthly','restoreEveryDays','externalOverdueDays']:
            if type(c[field]) is not int or not 1<=c[field]<=365:raise BackupError('Retention and intervals must be integers from 1 through 365')
        external=c['externalDirectory']
        if not isinstance(external,str) or len(external)>500 or (external and not Path(external).is_absolute()):raise BackupError('Choose an absolute external destination directory')
        if external and not self.test and (not external.startswith('/Volumes/') or len(Path(external).parts)<4):raise BackupError('External destination must be an existing directory on a mounted /Volumes drive')
        c['version']+=1;write_json(self.managed/'settings.json',c);return c
    def scheduled_slot(self,date):
        c=self.config();zone=ZoneInfo(c['timeZone']);h,m=map(int,c['time'].split(':'))
        # First fold on fall-back days; nonexistent spring times roll forward through the DST gap.
        return dt.datetime.combine(date,dt.time(h,m),tzinfo=zone).astimezone(UTC).astimezone(zone)
    def due_time(self):
        now=self.now().astimezone(ZoneInfo(self.config()['timeZone']))
        due=self.scheduled_slot(now.date())
        if due.astimezone(UTC)>now.astimezone(UTC):due=self.scheduled_slot(now.date()-dt.timedelta(days=1))
        return due
    def tick(self):
        c=self.config()
        if not c['enabled']:return {'scheduled':False,'reason':'disabled'}
        successful=[r for r in self.list_backups() if not r['legacy'] and r['verification'] in ['archive_verified','restore_verified']]
        last=max((dt.datetime.fromisoformat(r['createdAt']) for r in successful),default=dt.datetime.min.replace(tzinfo=UTC))
        if last>=self.due_time():return {'scheduled':False,'reason':'already-covered'}
        failures=[r for r in self.history() if r.get('verification')=='failed' and r.get('reason') in ['tick','backup']]
        if failures and self.now()-dt.datetime.fromisoformat(failures[-1]['createdAt'])<dt.timedelta(minutes=15):return {'scheduled':False,'reason':'retry-delay'}
        backup=self.create('scheduled');self.prune()
        restores=[r for r in self.history() if r.get('verification')=='restore_verified']
        if not restores or self.now()-dt.datetime.fromisoformat(restores[-1]['verifiedAt'])>=dt.timedelta(days=c['restoreEveryDays']):self.restore_test(backup,False)
        if self.external_state()['available']:self.copy_external(backup)
        return {'scheduled':True,'backupId':backup}
    def external_state(self):
        c=self.config();value=c['externalDirectory'];available=False
        if value:
            path=Path(value)
            if self.test:available=path.is_dir() and not path.is_symlink()
            elif str(path).startswith('/Volumes/'):
                mount=Path('/Volumes')/path.parts[2]
                available=mount.is_mount() and path.is_dir() and not path.is_symlink() and path.resolve().is_relative_to(mount.resolve())
                if available:
                    try:
                        info=subprocess.run(['/usr/sbin/diskutil','info','-plist',str(mount)],capture_output=True,timeout=5)
                        available=info.returncode==0 and local_external_volume(plistlib.loads(info.stdout))
                    except (OSError,ValueError,subprocess.TimeoutExpired):available=False
        copies=[r for r in self.history() if r.get('verification')=='external_verified' and r.get('directory')==value]
        last=copies[-1]['createdAt'] if copies else None
        return {'directory':value,'available':available,'lastSuccessfulCopy':last,'overdue':bool(value and (not last or self.now()-dt.datetime.fromisoformat(last)>dt.timedelta(days=c['externalOverdueDays'])))}
    def copy_external(self,backup_id=None):
        if not self.external_state()['available']:raise BackupError('External destination is disconnected or unavailable; local backups are unaffected')
        destination=Path(self.config()['externalDirectory']);device=destination.stat().st_dev
        root=private_dir(destination/'FinSight AI Backups')
        ids=[backup_id] if backup_id else [r['id'] for r in self.list_backups() if r['verification'] in ['archive_verified','restore_verified']]
        if not ids:raise BackupError('Create a verified local backup first')
        for backup_id in ids:
            path,m=self.validate(backup_id);files=self.archive_files(path,m)
            self.require_space(root,sum((path/f).stat().st_size for f in files));target=root/backup_id
            if target.is_symlink():raise BackupError('Unsafe external backup path')
            if target.exists():
                if any((target/f).is_symlink() or not (target/f).is_file() or digest(target/f)!=digest(path/f) for f in files):raise BackupError('Existing external copy differs; no files were overwritten')
                continue
            partial=private_dir(root/('.partial-'+uuid.uuid4().hex))
            for name in files:
                if not self.external_state()['available'] or destination.stat().st_dev!=device:raise BackupError('External drive disconnected while copying; local backup preserved')
                shutil.copyfile(path/name,partial/name);(partial/name).chmod(0o600)
                if digest(partial/name)!=digest(path/name):raise BackupError('External copy checksum mismatch')
            if not self.external_state()['available'] or destination.stat().st_dev!=device:raise BackupError('External drive disconnected before final verification')
            os.rename(partial,target)
        self.add_history({'id':backup_id or 'external-copy','createdAt':self.stamp(),'reason':'external-copy','verification':'external_verified','directory':str(destination)})
        return {'externalVerified':True,'copied':len(ids)}
    def export(self,format,user_id=USER_ID):
        try:user_id=str(uuid.UUID(user_id))
        except (ValueError,TypeError,AttributeError):raise BackupError('Invalid export owner')
        if format not in ['json','csv']:raise BackupError('Choose JSON or CSV')
        self.check_database();self.require_space(self.exports)
        tables=['accounts','transactions','categories','recurring_rules','recurring_occurrences','planned_transactions','forecast_preferences']
        values={}
        savings_tables=['savings_goals','savings_entries','savings_corrections','savings_schedules']
        with self.snapshot(self.sources[0]) as snap:
            savings_available=self.sql(self.sources[0],"SELECT to_regclass('public.savings_goals') IS NOT NULL;",snap)=='t'
            if savings_available:tables+=savings_tables
            for table in tables:
                # Owner selected by server, never an input. Decimal JSON values stay strings in exports.
                text=self.sql(self.sources[0],f"SELECT COALESCE(json_agg(t ORDER BY to_jsonb(t)::text),'[]'::json) FROM (SELECT * FROM {ident(table)} WHERE user_id='{user_id}') t;",snap)
                values[table]=json.loads(text,parse_float=str)
        export_id='export-'+uuid.uuid4().hex;ext='json' if format=='json' else 'zip';path=self.exports/(export_id+'.'+ext)
        if format=='json':write_json(path,{'formatVersion':1,'createdAt':self.stamp(),'decimalEncoding':'strings','savingsDataAvailable':savings_available,'data':values,'notice':'Data export is not a full PostgreSQL backup.'})
        else:
            with zipfile.ZipFile(path,'x',compression=zipfile.ZIP_DEFLATED) as archive:
                for table,rows in values.items():
                    fields=list(rows[0]) if rows else ['no_records'];out=io.StringIO(newline='');writer=csv.DictWriter(out,fieldnames=fields);writer.writeheader()
                    for row in rows:
                        safe={k:("'"+v if k in ['description','name','display_name','note','reason'] and isinstance(v,str) and v.startswith(('=','+','-','@','\t','\r')) else v) for k,v in row.items()};writer.writerow(safe)
                    archive.writestr(table+'.csv',out.getvalue())
                archive.writestr('README.txt','CSV exports are not PostgreSQL backups. Monetary decimals are exact. Spreadsheet formula-like text is prefixed with an apostrophe. Savings allocations, when present, are separate from cash transactions.\n')
            path.chmod(0o600)
        write_json(self.exports/(export_id+'.owner.json'),{'userId':user_id})
        result={'exportId':export_id+'.'+ext,'bytes':path.stat().st_size,'format':format,'userId':user_id}
        self.add_history({'id':result['exportId'],'createdAt':self.stamp(),'reason':'export','verification':'export_prepared',**result})
        return result
    def status(self):
        c=self.config();now=self.now();due=self.due_time();rows=self.list_backups();good=[r for r in rows if not r['legacy'] and r['verification'] in ['archive_verified','restore_verified']]
        last=max((r['createdAt'] for r in good),default=None);covered=last and dt.datetime.fromisoformat(last)>=due
        next_due=self.scheduled_slot(due.date()+dt.timedelta(days=1)) if covered else due
        op=read_json(self.managed/'operation.json',{'state':'idle'})
        busy=self.busy()
        if op.get('state')=='running' and not busy:op={**op,'state':'interrupted','stage':'Previous operation stopped unexpectedly; no success assumed'}
        agent=Path.home()/'Library/LaunchAgents/com.finsight.local-backups.plist'
        installed=False
        if not self.test and agent.is_file() and sys.platform=='darwin':
            try:installed=subprocess.run(['/bin/launchctl','print',f'gui/{os.getuid()}/com.finsight.local-backups'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3).returncode==0
            except (OSError,subprocess.TimeoutExpired):pass
        exported=next((r for r in reversed(self.history()) if r.get('verification')=='export_prepared' and (self.exports/r['exportId']).is_file()),None)
        return {'lastExport':exported,'settings':c,'directory':str(self.managed),'freeBytes':shutil.disk_usage(self.managed).free,'lastSuccessfulBackup':last,'nextScheduledBackup':next_due.isoformat() if c['enabled'] else None,'missedBackup':bool(c['enabled'] and not covered),'busy':busy,'operation':op,'backups':rows,'history':self.history()[-100:][::-1],'external':self.external_state(),'liveRestoreAvailable':False,'encrypted':False,'launchdInstalled':installed}
    def run(self,action,payload):
        if action=='status':return self.status()
        with self.lock():
            if action=='settings':return self.save_config(payload)
            write_json(self.managed/'operation.json',{'id':uuid.uuid4().hex,'state':'running','action':action,'stage':'Starting local operation','startedAt':self.stamp()})
            try:
                if action=='backup':result={'backupId':self.create()};self.prune()
                elif action=='tick':result=self.tick()
                elif action=='verify':result=self.verify(payload.get('backupId'))
                elif action=='restore':
                    if payload.get('confirmed') is not True:raise BackupError('Explicit confirmation is required for isolated restore verification')
                    result=self.restore_test(payload.get('backupId'))
                elif action=='external':result=self.copy_external()
                elif action=='export':result=self.export(payload.get('format'),payload.get('userId',USER_ID))
                else:raise BackupError('Unknown maintenance operation')
                op=read_json(self.managed/'operation.json');op.update(state='succeeded',stage='Operation completed',finishedAt=self.stamp(),result=result);write_json(self.managed/'operation.json',op)
                return result
            except Exception as error:
                message=str(error) if isinstance(error,BackupError) else 'Insufficient free disk space; existing valid backups were preserved' if isinstance(error,OSError) and error.errno==28 else 'Local operation failed; financial and connection details withheld'
                op=read_json(self.managed/'operation.json',{});op.update(state='failed',stage=message,finishedAt=self.stamp())
                try:
                    write_json(self.managed/'operation.json',op)
                    self.add_history({'id':payload.get('backupId',op.get('id','interrupted')),'createdAt':self.stamp(),'reason':action,'verification':'failed','message':message})
                except OSError:pass
                raise BackupError(message)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['status','settings','backup','tick','verify','restore','external','export']);args=parser.parse_args()
    try:
        payload=json.loads(sys.stdin.read() or '{}');result=Manager().run(args.action,payload);print(json.dumps(result))
    except Busy as error:print(json.dumps({'error':str(error),'busy':True}));sys.exit(2)
    except Exception as error:print(json.dumps({'error':str(error) if isinstance(error,BackupError) else 'Maintenance operation failed; details withheld'}));sys.exit(1)
if __name__=='__main__':main()
