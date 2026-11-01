"""Reuse existing maintenance semantics with an independently attested portable cluster."""
import os
from pathlib import Path
import backup_core as core
from backup_core import *
from portable_config import load, private_file

class Manager(core.Manager):
    def __init__(self, now=None):
        os.umask(0o077)
        self.base=Path(os.environ['FINSIGHT_DATA_HOME']).resolve()
        c=load(self.base)
        self.test=False
        self.expected_data=str(self.base/'postgres')
        self.sources=['finsight','postgres']
        self.root=private_dir(self.base/'backups');self.managed=private_dir(self.root/'managed');self.exports=private_dir(self.managed/'exports')
        self.tools=Path(__file__).resolve().parents[1]/'postgres/bin'
        self.env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','PGHOST':str(self.base/'run'),'PGPORT':str(c['port']),
                  'PGUSER':'finsight_admin','PGPASSWORD':c['adminPassword'],'PGCONNECT_TIMEOUT':'5','PGSSLMODE':'disable','PGTZ':'UTC','PGOPTIONS':'-c timezone=UTC','PGAPPNAME':'finsight-portable-backup'}
        self.now_override=now
    def status(self):
        value=super().status()
        value['launchdInstalled']=False
        value['schedulingScope']='while-application-is-running'
        return value

core.Manager=Manager
if __name__=='__main__':core.main()
