import contextlib
import datetime as dt
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backup_manager import Manager, BackupError, Busy, DEFAULTS, digest, write_json, retention_keep, local_external_volume

class FakeManager(Manager):
    def check_database(self): pass
    def sql(self,db,query,snapshot=None):
        if 'pg_database_size' in query:return '1000'
        return ''
    @contextlib.contextmanager
    def snapshot(self,db):yield '0001-0001-1'
    def inventory(self,db,snapshot=None):return {'tables':{},'sequences':{},'balances':[]}
    def command(self,tool,args,input=None):
        if '--version' in args:return 'PostgreSQL 15.17'
        if tool=='pg_dumpall':Path(args[-1]).write_text('globals')
        if tool=='pg_dump':Path(args[args.index('--file')+1]).write_text('synthetic archive')
        if tool=='pg_restore' and '--list' in args:return 'Dumped from database version: 15.17\nDumped by pg_dump version: 15.17'
        return ''

class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='finsight-backup-unit-',dir='/tmp');self.base=Path(self.tmp.name)
        self.env=patch.dict(os.environ,{'FINSIGHT_DATA_HOME':str(self.base),'FINSIGHT_BACKUP_TEST_MODE':'true','FINSIGHT_BACKUP_EXPECTED_DATA':'/tmp/finsight-isolated-verification-unit/postgres','FINSIGHT_BACKUP_DATABASES':'finsight_verification','PGHOST':'127.0.0.1','PGPORT':'55434'},clear=False);self.env.start()
        self.now=dt.datetime(2026,10,30,12,tzinfo=dt.timezone.utc);self.m=FakeManager(self.now)
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def backup(self):return self.m.run('backup',{})['backupId']
    def test_manual_backup_decodes_verifies_and_records_history(self):
        id=self.backup();self.assertEqual(self.m.list_backups()[0]['verification'],'archive_verified');self.assertEqual(self.m.status()['operation']['state'],'succeeded');self.assertTrue((self.m.safe_path(id)/'manifest.sha256').exists())
    def test_scheduled_and_missed_slots_run_once(self):
        self.assertTrue(self.m.status()['missedBackup']);self.assertTrue(self.m.run('tick',{})['scheduled']);self.assertFalse(self.m.run('tick',{})['scheduled']);self.m.now_override+=dt.timedelta(days=3);self.assertTrue(self.m.run('tick',{})['scheduled']);self.assertEqual(len([r for r in self.m.list_backups() if r['reason']=='scheduled']),2)
    def test_before_today_schedule_covers_previous_slot(self):
        c=self.m.config();c['time']='23:00';self.m.run('settings',c);self.backup();self.assertFalse(self.m.run('tick',{})['scheduled'])
    def test_spring_dst_missing_time_runs_once_at_rolled_forward_slot(self):
        self.m.now_override=dt.datetime(2026,3,8,7,0,tzinfo=dt.timezone.utc)
        self.assertEqual(self.m.due_time().hour,3);self.assertTrue(self.m.run('tick',{})['scheduled']);self.assertFalse(self.m.run('tick',{})['scheduled'])
        self.assertIn('T02:00:00',self.m.status()['nextScheduledBackup'])
    def test_fall_dst_repeated_hour_does_not_duplicate_daily_job(self):
        c=self.m.config();c['time']='01:30';self.m.run('settings',c)
        self.m.now_override=dt.datetime(2026,11,1,5,30,tzinfo=dt.timezone.utc);self.assertTrue(self.m.run('tick',{})['scheduled'])
        self.m.now_override=dt.datetime(2026,11,1,6,30,tzinfo=dt.timezone.utc);self.assertFalse(self.m.run('tick',{})['scheduled'])
    def test_disabled_schedule_does_not_create_backup(self):
        c=self.m.config();c['enabled']=False;self.m.run('settings',c);self.assertFalse(self.m.run('tick',{})['scheduled']);self.assertEqual(self.m.list_backups(),[])
    def test_process_lock_prevents_overlap(self):
        with self.m.lock():
            self.assertTrue(self.m.status()['busy'])
            with self.assertRaises(Busy):self.backup()
    def test_corrupted_archive_is_not_accepted(self):
        id=self.backup();(self.m.safe_path(id)/'finsight_verification.dump').write_text('corrupt')
        with self.assertRaisesRegex(BackupError,'checksum'):self.m.run('verify',{'backupId':id})
        self.assertEqual(self.m.list_backups()[0]['verification'],'failed')
    def test_archive_verification_remains_available_when_database_is_offline(self):
        id=self.backup()
        with patch.object(self.m,'check_database',side_effect=BackupError('Database offline')):
            self.assertEqual(self.m.run('verify',{'backupId':id})['verification'],'archive_verified')
    def test_manifest_corruption_is_detected(self):
        id=self.backup();p=self.m.safe_path(id)/'manifest.json';p.write_text(p.read_text()+' ')
        with self.assertRaisesRegex(BackupError,'Manifest checksum'):self.m.validate(id)
    def test_insufficient_disk_preserves_valid_backup(self):
        id=self.backup()
        with patch('backup_manager.shutil.disk_usage',return_value=type('Disk',(),{'free':0})()):
            with self.assertRaisesRegex(BackupError,'disk space'):self.backup()
        self.assertTrue(self.m.safe_path(id).exists());self.assertEqual(self.m.status()['operation']['state'],'failed')
    def test_failed_dump_is_recorded_and_never_successful(self):
        with patch.object(self.m,'command',side_effect=BackupError('Synthetic tool failure')):
            with self.assertRaises(BackupError):self.backup()
        self.assertFalse(self.m.list_backups());self.assertEqual(self.m.history()[-1]['verification'],'failed')
    def test_restore_requires_confirmation_and_creates_safety_copy(self):
        id=self.backup()
        with self.assertRaises(BackupError):self.m.run('restore',{'backupId':id})
        result=self.m.run('restore',{'backupId':id,'confirmed':True});self.assertFalse(result['activeReplacement']);self.assertEqual(result['verification'],'restore_verified');self.assertTrue(any(r['reason']=='safety' for r in self.m.list_backups()))
    def test_failed_restore_does_not_replace_any_active_database(self):
        id=self.backup()
        with patch.object(self.m,'inventory',return_value={'tables':{'different':{}},'sequences':{},'balances':[]}):
            with self.assertRaisesRegex(BackupError,'Restored data'):self.m.run('restore',{'backupId':id,'confirmed':True})
        self.assertTrue(self.m.safe_path(id).exists())
    def test_restore_compatibility_rejects_wrong_major(self):
        id=self.backup();original=self.m.command
        with patch.object(self.m,'command',side_effect=lambda tool,args,input=None:'Dumped from database version: 16.0' if '--list' in args else original(tool,args,input)):
            with self.assertRaisesRegex(BackupError,'compatibility'):self.m.validate(id)
    def test_unsafe_identifiers_and_symlinks_are_refused(self):
        for value in ['../postgres','/tmp/financial','--file','x']:
            with self.assertRaises(BackupError):self.m.safe_path(value)
        id=self.backup();f=self.m.safe_path(id)/'globals.sql';f.unlink();f.symlink_to('/etc/hosts')
        with self.assertRaisesRegex(BackupError,'unsafe'):self.m.validate(id)
    def test_retention_keeps_periods_safety_and_last_valid(self):
        rows=[{'id':str(i),'createdAt':(self.now-dt.timedelta(days=i*10)).isoformat(),'reason':'scheduled'} for i in range(20)];rows[-1]['reason']='safety'
        keep=retention_keep(rows,dict(DEFAULTS,daily=1,weekly=1,monthly=1));self.assertIn('0',keep);self.assertIn('19',keep);self.assertEqual(keep,{'0','19'})
    def test_retention_preserves_recent_manual_versions_within_one_day(self):
        rows=[{'id':str(i),'createdAt':(self.now-dt.timedelta(minutes=i)).isoformat(),'reason':'manual'} for i in range(10)]
        keep=retention_keep(rows,dict(DEFAULTS,daily=7,weekly=1,monthly=1));self.assertTrue(set(map(str,range(7))).issubset(keep))
    def test_retention_keeps_latest_full_restore_proof_until_newer_proof_exists(self):
        rows=[{'id':str(i),'createdAt':(self.now-dt.timedelta(days=i*10)).isoformat(),'reason':'scheduled','verification':'restore_verified' if i==10 else 'archive_verified'} for i in range(20)]
        keep=retention_keep(rows,dict(DEFAULTS,daily=1,weekly=1,monthly=1));self.assertIn('10',keep);self.assertIn('0',keep)
    def test_retention_never_touches_legacy_or_safety(self):
        id=self.m.create('safety');legacy=self.m.root/'migration-protected';legacy.mkdir();(legacy/'important').write_text('do not delete');self.m.prune();self.assertTrue(legacy.exists());self.assertTrue(self.m.safe_path(id).exists())
    def test_external_volume_must_be_local_external_hardware_not_network_or_disk_image(self):
        usb={'DeviceNode':'/dev/disk5s1','Internal':False,'BusProtocol':'USB'}
        self.assertTrue(local_external_volume(usb))
        for value in [{**usb,'Internal':True},{**usb,'BusProtocol':'SMB'},{**usb,'BusProtocol':'Disk Image'},{**usb,'DeviceNode':'//remote/share'}]:self.assertFalse(local_external_volume(value))
    def test_external_disconnect_does_not_affect_local_backup(self):
        id=self.backup();c=self.m.config();c['externalDirectory']=str(self.base/'disconnected');self.m.run('settings',c)
        self.assertFalse(self.m.external_state()['available']);self.assertTrue(self.m.external_state()['overdue'])
        with self.assertRaisesRegex(BackupError,'disconnected'):self.m.run('external',{})
        self.m.validate(id)
    def test_external_copy_checksums_and_disconnect_during_copy(self):
        id=self.backup();drive=self.base/'ssd';drive.mkdir();c=self.m.config();c['externalDirectory']=str(drive);self.m.run('settings',c);self.m.run('external',{})
        self.assertEqual(digest(drive/'FinSight AI Backups'/id/'globals.sql'),digest(self.m.safe_path(id)/'globals.sql'));self.assertIsNotNone(self.m.external_state()['lastSuccessfulCopy']);self.m.validate(id)
    def test_disconnection_mid_copy_is_failure(self):
        self.backup();drive=self.base/'ssd';drive.mkdir();c=self.m.config();c['externalDirectory']=str(drive);self.m.run('settings',c)
        with patch.object(self.m,'external_state',side_effect=[{'available':True},{'available':False}]):
            with self.assertRaisesRegex(BackupError,'disconnected'):self.m.copy_external()
        self.assertEqual(len(self.m.list_backups()),1)
    def test_settings_validation_version_and_history(self):
        c=self.m.config();saved=self.m.run('settings',c);self.assertEqual(saved['version'],1)
        with self.assertRaisesRegex(BackupError,'changed'):self.m.run('settings',c)
        saved['time']='99:00'
        with self.assertRaisesRegex(BackupError,'valid backup time'):self.m.run('settings',saved)
    def test_permissions_are_owner_only(self):
        id=self.backup();self.assertEqual(self.m.managed.stat().st_mode&0o777,0o700)
        for f in self.m.safe_path(id).iterdir():self.assertEqual(f.stat().st_mode&0o777,0o600)
    def test_no_password_or_financial_rows_in_operation_status(self):
        secret='DO-NOT-LOG-SECRET'
        with patch.object(self.m,'command',side_effect=ValueError(secret)):
            with self.assertRaises(BackupError):self.backup()
        self.assertNotIn(secret,json.dumps(self.m.status()))
    def test_exports_json_and_csv_exact_money_and_formula_safety(self):
        def query(db,sql,snapshot=None):return '[{"id":"synthetic","description":"=formula","amount":0.10,"transaction_date":"2026-10-30"}]'
        with patch.object(self.m,'sql',side_effect=query):
            j=self.m.run('export',{'format':'json'});c=self.m.run('export',{'format':'csv'})
        data=json.loads((self.m.exports/j['exportId']).read_text());self.assertEqual(data['data']['transactions'][0]['amount'],'0.10');self.assertFalse(data['savingsDataAvailable'])
        import zipfile
        with zipfile.ZipFile(self.m.exports/c['exportId']) as archive:self.assertIn("'=formula",archive.read('transactions.csv').decode());self.assertIn('0.10',archive.read('transactions.csv').decode())
        self.m.run('tick',{});self.assertEqual(self.m.status()['lastExport']['exportId'],c['exportId'])
    def test_savings_exports_include_allocation_audit_and_safe_notes(self):
        def query(db,sql,snapshot=None):
            if 'to_regclass' in sql:return 't'
            return '[{"id":"synthetic","note":"=unsafe","reason":"+reason","target_amount":5000.00,"amount":0.10}]'
        with patch.object(self.m,'sql',side_effect=query):
            result=self.m.run('export',{'format':'json'});csv=self.m.run('export',{'format':'csv'})
        data=json.loads((self.m.exports/result['exportId']).read_text())
        self.assertTrue(data['savingsDataAvailable'])
        for table in ['savings_goals','savings_entries','savings_corrections','savings_schedules']:
            self.assertIn(table,data['data']);self.assertEqual(data['data'][table][0]['amount'],'0.10')
        import zipfile
        with zipfile.ZipFile(self.m.exports/csv['exportId']) as archive:
            self.assertIn("'=unsafe",archive.read('savings_entries.csv').decode())
            self.assertIn("'+reason",archive.read('savings_corrections.csv').decode())
    def test_failure_retry_is_throttled(self):
        with patch.object(self.m,'command',side_effect=BackupError('Service unavailable')):
            with self.assertRaises(BackupError):self.m.run('tick',{})
        self.assertEqual(self.m.run('tick',{})['reason'],'retry-delay')
if __name__=='__main__':unittest.main()
