#!/usr/bin/env python3
"""Authorized V7 upgrade with quiescence, full native backup/restore and private preservation proof."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from backup_manager import Manager,write_json,digest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from desktop.supervisor import load_env,expected_migrations

def fingerprint(manager,db,query):
    # Never emit rows, digests, balances, credentials or hashes to stdout/logs.
    return hashlib.sha256(manager.sql(db,query).encode()).hexdigest()

def inventory(manager,db):
    value=manager.inventory(db)
    for sequence in value['sequences']:
        value['sequences'][sequence]=manager.sql(db,'SELECT last_value,is_called FROM '+sequence+';')
    return value

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--confirmed',action='store_true')
    parser.add_argument('--jar',type=Path,default=ROOT/'backend/target/finsight-api-0.1.0.jar')
    parser.add_argument('--java-home',type=Path,default=ROOT/'desktop/build/FinSight AI.app/Contents/Resources/java')
    args=parser.parse_args()
    if not args.confirmed:raise SystemExit('Explicit authorization and --confirmed are required. Quit FinSight first.')
    manager=Manager()
    if manager.test:raise SystemExit('This narrowly scoped upgrade targets only the preserved personal cluster.')
    manager.check_database()
    migrations=expected_migrations(args.jar)
    if set(migrations)!=set('1234567'):raise SystemExit('The reviewed V1–V7 build is required.')
    configuration=load_env(manager.base/'backend.env')
    with manager.lock():
        history=manager.json_sql('finsight_demo',"SELECT json_agg(t ORDER BY version) FROM (SELECT version,checksum,success FROM flyway_schema_history) t;")
        if {row['version'] for row in history}!=set('123456') or any(not row['success'] or migrations[row['version']]!=row['checksum'] for row in history):
            raise SystemExit('Expected unchanged applied V1–V6 history; upgrade refused.')
        clients=manager.sql('finsight_demo',"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';")
        if clients!='0':raise SystemExit('Quit FinSight and drain its backend before upgrading. No migration applied.')
        valid=manager.sql('finsight_demo',"SELECT (SELECT count(*) FROM users)=1 AND (SELECT count(*) FROM accounts)=1 AND EXISTS(SELECT 1 FROM accounts WHERE id='00000000-0000-0000-0000-000000000002' AND user_id='00000000-0000-0000-0000-000000000001');")
        if valid!='t':raise SystemExit('Ownership preflight changed; review required before migration.')
        dbs=manager.json_sql('finsight_demo',"SELECT json_agg(datname ORDER BY datname) FROM pg_database WHERE NOT datistemplate;")
        before={db:inventory(manager,db) for db in dbs}
        user_query="SELECT (to_jsonb(t)-'username'-'credential_version')::text FROM users t ORDER BY id;"
        history_query="SELECT to_jsonb(t)::text FROM flyway_schema_history t WHERE version IS NULL OR version<='6' ORDER BY installed_rank;"
        original_user=fingerprint(manager,'finsight_demo',user_query)
        original_history=fingerprint(manager,'finsight_demo',history_query)
        protected_files=[Path(manager.expected_data)/name for name in ['postgresql.conf','postgresql.auto.conf','pg_hba.conf','pg_ident.conf','PG_VERSION']]
        protected_files.append(Path.home()/'Library/LaunchAgents/com.finsight.local-backups.plist')
        files={str(path):digest(path) for path in protected_files if path.is_file()}
        backup=manager.create('safety')
        manager.restore_test(backup,safety=False)
        path=manager.safe_path(backup)
        write_json(path/'phase6b-before.json',{'databases':before,'files':files,'userProjection':original_user,'priorFlyway':original_history})
        # Run the exact packaged migrations without starting application writers.
        with tempfile.TemporaryDirectory(prefix='finsight-auth-migration-',dir='/tmp') as directory:
            temp=Path(directory);(temp/'lib').mkdir();(temp/'classes').mkdir()
            with zipfile.ZipFile(args.jar) as jar:
                for name in jar.namelist():
                    if name.startswith('BOOT-INF/lib/') and name.endswith('.jar'):
                        (temp/'lib'/Path(name).name).write_bytes(jar.read(name))
                    elif name.startswith('BOOT-INF/classes/db/migration/') and name.endswith('.sql'):
                        target=temp/'classes'/name.removeprefix('BOOT-INF/classes/');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(jar.read(name))
            with (path/'phase6b-flyway.log').open('w') as log:
                result=subprocess.run([str(args.java_home/'bin/java'),'--class-path',str(temp/'lib/*')+os.pathsep+str(temp/'classes'),str(ROOT/'scripts/AuthenticationMigration.java')],env=dict(os.environ,**configuration),stdout=log,stderr=subprocess.STDOUT)
            if result.returncode:raise SystemExit('Migration command failed; inspect its private backup log. No recovery/reset was attempted.')
        after={db:inventory(manager,db) for db in dbs}
        for db in dbs:
            expected=before[db];actual=after[db]
            if db=='finsight_demo':
                for table in ['"public"."users"','"public"."flyway_schema_history"']:
                    expected={**expected,'tables':{k:v for k,v in expected['tables'].items() if k!=table}}
                    actual={**actual,'tables':{k:v for k,v in actual['tables'].items() if k!=table}}
            if expected!=actual:raise SystemExit('Preservation comparison failed; keep services stopped and inspect private evidence.')
        if fingerprint(manager,'finsight_demo',user_query)!=original_user or fingerprint(manager,'finsight_demo',history_query)!=original_history:
            raise SystemExit('Original user or applied migration history changed; keep services stopped.')
        if any(digest(Path(name))!=checksum for name,checksum in files.items()):raise SystemExit('Protected configuration changed; keep services stopped.')
        if (Path('/tmp/finsight-pgdata')/'postmaster.pid').exists():raise SystemExit('Original stopped cluster unexpectedly running; inspect locally.')
        write_json(path/'phase6b-after.json',{'databases':after,'allExistingFinancialRowsPreserved':True,'userProjectionPreserved':True,'priorFlywayPreserved':True,'sequencesAndBalancesPreserved':True,'configurationAndLaunchAgentPreserved':True,'originalClusterStopped':True,'migration':'7'})
        write_json(manager.root/'phase6b-upgrade-result.json',{'backupId':backup,'restoreVerified':True,'migration':'7','preservationVerified':True})
        print('PASS: V7 applied after full native backup and protected restore verification; all original financial rows, owners, balances, sequences, prior migrations, other databases and protected configuration preserved.')

if __name__=='__main__':main()
