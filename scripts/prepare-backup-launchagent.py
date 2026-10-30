#!/usr/bin/env python3
"""Generate a reviewable per-user launchd definition. Never install/bootstrap a persistent service."""
import argparse
import os
from pathlib import Path
import plistlib
import sys

def prepare(output, python, worker, data_home, pg_bin):
    for path in [python,worker,pg_bin/'pg_dump']:
        if not path.is_absolute() or not path.is_file():raise ValueError('Use existing absolute runtime/tool paths')
    output.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if output.exists():raise ValueError('Refusing to overwrite an existing definition')
    value={'Label':'com.finsight.local-backups','ProgramArguments':[str(python),str(worker),'tick'],
           'RunAtLoad':True,'StartInterval':300,'StartCalendarInterval':{'Hour':2,'Minute':0},
           'ProcessType':'Background','LowPriorityIO':True,'ThrottleInterval':60,'Umask':63,
           'StandardInPath':'/dev/null','StandardOutPath':str(data_home/'logs/backup-agent.log'),
           'StandardErrorPath':str(data_home/'logs/backup-agent-error.log'),
           'EnvironmentVariables':{'FINSIGHT_DATA_HOME':str(data_home),'FINSIGHT_PG_BIN':str(pg_bin)}}
    with output.open('xb') as f:plistlib.dump(value,f)
    output.chmod(0o600)
    return value
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--python',type=Path,default=Path(sys.executable));p.add_argument('--worker',type=Path,default=Path(__file__).resolve().with_name('backup_manager.py'));p.add_argument('--data-home',type=Path,default=Path.home()/'Library/Application Support/FinSight AI');p.add_argument('--pg-bin',type=Path,default=Path('/opt/homebrew/opt/postgresql@15/bin'));a=p.parse_args();prepare(a.output,a.python,a.worker,a.data_home,a.pg_bin);print('Prepared only: '+str(a.output)+'. No service installed or loaded.')
