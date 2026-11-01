#!/usr/bin/env python3
"""Validate and archive an existing generated app. Never installs or launches it."""
import argparse,hashlib,json,plistlib,shutil,subprocess,tempfile
from pathlib import Path
from build import ROOT,validate,digest

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--app',type=Path,default=ROOT/'dist/portable-current/desktop/build/FinSight AI.app');args=parser.parse_args();app=args.app.resolve()
    if not app.is_relative_to(ROOT/'dist') or app.name!='FinSight AI.app':raise SystemExit('Only generated distribution output is accepted')
    resources=app/'Contents/Resources';manifest=json.loads((resources/'manifest.json').read_text())
    if manifest.get('distribution')!='portable-v1' or manifest.get('architecture')!='x86_64':raise SystemExit('The requested Intel portable build is required')
    report=validate(app,'x86_64')
    for name,sha in manifest['payloadFiles'].items():
        file=resources/name
        if not file.resolve().is_relative_to(resources) or digest(file)!=sha:raise SystemExit('Payload differs from build manifest; revalidate before packaging')
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    destination=ROOT/'dist/FinSight-AI-Installer.dmg'
    if destination.exists():raise SystemExit('Existing installer retained; rename it deliberately before building another')
    staging=Path(tempfile.mkdtemp(prefix='portable-dmg-',dir=ROOT/'dist'));image=staging/'image';image.mkdir()
    shutil.copytree(app,image/'FinSight AI.app',symlinks=True);(image/'Applications').symlink_to('/Applications')
    for name in ['INSTALL-FINSIGHT-AI.md','MACOS-DISTRIBUTION.md']:shutil.copy2(ROOT/'docs'/name,image/name)
    subprocess.run(['/usr/bin/hdiutil','create','-volname','FinSight AI Installer','-srcfolder',str(image),'-format','UDZO',str(destination)],check=True)
    subprocess.run(['/usr/bin/hdiutil','verify',str(destination)],check=True)
    mount=staging/'mounted';mount.mkdir()
    subprocess.run(['/usr/bin/hdiutil','attach','-readonly','-nobrowse','-mountpoint',str(mount),str(destination)],check=True)
    try:
        copied=mount/'FinSight AI.app';subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(copied)],check=True)
        if digest(copied/'Contents/Resources/manifest.json')!=digest(resources/'manifest.json'):raise RuntimeError('Disk-image manifest mismatch')
        if not (mount/'Applications').is_symlink():raise RuntimeError('Applications shortcut missing')
    finally:subprocess.run(['/usr/bin/hdiutil','detach',str(mount)],check=True)
    assessment=subprocess.run(['/usr/sbin/spctl','--assess','--type','execute','--verbose=2',str(app)],capture_output=True,text=True)
    report.update(architecture='x86_64',version=manifest['version'],buildId=manifest['buildId'],declaredMinimumMacOS=info['LSMinimumSystemVersion'],dmgBytes=destination.stat().st_size,dmgSha256=digest(destination),dmgVerified=True,mountedBundleSignatureVerified=True,signing='ad-hoc',notarized=False,gatekeeperAssessmentExit=assessment.returncode,gatekeeperAccepted=assessment.returncode==0,physicalIntelMacVerified=False,cleanMachineVerified=False)
    (ROOT/'dist/portable-installer-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Candidate Intel installer:',destination);print('Bytes:',report['dmgBytes']);print('SHA-256:',report['dmgSha256']);print('Physical Intel/clean-machine acceptance remains unverified.')
if __name__=='__main__':main()
