#!/usr/bin/env python3
"""Isolated, offline portable build. Never installs or touches the legacy bundle/data."""
import argparse, ast, re, hashlib, importlib.util, json, os, plistlib, shutil, subprocess, sys, uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent

def run(args,**kw):
    result=subprocess.run(list(map(str,args)),check=True,**kw)
    return result

def trim_methods(source,classname,names):
    tree=ast.parse(source);lines=source.splitlines(keepends=True);ranges=[]
    for node in tree.body:
        if isinstance(node,ast.ClassDef) and node.name==classname:
            for item in node.body:
                if isinstance(item,(ast.FunctionDef,ast.AsyncFunctionDef)) and item.name in names:
                    a=min([item.lineno]+[d.lineno for d in item.decorator_list])-1
                    indent=' '*(item.col_offset)
                    ranges.append((a,item.end_lineno,indent+'def '+item.name+'(self, *args, **kwargs):\n'+indent+'    raise RuntimeError("Portable implementation required")\n'))
    assert len(ranges)==len(names)
    for a,b,value in sorted(ranges,reverse=True):lines[a:b]=[value]
    return ''.join(lines)

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def prune_runtime(resources):
    binary=resources/'python/Python.framework/Versions/3.11/bin'
    for path in binary.iterdir():
        if path.name not in ('python3.11','python3'):
            if path.is_dir() and not path.is_symlink():shutil.rmtree(path)
            else:path.unlink()
    pg=resources/'postgres'
    tools={'postgres','pg_ctl','initdb','psql','pg_dump','pg_dumpall','pg_restore','pg_isready'}
    for path in (pg/'bin').iterdir():
        if path.name not in tools:
            if path.is_dir() and not path.is_symlink():shutil.rmtree(path)
            else:path.unlink()
    for name in ['INSTALL_RECEIPT.json','sbom.spdx.json','homebrew.mxcl.postgresql@15.plist','homebrew.postgresql@15.service','.brew']:
        path=pg/name
        if path.is_dir():shutil.rmtree(path)
        elif path.exists():path.unlink()

