#!/usr/bin/env python3
"""Build from installed local runtimes only. Never downloads, installs packages, or copies financial data."""
import argparse,hashlib,json,os,plistlib,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def run(*args):return subprocess.check_output(list(map(str,args)),stderr=subprocess.STDOUT,text=True)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def macho(path):
 try:return path.open('rb').read(4) in (b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\xbe\xba\xfe\xca',b'\xca\xfe\xba\xbf')
 except OSError:return False

def relocate(resources,mappings):
 """Resolve copied Homebrew/Framework dependencies, then replace only copies' load commands."""
 deps=resources/'deps';deps.mkdir(exist_ok=True);queue=[p for p in resources.rglob('*') if p.is_file() and not p.is_symlink() and macho(p)];seen=set();copied={};copied_hash={};origins={}
 while queue:
  path=queue.pop()
  if path in seen:continue
  seen.add(path)
  path.chmod(path.stat().st_mode|0o200)
  if path not in origins:
   for original,destination in mappings:
    if path.is_relative_to(destination):origins[path]=original/path.relative_to(destination);break
  output=run('/usr/bin/otool','-L',path)
  ids={line.strip() for line in run('/usr/bin/otool','-D',path).splitlines() if not line.strip().endswith(':')}
  for line in output.splitlines():
   if ' (compatibility' not in line:continue
   dep=line.strip().split(' (compatibility')[0]
   if dep in ids:continue
   if dep.startswith('@loader_path/'):
    target=(path.parent/dep[len('@loader_path/'):]).resolve()
    if not target.exists():
     original=origins.get(path)
     source=(original.parent/dep[len('@loader_path/'):]).resolve() if original else None
     if source is None or not source.is_file() or not target.is_relative_to(resources.resolve()):raise RuntimeError('Missing local relative dependency: '+dep)
     target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);origins[target]=source;copied[str(source)]=target.name;copied_hash[target.name]=sha(source);queue.append(target)
    continue
   if not dep.startswith('/') or dep.startswith(('/usr/lib/','/System/Library/')):continue
   target=None
   for original,destination in mappings:
    if dep.startswith(str(original)+'/'):target=destination/Path(dep).relative_to(original);break
   if target is None:
    source=Path(dep).resolve()
    if not source.is_file():raise RuntimeError('Installed dependency missing: '+str(source))
    target=deps/source.name
    if target.exists() and copied_hash.get(target.name)!=sha(source):raise RuntimeError('Conflicting bundled library basename: '+source.name)
    if not target.exists():shutil.copy2(source,target);copied[str(source)]=target.name;copied_hash[target.name]=sha(source);origins[target]=source;queue.append(target)
   if not target.exists():raise RuntimeError('Missing copied dependency: '+str(target))
   relative='@loader_path/'+os.path.relpath(target,path.parent)
   run('/usr/bin/install_name_tool','-change',dep,relative,path)
  if 'DYLIB' in run('/usr/bin/otool','-hv',path):run('/usr/bin/install_name_tool','-id','@loader_path/'+path.name,path)
  run('/usr/bin/codesign','--force','--preserve-metadata=entitlements','--sign','-',path)
 return copied

