#!/usr/bin/env python3
"""One-time, interactive local-owner credential setup. Never reads passwords from arguments or files."""
import os
from pathlib import Path
import sys

def main():
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise SystemExit('Run this command in your local Terminal; password input stays hidden.')
    root=Path(__file__).resolve().parents[1]
    sys.path.insert(0,str(root))
    from desktop.supervisor import load_env
    base=Path.home()/'Library/Application Support/FinSight AI'
    from backup_manager import Manager
    Manager().check_database()  # Owner-level storage attestation; do not broaden app-role privileges.
    configuration=load_env(base/'backend.env')
    release=base/'desktop/current'
    jar=release/'backend.jar';java=release/'java/bin/java'
    # Development fallback uses the reviewed build, never downloads or installs a runtime.
    if not jar.is_file() or not java.is_file():
        jar=root/'backend/target/finsight-api-0.1.0.jar'
        java=root/'desktop/build/FinSight AI.app/Contents/Resources/java/bin/java'
    if not jar.is_file() or not java.is_file():
        raise SystemExit('A verified Phase 6B build is required first.')
    if configuration.get('DB_URL') not in ('jdbc:postgresql://127.0.0.1:55432/finsight_demo','jdbc:postgresql://localhost:55432/finsight_demo'):
        raise SystemExit('Refusing an unexpected personal database endpoint.')
    environment=dict(os.environ,**configuration)
    os.execve(str(java),[str(java),'-Dloader.main=com.finsight.LocalCredentialTool','-cp',str(jar),
                        'org.springframework.boot.loader.launch.PropertiesLauncher'],environment)

if __name__=='__main__':main()