def select_architecture(resources,architecture):
    # Only generated copies are thinned. Source runtimes are never modified.
    spec=importlib.util.spec_from_file_location('architecture_package',ROOT/'desktop/package.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    for path in resources.rglob('*'):
        if path.is_symlink() or not path.is_file() or not mod.macho(path):continue
        archs=subprocess.check_output(['/usr/bin/lipo','-archs',str(path)],text=True).split()
        if architecture not in archs:
            if path.name=='python3.11-intel64' and architecture=='arm64':path.unlink();continue
            raise RuntimeError('Incompatible runtime input: '+str(path.relative_to(resources)))
        if len(archs)>1:
            target=path.with_name(path.name+'.thin')
            run(['/usr/bin/lipo',path,'-thin',architecture,'-output',target]);target.chmod(path.stat().st_mode);os.replace(target,path)
            run(['/usr/bin/codesign','--force','--sign','-',path])

def validate_runpaths(resources):
    r=resources.resolve()
    cache={}
    def commands_for(p):
     if p not in cache:cache[p]=subprocess.check_output(['/usr/bin/otool','-l',str(p)],text=True)
     return cache[p]
    def rpaths(p):return re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset',commands_for(p))
    def exes(p):
     if p.is_relative_to(r/'java'):return [r/'java/bin/java',r/'java/lib/server/libjvm.dylib',r/'java/lib/libjava.dylib',r/'java/lib/libjli.dylib']
     if p.is_relative_to(r/'postgres'):return [r/'postgres/bin/postgres',r/'postgres/bin/psql']
     py=r/'python/Python.framework/Versions/3.11';return [py/'bin/python3.11',py/'Python',py/'Resources/Python.app/Contents/MacOS/Python']
    missing=[];count=0
    for p in r.rglob('*'):
     if p.is_symlink() or not p.is_file() or p.open('rb').read(4) not in [b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf']:continue
     for line in subprocess.check_output(['/usr/bin/otool','-L',str(p)],text=True).splitlines():
      if ' (compatibility' not in line:continue
      dep=line.strip().split(' (compatibility')[0]
      if not dep.startswith('@rpath/'):continue
      count+=1;candidates=[]
      for owner in [p]+[x for x in exes(p) if x.exists()]:
       for rp in rpaths(owner):
        if rp.startswith('@loader_path/'):candidates.append(owner.parent/rp[len('@loader_path/'):]/dep[len('@rpath/'):])
        elif rp.startswith('@executable_path/'):
         for exe in exes(p):candidates.append(exe.parent/rp[len('@executable_path/'):]/dep[len('@rpath/'):])
        elif rp.startswith('/'):candidates.append(Path(rp)/dep[len('@rpath/'):])
      if not any(x.exists() and x.resolve().is_relative_to(r) for x in candidates):missing.append((str(p.relative_to(r)),dep))
    if missing:raise RuntimeError('Unresolved bundled runpath dependencies: '+repr(missing))
    return count

def validate(app,architecture=None):
    """Fail on escaping links, personal payloads or reachable non-system native dependencies."""
    spec=importlib.util.spec_from_file_location('existing_package',ROOT/'desktop/package.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    resources=app/'Contents/Resources';count=0;minimum=(13,0)
    forbidden={'backend.env','installation.json','postmaster.pid','PG_VERSION','globals.sql','.env'}
    for p in app.rglob('*'):
        if p.is_symlink():
            if not p.resolve().is_relative_to(app.resolve()):raise RuntimeError('Escaping bundle symlink: '+str(p.relative_to(app)))
            continue
        if not p.is_file():continue
        if p.name in forbidden or p.suffix=='.dump' or p.name.endswith('.owner.json'):raise RuntimeError('Mutable/private payload detected: '+str(p.relative_to(app)))
        if mod.macho(p):
            count+=1
            archs=subprocess.check_output(['/usr/bin/lipo','-archs',str(p)],text=True).split()
            if architecture and architecture not in archs:raise RuntimeError('Wrong native architecture: '+str(p.relative_to(app)))
            commands=subprocess.check_output(['/usr/bin/otool','-l',str(p)],text=True)
            versions=re.findall(r'\bminos (\d+(?:\.\d+)+)',commands)
            versions+=re.findall(r'LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version (\d+(?:\.\d+)+)',commands)
            for version in versions:minimum=max(minimum,tuple(map(int,version.split('.'))))
            dependencies=subprocess.check_output(['/usr/bin/otool','-L',str(p)],text=True)
            for line in dependencies.splitlines()[1:]:
                if ' (compatibility' not in line:continue
                dep=line.strip().split(' (compatibility')[0]
                if dep.startswith('/') and not dep.startswith(('/usr/lib/','/System/Library/')):raise RuntimeError('External native runtime dependency: '+dep)
                if dep.startswith('@loader_path/') and not (p.parent/dep[len('@loader_path/'):]).exists():raise RuntimeError('Missing native dependency: '+str(p.relative_to(app))+': '+dep)
    for name in ['supervisor.py','supervisor_core.py','portable_config.py','scripts/backup_manager.py','scripts/backup_core.py','bridge.js']:
        text=(resources/name).read_text()
        if any(value in text for value in ['/Users/chrisfraser','/opt/homebrew','/tmp/finsight-java','finsight-isolated-verification-','finsight_phase6_desktop']):raise RuntimeError('Development path in shipped runtime source: '+name)
    run(['/usr/bin/codesign','--verify','--deep','--strict',app])
    runpath_count=validate_runpaths(resources)
    return {'runpathReferencesChecked':runpath_count,'minimumRuntimeMacOS':'.'.join(map(str,minimum)),'nativeFilesChecked':count,'escapingLinks':0,'personalPayloads':0,'externalNativeDependencies':0,'runtimeSourceDevelopmentPaths':0}

def main():
    p=argparse.ArgumentParser();p.add_argument('--java-home',type=Path,default=Path('/tmp/finsight-java/jdk-21.0.13+9/Contents/Home'));p.add_argument('--python-home',type=Path,default=Path('/Library/Frameworks/Python.framework/Versions/3.11'));p.add_argument('--site-packages',type=Path,default=Path('/tmp/finsight-ai-venv/lib/python3.11/site-packages'));p.add_argument('--postgres-home',type=Path,default=Path('/opt/homebrew/opt/postgresql@15'));p.add_argument('--node-bin',type=Path,default=Path('/tmp/node-v22.14.0-darwin-arm64/bin'));p.add_argument('--maven',type=Path,default=Path('/tmp/apache-maven-3.9.9/bin/mvn'));p.add_argument('--maven-cache',type=Path,default=Path('/tmp/finsight-m2'));p.add_argument('--architecture',choices=['arm64','x86_64'],default='x86_64');p.add_argument('--skip-build',action='store_true',help='Reuse source build artifacts by copying; never modify their originals');p.add_argument('--dmg',action='store_true');p.add_argument('--resume',type=Path,help='Revalidate/finalize an existing isolated build stage');args=p.parse_args()
    for name in ['java_home','python_home','site_packages','postgres_home','node_bin','maven','maven_cache']:setattr(args,name,getattr(args,name).resolve())
    if os.uname().machine not in ('arm64','x86_64'):raise SystemExit('A compatible Mac build host is required')
    for binary in [args.java_home/'bin/java',args.postgres_home/'bin/postgres']:
        archs=subprocess.check_output(['/usr/bin/lipo','-archs',str(binary)],text=True).split()
        if args.architecture not in archs:raise SystemExit('Runtime architecture mismatch: supply '+args.architecture+' binaries explicitly')
    destination=ROOT/'dist';destination.mkdir(exist_ok=True)
    if args.resume:
        stage=args.resume.resolve()
        if stage.parent!=destination.resolve() or not re.fullmatch(r'portable-build-[a-f0-9]{12}',stage.name):raise RuntimeError('Only an existing isolated build stage can be finalized')
    else:
        stage=destination/('portable-build-'+uuid.uuid4().hex[:12]);stage.mkdir()
        # Copy allowlisted sources only. Existing user docs, .env, binaries and data are excluded.
        for directory in ['frontend','backend']:
            (stage/directory).mkdir()
        shutil.copytree(ROOT/'frontend/src',stage/'frontend/src')
        for name in ['package.json','package-lock.json','vite.config.ts','tsconfig.json','index.html']:
            shutil.copy2(ROOT/'frontend'/name,stage/'frontend'/name)
        if (ROOT/'frontend/public').exists():shutil.copytree(ROOT/'frontend/public',stage/'frontend/public')
        shutil.copytree(ROOT/'backend/src',stage/'backend/src');shutil.copy2(ROOT/'backend/pom.xml',stage/'backend/pom.xml')
        env={'HOME':str(Path.home()),'PATH':str(args.node_bin)+':/usr/bin:/bin:/usr/sbin:/sbin','JAVA_HOME':str(args.java_home),'DEBUG':'false'}
        auth=stage/'frontend/src/components/AuthGate.tsx'
        auth.write_text(auth.read_text().replace('with no financial records or categories.','with no financial history and 20 standard categories.'))
        if args.skip_build:
            shutil.copytree(ROOT/'frontend/dist',stage/'frontend/dist');(stage/'backend/target').mkdir();shutil.copy2(ROOT/'backend/target/finsight-api-0.1.0.jar',stage/'backend/target/finsight-api-0.1.0.jar')
        else:
            (stage/'frontend/node_modules').symlink_to(ROOT/'frontend/node_modules',target_is_directory=True)
            with (stage/'frontend-build.log').open('w') as log:run([args.node_bin/'npm','run','build'],cwd=stage/'frontend',env=env,stdout=log,stderr=subprocess.STDOUT)
            with (stage/'backend-verify.log').open('w') as log:run([args.maven,'-o','-Dmaven.repo.local='+str(args.maven_cache),'verify'],cwd=stage/'backend',env=env,stdout=log,stderr=subprocess.STDOUT)
        for directory in ['desktop','scripts','ai-service/artifacts']:(stage/directory).mkdir(parents=True,exist_ok=True)
        shutil.copytree(ROOT/'ai-service/app',stage/'ai-service/app',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        shutil.copy2(ROOT/'ai-service/artifacts/category-model.joblib',stage/'ai-service/artifacts/category-model.joblib')
        # Reuse unchanged core methods; remove legacy location/connection constructors in shipped copies.
        core=trim_methods((ROOT/'desktop/supervisor.py').read_text(),'Supervisor',{'__init__','provision','database','start_services'})
        (stage/'desktop/supervisor.py').write_text((HERE/'portable_supervisor.py').read_text())
        backup=trim_methods((ROOT/'scripts/backup_manager.py').read_text(),'Manager',{'__init__'})
        backup=backup.replace("SOURCES = ['finsight_demo', 'finsight_test', 'postgres', 'finsight_local_maintenance']","SOURCES = ['finsight', 'postgres']")
        backup=backup.replace("if not self.test and agent.is_file() and sys.platform=='darwin':","if False:")
        (stage/'scripts/backup_manager.py').write_text((HERE/'portable_backup.py').read_text())
        swift=(ROOT/'desktop/Main.swift').read_text().replace('Library/Application Support/FinSight AI','Library/Application Support/FinSight AI Portable').replace('finsight-desktop-test-','finsight-portable-test-').replace('.applicationVersion:"0.6.1"','.applicationVersion:"0.6.2"')
        (stage/'desktop/Main.swift').write_text(swift)
        for name in ['Icon.swift','bridge.js','backup-launcher.sh']:shutil.copy2(ROOT/'desktop'/name,stage/'desktop'/name)
        spec=importlib.util.spec_from_file_location('legacy_packager',ROOT/'desktop/package.py');pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack);pack.ROOT=stage
        sys.argv=['package.py','--java-home',str(args.java_home),'--python-home',str(args.python_home),'--site-packages',str(args.site_packages),'--postgres-home',str(args.postgres_home)]
        original_run=pack.run
        def target_run(*values):
            return original_run(*(str(v).replace('arm64-apple-macos13.0',args.architecture+'-apple-macos13.0') for v in values))
        pack.run=target_run
        original_relocate=pack.relocate
        def target_relocate(resources,mappings):
            prune_runtime(resources)
            select_architecture(resources,args.architecture)
            aliases=mappings+[(Path('/Applications/Postgres.app/Contents/Versions/15'),resources/'postgres')]
            return original_relocate(resources,aliases)
        pack.relocate=target_relocate
        pack.main()
    core=trim_methods((ROOT/'desktop/supervisor.py').read_text(),'Supervisor',{'__init__','provision','database','start_services'})
    backup=trim_methods((ROOT/'scripts/backup_manager.py').read_text(),'Manager',{'__init__'})
    backup=backup.replace("SOURCES = ['finsight_demo', 'finsight_test', 'postgres', 'finsight_local_maintenance']","SOURCES = ['finsight', 'postgres']").replace("if not self.test and agent.is_file() and sys.platform=='darwin':",'if False:')
    app=stage/'desktop/build/FinSight AI.app';r=app/'Contents/Resources'
    prune_runtime(r)
    select_architecture(r,args.architecture)
    (r/'supervisor_core.py').write_text(core);(r/'scripts/backup_core.py').write_text(backup);shutil.copy2(HERE/'portable_config.py',r/'portable_config.py');shutil.copy2(HERE/'portable_config.py',r/'scripts/portable_config.py')
    # No backup agent/launcher is shipped or installed by this distribution.
    (r/'backup-launcher.sh').unlink(missing_ok=True)
    shutil.copy2(HERE/'portable_supervisor.py',r/'supervisor.py');shutil.copy2(HERE/'portable_backup.py',r/'scripts/backup_manager.py')
    (r/'THIRD-PARTY-NOTICES.txt').write_text('FinSight AI portable private distribution.\nJava 21: see java/legal (GPLv2 with Classpath Exception and third-party notices).\nCPython: see python/Python.framework/Versions/3.11/LICENSE*.\nPython package licenses: site-packages/*.dist-info. PostgreSQL: postgres/COPYRIGHT.\nAdditional native library notices: third-party-licenses/.\nNo runtime downloads, credentials or financial records included.\n')
    notices=args.postgres_home.parent/'postgres-notices'
    if notices.is_dir():shutil.copytree(notices,r/'third-party-licenses/postgres-app',dirs_exist_ok=True)
    if not (r/'postgres/COPYRIGHT').exists():shutil.copy2(HERE/'licenses/POSTGRESQL-COPYRIGHT',r/'postgres/COPYRIGHT')
    provenance=args.postgres_home.parent/'provenance.json'
    if provenance.is_file():shutil.copy2(provenance,r/'BUILD-INPUTS.json')
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes());info.update(CFBundleIdentifier='com.finsight.portable',CFBundleShortVersionString='0.6.2',CFBundleVersion='62');(app/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    names=['backend.jar','supervisor.py','supervisor_core.py','portable_config.py','scripts/backup_manager.py','scripts/backup_core.py','scripts/portable_config.py','bridge.js','frontend/index.html','ai/artifacts/category-model.joblib']
    payload={str(f.relative_to(r)):digest(f) for f in r.rglob('*') if f.is_file() and not f.is_symlink() and '_CodeSignature' not in f.parts}
    manifest={'format':1,'distribution':'portable-v1','version':'0.6.2','architecture':args.architecture,'postgresMajor':15,'files':{name:digest(r/name) for name in names},'payloadFiles':{name:sha for name,sha in payload.items() if name!='manifest.json'}}
    manifest['buildId']=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()[:20];(r/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    run(['/usr/bin/codesign','--force','--deep','--sign','-',app]);report=validate(app,args.architecture)
    info['LSMinimumSystemVersion']=report['minimumRuntimeMacOS'];(app/'Contents/Info.plist').write_bytes(plistlib.dumps(info));run(['/usr/bin/codesign','--force','--deep','--sign','-',app])
    shell_archs=subprocess.check_output(['/usr/bin/lipo','-archs',str(app/'Contents/MacOS/FinSightAI')],text=True).split()
    if args.architecture not in shell_archs:raise RuntimeError('Shell architecture does not match requested build')
    # Bundled import smoke test does not run the supervisor or initialize any storage.
    py=r/'python/Python.framework/Versions/3.11';smoke=dict(HOME=str(Path.home()),PATH='/usr/bin:/bin:/usr/sbin:/sbin',PYTHONHOME=str(py),PYTHONPATH=str(r)+':'+str(r/'scripts')+':'+str(r/'site-packages'),PYTHONDONTWRITEBYTECODE='1',PYTHONNOUSERSITE='1')
    run([py/'bin/python3.11','-c','import supervisor,backup_manager,portable_config; print("Portable imports passed")'],env=smoke)
    report.update(version='0.6.2',architecture=args.architecture,minimumShellMacOS='13.0',cleanMachineVerified=False,notarized=False,signing='ad-hoc',buildId=manifest['buildId'])
    (stage/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    # A stable pointer selects generated output only; no installed app or user data touched.
    pointer=destination/'portable-current';temp=destination/('.portable-'+uuid.uuid4().hex);temp.symlink_to(stage.name,target_is_directory=True);os.replace(temp,pointer)
    if args.dmg:
        dmg=destination/'FinSight-AI-Installer.dmg'
        if dmg.exists():raise RuntimeError('Installer already exists; retain/rename it before creating another')
        image=stage/'dmg';image.mkdir();shutil.copytree(app,image/'FinSight AI.app',symlinks=True);(image/'Applications').symlink_to('/Applications')
        for doc in ['INSTALL-FINSIGHT-AI.md','MACOS-DISTRIBUTION.md']:
            if (ROOT/'docs'/doc).exists():shutil.copy2(ROOT/'docs'/doc,image/doc)
        run(['/usr/bin/hdiutil','create','-volname','FinSight AI Installer','-srcfolder',image,'-format','UDZO',dmg])
        report['dmgBytes']=dmg.stat().st_size;(stage/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Portable build:',app);print('Validation:',stage/'validation.json')
if __name__=='__main__':main()