def main():
 p=argparse.ArgumentParser();p.add_argument('--java-home',default='/tmp/finsight-java/jdk-21.0.13+9/Contents/Home');p.add_argument('--python-home',default='/Library/Frameworks/Python.framework/Versions/3.11');p.add_argument('--site-packages',default='/tmp/finsight-ai-venv/lib/python3.11/site-packages');p.add_argument('--postgres-home',default='/opt/homebrew/opt/postgresql@15');p.add_argument('--dmg',action='store_true');args=p.parse_args()
 java,python,site,pg=map(lambda s:Path(s).resolve(),[args.java_home,args.python_home,args.site_packages,args.postgres_home])
 for path in [java/'bin/java',python/'bin/python3.11',site/'fastapi',pg/'bin/postgres',ROOT/'backend/target/finsight-api-0.1.0.jar',ROOT/'frontend/dist/index.html',ROOT/'ai-service/artifacts/category-model.joblib']:
  if not path.exists():raise RuntimeError('Build prerequisite missing: '+str(path))
 build=ROOT/'desktop/build';build.mkdir(exist_ok=True);app=build/'FinSight AI.app'
 # Staging is generated output, never persistent application data.
 if app.exists():shutil.rmtree(app)
 contents=app/'Contents';r=contents/'Resources';(contents/'MacOS').mkdir(parents=True);r.mkdir()
 print('Copying existing runtimes and production assets',flush=True)
 shutil.copytree(java,r/'java',symlinks=True)
 py=r/'python/Python.framework';version=py/'Versions/3.11';version.parent.mkdir(parents=True)
 shutil.copytree(python,version,symlinks=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc','_tkinter*','idlelib','tkinter','_CodeSignature'))
 # Do not ship globally installed packages; use the verified local application environment.
 shutil.rmtree(version/'lib/python3.11/site-packages',ignore_errors=True)
 os.symlink('3.11',py/'Versions/Current');os.symlink('Versions/Current/Python',py/'Python');os.symlink('Versions/Current/Resources',py/'Resources')
 shutil.copytree(site,r/'site-packages',symlinks=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc','_pytest','pytest','pytest-*','pip','pip-*'))
 shutil.copytree(pg,r/'postgres',symlinks=True)
 shutil.rmtree(r/'postgres/include',ignore_errors=True)
 shutil.copytree(ROOT/'frontend/dist',r/'frontend');shutil.copyfile(ROOT/'backend/target/finsight-api-0.1.0.jar',r/'backend.jar')
 shutil.copytree(ROOT/'ai-service/app',r/'ai/app',ignore=shutil.ignore_patterns('__pycache__','*.pyc'));(r/'ai/artifacts').mkdir();shutil.copyfile(ROOT/'ai-service/artifacts/category-model.joblib',r/'ai/artifacts/category-model.joblib')
 (r/'scripts').mkdir();shutil.copyfile(ROOT/'scripts/backup_manager.py',r/'scripts/backup_manager.py');shutil.copyfile(ROOT/'desktop/supervisor.py',r/'supervisor.py');shutil.copyfile(ROOT/'desktop/bridge.js',r/'bridge.js');shutil.copyfile(ROOT/'desktop/backup-launcher.sh',r/'backup-launcher.sh');(r/'backup-launcher.sh').chmod(0o700)
 print('Relocating copied libraries and applying local ad-hoc signatures',flush=True)
 libraries=relocate(r,[(python,version),(Path('/Library/Frameworks/Python.framework/Versions/3.11'),version),(pg,r/'postgres'),(java,r/'java')])
 licenses=r/'third-party-licenses';licenses.mkdir()
 for source in libraries:
  parts=Path(source).parts
  if 'Cellar' not in parts:continue
  index=parts.index('Cellar');package=Path(*parts[:index+3]);destination=licenses/parts[index+1];destination.mkdir(exist_ok=True)
  for candidate in package.rglob('*'):
   if candidate.is_file() and not candidate.is_symlink() and candidate.name.upper().startswith(('LICENSE','COPYING','COPYRIGHT')) and candidate.stat().st_size<1024*1024:
    shutil.copyfile(candidate,destination/(candidate.parent.name+'-'+candidate.name))
 (r/'THIRD-PARTY-NOTICES.txt').write_text('FinSight AI private local build. Existing installed runtimes copied without downloads.\nJava licenses: java/legal. Python license: python/Python.framework/Versions/3.11/LICENSE*.\nPython distributions retain their *.dist-info licenses. PostgreSQL retains COPYRIGHT.\nBundled native library source installations:\n'+json.dumps(libraries,indent=2)+'\n')
 # Both JDK and Python use nested bundles. Sign after load-command changes, before recording hashes.
 run('/usr/bin/codesign','--force','--deep','--preserve-metadata=entitlements','--sign','-',py)
 print('Compiling native wrapper with installed Swift tools',flush=True)
 run('/usr/bin/xcrun','swiftc','-O','-target','arm64-apple-macos13.0','-module-cache-path',str(build/'module-cache'),'-framework','AppKit','-framework','WebKit',ROOT/'desktop/Main.swift','-o',contents/'MacOS/FinSightAI')
 run('/usr/bin/xcrun','swift','-module-cache-path',str(build/'module-cache'),ROOT/'desktop/Icon.swift',r/'FinSight.icns')
 info={'CFBundleName':'FinSight AI','CFBundleDisplayName':'FinSight AI','CFBundleIdentifier':'com.finsight.local','CFBundleExecutable':'FinSightAI','CFBundlePackageType':'APPL','CFBundleShortVersionString':'0.6.1','CFBundleVersion':'61','CFBundleIconFile':'FinSight','LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True,'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True,'NSExceptionDomains':{'127.0.0.1':{'NSExceptionAllowsInsecureHTTPLoads':True}}}}
 (contents/'Info.plist').write_bytes(plistlib.dumps(info))
 critical=['backend.jar','supervisor.py','bridge.js','scripts/backup_manager.py','backup-launcher.sh','frontend/index.html','ai/artifacts/category-model.joblib']
 payload_files={str(p.relative_to(r)):sha(p) for p in r.rglob('*') if p.is_file() and not p.is_symlink() and '_CodeSignature' not in p.parts}
 manifest={'format':1,'version':'0.6.1','architecture':'arm64','postgresMajor':15,'files':{name:sha(r/name) for name in critical},'payloadFiles':payload_files,'runtimeSources':'Existing installed Java 21, CPython 3.11, PostgreSQL 15.17 and application site-packages; no downloads'}
 manifest['buildId']=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()[:20];(r/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 run('/usr/bin/codesign','--force','--deep','--preserve-metadata=entitlements','--sign','-',app);run('/usr/bin/codesign','--verify','--deep','--strict',app)
 # Validate relocated runtimes with no Homebrew/venv PATH or Python library environment.
 env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','PYTHONHOME':str(version),'PYTHONPATH':str(r/'site-packages'),'PYTHONNOUSERSITE':'1','PYTHONDONTWRITEBYTECODE':'1'}
 subprocess.run([str(version/'bin/python3.11'),'-c','import fastapi,uvicorn,sklearn,numpy,scipy,sys,pathlib; assert pathlib.Path(sys.executable).resolve().is_relative_to(pathlib.Path(sys.prefix).resolve()); print("Bundled Python and AI imports passed")'],env=env,check=True)
 subprocess.run([str(r/'java/bin/java'),'-version'],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run([str(r/'postgres/bin/postgres'),'--version'],env=env,check=True)
 run('/usr/bin/codesign','--verify','--deep','--strict',app)
 if args.dmg:
  dmg=build/'FinSight AI.dmg'
  if dmg.exists():dmg.unlink()
  stage=build/'dmg-stage'
  if stage.exists():shutil.rmtree(stage)
  stage.mkdir();shutil.copytree(app,stage/app.name,symlinks=True);os.symlink('/Applications',stage/'Applications')
  run('/usr/bin/hdiutil','create','-volname','FinSight AI','-srcfolder',stage,'-format','UDZO',dmg)
  shutil.rmtree(stage)
 print('Bundle: '+str(app),flush=True)
if __name__=='__main__':main()
