"""Opt-in native integration: existing isolated cluster only. No personal database accepted."""
import datetime as dt
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backup_manager import Manager, BackupError

@unittest.skipUnless(os.getenv('FINSIGHT_BACKUP_INTEGRATION')=='1','Requires the existing isolated native PostgreSQL fixture')
class NativePostgresBackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='finsight-backup-native-',dir='/tmp')
        self.override=patch.dict(os.environ,{'FINSIGHT_DATA_HOME':self.tmp.name});self.override.start();self.m=Manager()
        self.assertTrue(self.m.test);self.assertEqual(self.m.sources,['finsight_2e_browser']);self.m.check_database()
        self.before=self.m.inventory(self.m.sources[0])
    def tearDown(self):
        self.assertEqual(self.m.inventory(self.m.sources[0]),self.before)
        self.override.stop();self.tmp.cleanup()
    def test_real_manual_backup_and_isolated_restore_preserve_all_records_and_balances(self):
        id=self.m.run('backup',{})['backupId'];p,m=self.m.validate(id)
        self.assertEqual(m['snapshots'][self.m.sources[0]],self.before)
        result=self.m.run('restore',{'backupId':id,'confirmed':True});self.assertEqual(result['verification'],'restore_verified');self.assertFalse(result['activeReplacement']);self.assertTrue(any(r['reason']=='safety' for r in self.m.list_backups()))
    def test_snapshot_metadata_matches_dump_even_when_source_changes_after_dump(self):
        db=self.m.sources[0];inserted=uuid.uuid4();original=self.m.command;changed=[False]
        category=self.m.sql(db,"SELECT id FROM categories WHERE name='Groceries' AND user_id='00000000-0000-0000-0000-000000000001';")
        def command(tool,args,input=None):
            result=original(tool,args,input)
            if tool=='pg_dump' and not changed[0]:
                changed[0]=True;self.m.sql(db,f"INSERT INTO transactions(id,user_id,account_id,category_id,description,amount,type,transaction_date) VALUES ('{inserted}','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','{category}','Synthetic concurrent backup fixture',1.23,'EXPENSE',DATE '2026-10-30');")
            return result
        try:
            with patch.object(self.m,'command',side_effect=command):id=self.m.run('backup',{})['backupId']
            self.assertNotEqual(self.m.inventory(db),self.before)
            result=self.m.restore_test(id,False);self.assertEqual(result['verification'],'restore_verified')
        finally:self.m.sql(db,f"DELETE FROM transactions WHERE id='{inserted}';")
    def test_native_archive_corruption_is_detected_without_restoring(self):
        id=self.m.run('backup',{})['backupId'];path=self.m.safe_path(id)/(self.m.sources[0]+'.dump')
        with path.open('ab') as f:f.write(b'corruption')
        with self.assertRaisesRegex(BackupError,'checksum'):self.m.run('verify',{'backupId':id})
    def test_failed_restore_preserves_source_and_verified_safety_backup(self):
        id=self.m.run('backup',{})['backupId'];original=self.m.command
        def command(tool,args,input=None):
            if tool=='pg_restore' and '--dbname' in args:raise BackupError('Synthetic restore failure')
            return original(tool,args,input)
        with patch.object(self.m,'command',side_effect=command):
            with self.assertRaisesRegex(BackupError,'restore failure'):self.m.run('restore',{'backupId':id,'confirmed':True})
        self.assertTrue(any(r['reason']=='safety' for r in self.m.list_backups()))
    def test_native_exports_and_external_checksums(self):
        id=self.m.run('backup',{})['backupId'];ssd=Path(self.tmp.name)/'synthetic-ssd';ssd.mkdir();c=self.m.config();c['externalDirectory']=str(ssd);self.m.run('settings',c)
        self.assertTrue(self.m.run('external',{})['externalVerified']);self.assertTrue((ssd/'FinSight AI Backups'/id/'manifest.json').is_file())
        result=self.m.run('export',{'format':'json'});data=json.loads((self.m.exports/result['exportId']).read_text());self.assertEqual(len(data['data']['transactions']),self.before['tables']['"public"."transactions"']['rows']);self.assertTrue(all(isinstance(r['amount'],str) for r in data['data']['transactions']))
    def test_scheduled_slot_missed_days_and_repeat_native_jobs(self):
        self.m.now_override=dt.datetime(2026,10,30,12,tzinfo=dt.timezone.utc);self.assertTrue(self.m.run('tick',{})['scheduled']);self.assertFalse(self.m.run('tick',{})['scheduled']);self.m.now_override+=dt.timedelta(days=4);self.assertTrue(self.m.run('tick',{})['scheduled']);self.assertFalse(self.m.run('tick',{})['scheduled'])
if __name__=='__main__':unittest.main()
