#!/usr/bin/env python3
"""Explicit development download step; writes only isolated dist/intel-inputs files."""
import hashlib,json,subprocess,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'dist/intel-inputs'
ASSETS=[('java.tar.gz','https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_mac_hotspot_21.0.13_9.tar.gz','9aa1d1c17ae5467a022679e7e0af5c00797d94ac462ed1a46f4db07a8a34a6dd'),('postgres.dmg','https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.4/Postgres-2.9.4-15.dmg','54d065645f1850cde4627a88491537a21f3b46b8ab4f5edc77a63a864edf3008')]
def run(args,**kw):return subprocess.run(list(map(str,args)),check=True,**kw)
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    for name,url,sha in ASSETS:
        path=OUT/name
        if not path.exists():run(['/usr/bin/curl','--fail','--location','--show-error','--output',path,url])
        if hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise RuntimeError('Runtime checksum mismatch; do not use '+name)
        print('Verified',name,flush=True)
    java=OUT/'java'
    if not java.exists():
        java.mkdir()
        with tarfile.open(OUT/'java.tar.gz') as archive:archive.extractall(java,filter='data')
    pg=OUT/'postgres'
    if not pg.exists():
        mount=OUT/'postgres-mount';mount.mkdir(exist_ok=True)
        run(['/usr/bin/hdiutil','attach','-readonly','-nobrowse','-mountpoint',mount,OUT/'postgres.dmg'])
        try:
            import shutil
            shutil.copytree(mount/'Postgres.app/Contents/Versions/15',pg,symlinks=True)
            notices=OUT/'postgres-notices';notices.mkdir(exist_ok=True)
            for name in ['LICENSE','COPYING','COPYRIGHT']:
                for source in (mount/'Postgres.app/Contents').rglob(name):
                    if source.is_file() and source.stat().st_size<1000000:shutil.copy2(source,notices/(hashlib.sha256(str(source.relative_to(mount)).encode()).hexdigest()[:10]+'-'+name))
        finally:run(['/usr/bin/hdiutil','detach',mount])
    wheels=OUT/'wheels';wheels.mkdir(exist_ok=True);py=Path('/tmp/finsight-ai-venv/bin/python')
    lock=Path(__file__).with_name('intel-requirements.lock')
    options=['--require-hashes','--no-deps','--only-binary=:all:','--platform','macosx_26_0_x86_64','--implementation','cp','--python-version','311','--abi','cp311']
    run([py,'-m','pip','download',*options,'--dest',wheels,'-r',lock])
    site=OUT/'site-packages'
    if not site.exists():run([py,'-m','pip','install','--no-index','--find-links',wheels,*options,'--no-compile','--target',site,'-r',lock])
    provenance={'assets':[{'file':n,'url':u,'sha256':h} for n,u,h in ASSETS],'wheels':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in wheels.glob('*.whl')}}
    (OUT/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    print('Prepared isolated build inputs. No system installation performed.')
if __name__=='__main__':main()
