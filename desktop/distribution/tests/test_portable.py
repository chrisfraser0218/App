"""Source-only safety tests. No database connection or installed-app mutation."""
import importlib.util,json,os,sys,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parents[1];sys.path.insert(0,str(HERE))
from portable_config import data_home,load,FORMAT
from build import trim_methods

class PortableSafetyTests(unittest.TestCase):
    def config(self,base):
        value={'format':FORMAT,'id':uuid.uuid4().hex,'dataHome':str(base.resolve()),'port':25432,'adminPassword':'a'*64,'appPassword':'b'*64,'phase':'ready'}
        p=base/'installation.json';p.write_text(json.dumps(value));p.chmod(0o600);return value
    def test_legacy_storage_is_not_the_default(self):
        self.assertEqual(data_home().name,'FinSight AI Portable')
    def test_private_configuration_validates_identity(self):
        with tempfile.TemporaryDirectory(prefix='finsight-portable-test-',dir='/tmp') as d:
            p=Path(d);p.chmod(0o700);self.config(p)
            self.assertEqual(load(p)['phase'],'ready')
    def test_shared_permissions_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.config(p);(p/'installation.json').chmod(0o644)
            with self.assertRaises(ValueError):load(p)
    def test_symlink_configuration_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);self.config(p);(p/'installation.json').rename(p/'actual');(p/'installation.json').symlink_to(p/'actual')
            with self.assertRaises(ValueError):load(p)
    def test_reserved_database_ports_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);c=self.config(p)
            for port in [5432,55432,55434,True,0,65536]:
                c['port']=port;(p/'installation.json').write_text(json.dumps(c))
                with self.assertRaises(ValueError):load(p)
    def test_moved_data_identity_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);c=self.config(p);c['dataHome']='/somewhere/else';(p/'installation.json').write_text(json.dumps(c))
            with self.assertRaises(ValueError):load(p)
    def test_invalid_secrets_and_phases_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);c=self.config(p)
            for k,v in [('adminPassword','short'),('phase','reinitialize'),('format','legacy')]:
                bad={**c,k:v};(p/'installation.json').write_text(json.dumps(bad))
                with self.assertRaises(ValueError):load(p)
    def test_profiles_cannot_choose_personal_paths(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'profile.json';p.write_text(json.dumps({'dataHome':str(Path.home()/'Library/Application Support/FinSight AI')}));p.chmod(0o600)
            with self.assertRaises(ValueError):data_home(p)
    def test_private_synthetic_profile_accepted(self):
        with tempfile.TemporaryDirectory(prefix='finsight-portable-test-',dir='/tmp') as d:
            p=Path(d);p.chmod(0o700);profile=p/'profile.json';profile.write_text(json.dumps({'dataHome':str(p/'data')}));profile.chmod(0o600)
            self.assertEqual(data_home(profile), (p/'data').resolve())
    def test_legacy_initialization_code_removed_from_shipped_core(self):
        source='class Supervisor:\n def database(self):\n  connect_to_personal_database()\n def run(self):\n  self.database()\n'
        transformed=trim_methods(source,'Supervisor',{'database'})
        self.assertNotIn('connect_to_personal_database',transformed);self.assertIn('self.database()',transformed)
    def test_source_has_no_reset_or_personal_install_actions(self):
        source=(HERE/'portable_supervisor.py').read_text()
        for forbidden in ['DROP DATABASE','--clean','finsight_demo','55432/finsight','/Applications/','launchctl','initdb -D']:
            self.assertNotIn(forbidden,source)
    def test_legacy_name_explicitly_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'FinSight AI';p.mkdir();self.config(p)
            with self.assertRaises(ValueError):load(p)

if __name__=='__main__':unittest.main()
