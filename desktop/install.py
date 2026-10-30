#!/usr/bin/env python3
"""Explicit local bundle installation and path-only migration of the already-approved backup job."""
import argparse,datetime,os,plistlib,shutil,subprocess,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=Path.home()/'Library/Application Support/FinSight AI';LABEL='com.finsight.local-backups'
def command(*args,check=True):return subprocess.run(list(map(str,args)),check=check,capture_output=True,text=True)
def agent_candidate():
 source=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
 value=plistlib.loads(source.read_bytes())
 if value.get('Label')!=LABEL or value.get('StartInterval')!=300 or value.get('RunAtLoad')!=True:raise RuntimeError('Existing backup job differs; review it before making changes')
 current=BASE/'desktop/current'
 if not (current/'backup-launcher.sh').is_file():raise RuntimeError('Launch the verified packaged app first to provision its local runtime')
 value['ProgramArguments']=[str(current/'backup-launcher.sh')];value.pop('Program',None);value['WorkingDirectory']=str(BASE)
 value['EnvironmentVariables']={**value.get('EnvironmentVariables',{}),'FINSIGHT_DATA_HOME':str(BASE),'FINSIGHT_PG_BIN':str(current/'postgres/bin')}
 target=ROOT/'desktop/build'/f'{LABEL}.plist';target.write_bytes(plistlib.dumps(value));target.chmod(0o600);return source,target

def main():
 p=argparse.ArgumentParser();p.add_argument('--install-app',action='store_true');p.add_argument('--prepare-agent',action='store_true');p.add_argument('--update-approved-agent',action='store_true');args=p.parse_args()
 app=ROOT/'desktop/build/FinSight AI.app'
 if args.install_app:
  command('/usr/bin/codesign','--verify','--deep','--strict',app)
  target=Path('/Applications/FinSight AI.app');staged=target.parent/('.FinSight-AI-'+uuid.uuid4().hex+'.app')
  shutil.copytree(app,staged,symlinks=True);command('/usr/bin/codesign','--verify','--deep','--strict',staged)
  if target.exists():
   identity=plistlib.loads((target/'Contents/Info.plist').read_bytes())
   if identity.get('CFBundleIdentifier')!='com.finsight.local':raise RuntimeError('Refusing to replace an unrelated application')
   target.rename(target.with_name('FinSight AI previous '+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.app'))
  staged.rename(target);print('Installed: '+str(target))
 if args.prepare_agent or args.update_approved_agent:
  source,candidate=agent_candidate();print('Reviewed path-only backup job candidate: '+str(candidate))
  if args.update_approved_agent:
   import sys
   sys.path.insert(0,str(BASE/'desktop/current/scripts'));from backup_manager import Manager
   os.environ['FINSIGHT_PG_BIN']=str(BASE/'desktop/current/postgres/bin');manager=Manager()
   with manager.lock():
    backup=BASE/'desktop/backup-launchagent-before.plist'
    if not backup.exists():backup.write_bytes(source.read_bytes());backup.chmod(0o600)
    command('/bin/launchctl','bootout',f'gui/{os.getuid()}/{LABEL}')
    temporary=source.with_suffix('.new');temporary.write_bytes(candidate.read_bytes());temporary.chmod(0o600);os.replace(temporary,source)
    try:command('/bin/launchctl','bootstrap',f'gui/{os.getuid()}',source)
    except Exception:
     source.write_bytes(backup.read_bytes());source.chmod(0o600);command('/bin/launchctl','bootstrap',f'gui/{os.getuid()}',source,check=False);raise
   command('/bin/launchctl','kickstart',f'gui/{os.getuid()}/{LABEL}')
   print('Existing approved backup label/schedule preserved; only bundled runtime/working-directory paths updated. No duplicate job or server autostart installed.')
if __name__=='__main__':main()
