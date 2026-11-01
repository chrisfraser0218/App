"""Private distribution identity. Never imports or adopts the owner's legacy storage."""
import json, os, re, stat
from pathlib import Path

DATA_NAME = 'FinSight AI Portable'
FORMAT = 'finsight-portable-v1'

def data_home(profile=None):
    if profile:
        path = Path(profile).absolute()
        private_file(path)
        base = Path(json.loads(path.read_text())['dataHome']).absolute()
        if not str(base).startswith(('/tmp/finsight-portable-test-', '/private/tmp/finsight-portable-test-')):
            raise ValueError('Portable verification requires isolated temporary storage')
    else:
        base = Path.home() / 'Library/Application Support' / DATA_NAME
    if base.is_symlink() or base.resolve() != base.absolute():
        # /tmp is an OS symlink on macOS; only that canonicalization is accepted for tests.
        if not profile or base.is_symlink() or base.resolve() != Path(str(base).replace('/tmp/', '/private/tmp/', 1)):
            raise ValueError('Unsafe portable data directory')
    if base.exists() and (base.stat().st_uid != os.getuid() or base.stat().st_mode & 0o077):
        raise ValueError('Portable data must be private and owned by this user')
    return base.resolve()

def private_file(path):
    if path.is_symlink() or not path.is_file(): raise ValueError('Private installation file required')
    mode=path.stat()
    if mode.st_uid != os.getuid() or stat.S_IMODE(mode.st_mode) & 0o077:
        raise ValueError('Installation file must be owner-only')

def load(base):
    if base.name == 'FinSight AI': raise ValueError('Legacy personal storage is forbidden')
    private_file(base/'installation.json')
    config=json.loads((base/'installation.json').read_text())
    if config.get('format') != FORMAT or not re.fullmatch('[a-f0-9]{32}', config.get('id','')):
        raise ValueError('Unknown installation identity; refusing initialization')
    if config.get('dataHome') != str(base.resolve()): raise ValueError('Installation location changed; deliberate recovery required')
    if type(config.get('port')) is not int or not 1024 <= config['port'] <= 65535 or config['port'] in (5432,55432,55434):
        raise ValueError('Invalid private database port')
    for field in ['adminPassword','appPassword']:
        if not re.fullmatch('[a-f0-9]{64}',config.get(field,'')): raise ValueError('Invalid installation secret')
    if config.get('phase') not in ('initializing','database-ready','ready'):raise ValueError('Invalid initialization state')
    return config
