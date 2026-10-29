#!/usr/bin/env python3
"""Read-only verification of a migration backup against a restored PostgreSQL database.

No credentials or row values are printed. Connection uses normal local libpq environment.
The output report contains only pass/fail counts. The manifest remains private financial data.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def psql(tool, db, statement):
    result = subprocess.run(
        [str(tool), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', db],
        input=statement, capture_output=True, text=True,
        env=dict(os.environ, PGTZ='UTC', PGCONNECT_TIMEOUT='5'),
    )
    if result.returncode:
        raise RuntimeError('Read-only database query failed; details withheld to protect financial data')
    return result.stdout


def verify(backup, pg_bin, use_restored_copies=False):
    manifest = json.loads((backup / 'manifest.json').read_text())
    globals_path = backup / 'globals.sql'
    if hashlib.sha256(globals_path.read_bytes()).hexdigest() != manifest['globals_sha256']:
        raise RuntimeError('Globals backup checksum mismatch')
    table_count = 0
    for db, archive in manifest['archives'].items():
        if hashlib.sha256((backup / archive['file']).read_bytes()).hexdigest() != archive['sha256']:
            raise RuntimeError('Database backup checksum mismatch')
        expected = manifest['snapshots'][db]
        target_db = manifest.get('restore_mapping', {}).get(db) if use_restored_copies else db
        if not target_db:
            raise RuntimeError('No verified restore mapping is recorded for this backup')
        tables = json.loads(psql(pg_bin / 'psql', target_db, "SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema' ORDER BY schemaname,tablename) x;"))
        actual_names = {identifier(t['schemaname']) + '.' + identifier(t['tablename']) for t in tables}
        if actual_names != set(expected['tables']):
            raise RuntimeError('Restored user-table set differs from backup')
        for name, fingerprint in expected['tables'].items():
            # Streams records through memory into a digest; no financial rows are output or saved.
            statement = f'SELECT to_jsonb(t)::text FROM {name} t ORDER BY to_jsonb(t)::text COLLATE "C";'
            process = subprocess.Popen(
                [str(pg_bin / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', target_db],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=dict(os.environ, PGTZ='UTC', PGCONNECT_TIMEOUT='5'),
            )
            process.stdin.write(statement.encode()); process.stdin.close()
            digest = hashlib.sha256(); count = 0
            for row in process.stdout:
                digest.update(row); count += 1
            process.stderr.read()
            if process.wait() or {'rows': count, 'sha256': digest.hexdigest()} != fingerprint:
                raise RuntimeError('Restored table count/content differs from backup')
            table_count += 1
        sequences = json.loads(psql(pg_bin / 'psql', target_db, "SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%') x;"))
        if {identifier(s['schemaname']) + '.' + identifier(s['sequencename']) for s in sequences} != set(expected['sequences']):
            raise RuntimeError('Restored sequence set differs from backup')
        for name, state in expected['sequences'].items():
            if psql(pg_bin / 'psql', target_db, f'SELECT last_value,is_called FROM {name};').strip() != state:
                raise RuntimeError('Restored sequence state differs from backup')
        if expected['balances']:
            balances = json.loads(psql(pg_bin / 'psql', target_db, """SELECT COALESCE(json_agg(x ORDER BY id),'[]'::json) FROM (
                SELECT a.id::text,a.user_id::text,a.starting_balance::text,
                  COALESCE(SUM(t.amount) FILTER (WHERE t.type='INCOME'),0)::text AS income,
                  COALESCE(SUM(t.amount) FILTER (WHERE t.type='EXPENSE'),0)::text AS expenses,
                  (a.starting_balance + COALESCE(SUM(t.amount) FILTER (WHERE t.type='INCOME'),0) - COALESCE(SUM(t.amount) FILTER (WHERE t.type='EXPENSE'),0))::text AS balance
                FROM accounts a LEFT JOIN transactions t ON t.account_id=a.id AND t.user_id=a.user_id
                GROUP BY a.id,a.user_id,a.starting_balance) x;"""))
            if balances != expected['balances']:
                raise RuntimeError('Exact restored account totals differ from backup')
    print(f'PASS: backup checksums, {len(manifest["archives"])} restored databases, {table_count} user tables, sequence states, and exact account totals match.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--use-restored-copies', action='store_true', help='Read the retained verification databases named in the private manifest instead of active source databases')
    parser.add_argument('--pg-bin', type=Path, default=Path('/opt/homebrew/opt/postgresql@15/bin'))
    args = parser.parse_args()
    try:
        verify(args.backup, args.pg_bin, args.use_restored_copies)
    except Exception as error:
        # Never include rows, connection strings, or secrets in failure output/tracebacks.
        print('FAIL: ' + (str(error) if isinstance(error, RuntimeError) else 'Verification could not complete; inspect local configuration privately'), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
