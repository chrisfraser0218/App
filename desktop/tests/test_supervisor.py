import importlib.util,json,os,tempfile,unittest,zipfile,zlib
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('supervisor',Path(__file__).resolve().parents[1]/'supervisor.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SupervisorTests(unittest.TestCase):
 def test_environment_parser_never_executes_shell(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'backend.env';p.write_text('DB_PASSWORD=\'$(touch NEVER-RUN)`secret`\'\nDB_URL=jdbc:postgresql://127.0.0.1:55432/finsight_demo\n');p.chmod(0o600)
   self.assertEqual(m.load_env(p)['DB_PASSWORD'],'$(touch NEVER-RUN)`secret`');self.assertFalse((Path.cwd()/'NEVER-RUN').exists())
 def test_world_readable_or_symlink_credentials_refused(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'backend.env';p.write_text('DB_PASSWORD=synthetic');p.chmod(0o644)
   with self.assertRaises(m.StartupError):m.load_env(p)
   p.chmod(0o600);link=Path(d)/'link';link.symlink_to(p)
   with self.assertRaises(m.StartupError):m.load_env(link)
 def test_invalid_config_lines_refused(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'e';p.write_text('source /tmp/unsafe');p.chmod(0o600)
   with self.assertRaises(m.StartupError):m.load_env(p)
 def test_migration_crc_matches_flyway_line_algorithm(self):
  with tempfile.TemporaryDirectory() as d:
   jar=Path(d)/'a.jar'
   with zipfile.ZipFile(jar,'w')as z:z.writestr('BOOT-INF/classes/db/migration/V6__test.sql','\ufeffSELECT 1;\r\nSELECT 2;\n')
   crc=zlib.crc32(b'SELECT 2;',zlib.crc32(b'SELECT 1;'));crc=crc if crc<2**31 else crc-2**32
   self.assertEqual(m.expected_migrations(jar),{'6':crc})
 def test_changed_pid_identity_is_never_owned(self):
  with patch.object(m,'identity',return_value='new process'):
   self.assertFalse(m.same_process({'pid':123,'identity':'old process'}));self.assertFalse(m.same_process({'pid':0,'identity':'new process'}))
 def test_private_manifest_is_owner_only_and_atomic(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'state.json';m.private_json(p,{'status':'starting'});self.assertEqual(p.stat().st_mode&0o777,0o600);self.assertFalse(p.with_suffix('.tmp').exists())
 def test_data_symlink_refused(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'link';p.symlink_to(Path(d),target_is_directory=True)
   with self.assertRaises(m.StartupError):m.private_dir(p)
 def test_personal_database_start_refused_without_new_approval(self):
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory()as d:
   cluster=Path(d);(cluster/'PG_VERSION').write_text('15');manager=SimpleNamespace(expected_data=d,tools=Path('/existing/tools'),require_space=lambda _:None)
   supervisor=object.__new__(m.Supervisor);supervisor.manager=manager;supervisor.base=cluster;supervisor.env={};supervisor.production=True
   with patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=3)):
    with self.assertRaisesRegex(m.StartupError,'awaiting owner approval'):supervisor.database()
 def test_recently_closed_connection_does_not_block_restart(self):
  import socket
  with socket.socket()as server:
   server.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);server.bind(('127.0.0.1',0));port=server.getsockname()[1];server.listen()
   with socket.create_connection(('127.0.0.1',port))as client:
    accepted,_=server.accept();accepted.close();self.assertEqual(client.recv(1),b'')
  self.assertFalse(m.port_busy(port))
 def test_port_conflict_detected_without_signals(self):
  import socket
  with socket.socket()as s:
   s.bind(('127.0.0.1',0));s.listen();self.assertTrue(m.port_busy(s.getsockname()[1]))
if __name__=='__main__':unittest.main()
