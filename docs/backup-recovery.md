# Automatic local backups and recovery — Phase 2E

Open **Settings → Backup & Recovery** at `http://127.0.0.1:5173/#settings`. All work stays on this Mac using Python's standard library and the existing Homebrew PostgreSQL 15 tools. No new Python/npm/Maven dependency, database table, migration, cloud service, paid API, or desktop wrapper is required. Existing Phase 2D changes remain intact.

## What is protected

Native custom-format `pg_dump --create` archives preserve all four current source databases: `finsight_demo`, `finsight_test`, `postgres`, and `finsight_local_maintenance`. This includes users, accounts, exact transaction amounts/dates, categories, predictions/feedback, recurring rules/permanent receipts, planned transactions/completion links, preferences, and Flyway history. Protected restore-copy databases are deliberately excluded from daily sources, but never deleted.

Each database dump and its table fingerprints/counts/exact account balances use the **same exported REPEATABLE READ snapshot**, held open until both finish. Financial writes may continue; the backup is consistent as of that snapshot. Separate databases have separate snapshots, not a fictional cross-database atomic timestamp. Current PostgreSQL configuration copies are also checksummed for recovery reference; they are never applied to the running cluster. Global roles are saved separately with `pg_dumpall --globals-only`. Sequences are preserved by native `pg_dump`; their counters are not MVCC snapshots, so new managed manifests compare their restored names rather than falsely claiming snapshot-exact source counters during concurrent writes. Older quiescent migration manifests retain their explicit sequence-state checks.

Backup files are **unencrypted**. PostgreSQL compression and SHA-256 are not encryption. Owner-only directories (0700), files (0600), safe IDs/paths, private Unix-socket peer administration, and redacted errors protect local access. Database passwords are never passed in command arguments or emitted in status/logs. Unused Spring Boot development-user/password auto-generation is disabled; existing local host/origin restrictions remain enforced. Roles/globals and manifests contain sensitive information and belong outside Git. There is no public backup-file download route. Manual financial exports are explicit, local downloads with no-store responses.

Local copies on the same Mac cannot protect against loss, theft, fire, or failure of that Mac's storage. Periodically disconnect a verified external SSD copy. Encryption evaluation: macOS FileVault and an intentionally configured encrypted APFS external volume can protect storage at rest without subscriptions. This application does not create/format/encrypt a drive or manage encryption/recovery keys, and makes no encryption claim. Archive-level encryption is deferred until a local key-recovery design is approved.

## Directories and runtime configuration

```text
~/Library/Application Support/FinSight AI/backups/
  migration-*/ phase2b-*/ phase2c-*/ phase2d-verification-*/  # Preserved, never retention targets
  managed/
    settings.json          # Versioned schedule, retention, optional external path
    operation.lock         # flock shared by Java-triggered and standalone workers
    operation.json         # Atomic progress/success/failure state
    history.json           # Backup/verification/failure/retention audit metadata
    bkp-<UTC timestamp>-<random>/
      <database>.dump      # Native complete archive for each source DB
      globals.sql
      manifest.json        # SHA-256, snapshot fingerprints/counts, exact balances
      manifest.sha256
      verification.json
      restore-copy-mapping.json  # Where applicable; protected copies are retained
    restore-<random>.json   # Full restore-test report/mapping
    exports/               # Explicit JSON or ZIP containing CSV files; private, unencrypted
```

Only `managed/bkp-*` directories created/verified by this worker are retention candidates. Legacy migration backups, safety backups, unknown directories, failed partials, and the final valid backup are protected. Failed `.partial-*` directories remain for private diagnosis and do not count as successful backups. Retained restore-copy databases and failed partials need deliberate later storage review; there is no automatic destructive cleanup of them.

Normal operation uses the owner-only native socket `~/Library/Application Support/FinSight AI/run`, port 55432, and the logged-in Mac owner's peer-administration role. Application TCP credentials remain private in `backend.env`; the backup worker does not read or print them. It checks `SHOW data_directory`, server major 15, and matching tool versions before operations. It never initializes a PostgreSQL cluster, starts the retained original, changes PostgreSQL configuration, applies global roles to the running cluster, or drops a database.

Spring properties: `FINSIGHT_BACKUP_ENABLED` (default true; controls the backend's polling), `FINSIGHT_BACKUP_PYTHON` (default `python3`), `FINSIGHT_BACKUP_SCRIPT` (default `../scripts/backup_manager.py` from backend working directory), and `FINSIGHT_BACKUP_POLL_MS` (default 60000). Use an existing compatible Python 3.9+ interpreter with zoneinfo; the installed Python 3.11 is used in verification. `FINSIGHT_DATA_HOME` selects Application Support, and `FINSIGHT_PG_BIN` selects the matching native PostgreSQL 15 bin directory. Future packaging can supply stable absolute runtime/script paths. Never replace a JAR still loaded by a running backend.

## Daily scheduling and missed work

Defaults: enabled, **02:00 America/New_York**, 7 daily periods, 4 weekly periods, 3 monthly periods, full isolated restore test every 7 days, external-copy reminder after 7 days. Settings persist in private files outside the database, so recovery controls remain accessible when financial queries fail.

The Java API checks on application readiness and every minute, independently of the frontend. A standalone `tick` command uses the same settings, logic, history, and nonblocking filesystem lock. It identifies the most recent scheduled slot (including yesterday before today's configured time), checks verified backup creation times, and creates **one fresh backup** for a missed slot. It does not fabricate historical snapshots for days when no backup could run. Manual backups after a scheduled slot cover that slot. Repeated fall-back times use the first occurrence; nonexistent spring times roll forward through the DST gap, with no duplicate daily job. Retries after failures are delayed 15 minutes; jobs never overlap across Java/CLI processes. Closing the browser does not stop the backend worker.

A backup job performs archive verification, safe retention, and a periodic isolated restore test when due. This automatic validation restores only fresh verified archives into protected copies; it never replaces active data. A requested restore test of a selected backup additionally requires confirmation and a new verified current-data safety backup. Local backup success remains distinct from an optional external-copy or full-test failure; history shows both.

### Approved macOS launchd backup agent

A per-user **LaunchAgent**, not a system daemon, is prepared with label `com.finsight.local-backups`. The prepared machine-specific definition is `/tmp/finsight-backup-launchd/com.finsight.local-backups.plist`; `plutil -lint` validates it. The generator `scripts/prepare-backup-launchagent.py` only prepares a file; it never installs or bootstraps anything.

Its reviewed behavior:

- Runs the absolute local Python interpreter and repository `scripts/backup_manager.py tick` as the logged-in owner. It starts no frontend, Java, AI, PostgreSQL, installer, or desktop service supervisor.
- Checks every 5 minutes, on login/load, and at the default 02:00 calendar event. The worker's configured time remains authoritative, so schedule changes need no plist edits. Backend checks can run within a minute of the chosen time; closed-app checks can lag by up to five minutes.
- Uses background/low-priority I/O, umask 077, `/dev/null` input, and safe metadata-only logs under Application Support/logs. No password is in the plist.
- Requires the Mac to be awake, the owner session loaded, and native PostgreSQL/runtime/tools available. It does not wake or power on the Mac. launchd coalesces eligible sleep-time events on wake; the worker independently detects missed slots. A powered-off/logged-out Mac cannot run this agent; the next available invocation/backend startup catches up.
- Shared `flock` prevents duplicate jobs if Java and launchd trigger together. Existing data is never reset to resolve readiness failures.

The owner explicitly approved installation during Phase 2E. The reviewed definition is installed at `~/Library/LaunchAgents/com.finsight.local-backups.plist` (0600) and loaded for the current GUI session. A successful standalone invocation was verified while the personal Java backend was stopped; its daily slot was already covered, so it correctly created no duplicate. Routine checks/reloads of this unchanged approved definition are within the approved scope. Obtain approval for additional persistent services or behavior beyond that approval. To install a reviewed definition once approved, copy the reviewed plist to `~/Library/LaunchAgents/com.finsight.local-backups.plist` (0600) and bootstrap it with `launchctl bootstrap gui/$(id -u) <absolute-plist-path>`. Inspect with `launchctl print gui/$(id -u)/com.finsight.local-backups`. Removing it later requires bootout of that exact owned label, then removing only that definition; this must not delete backups or PostgreSQL data. Repository/Python paths must remain installed; this is not a standalone packaged app. The Settings page reports whether that label is actually loaded.

## Verification and retention

A file existing is insufficient. Every successful backup has checksummed archives/globals/manifest, `pg_restore --list` compatibility checks for PostgreSQL 15, complete archive decoding with `pg_restore --file /dev/null`, and snapshot metadata. Writes stage under a unique temporary directory; only verified entries appear as successful history. Low-space preflight leaves old backups intact. A failed operation retains old valid backups and reports failure rather than overwriting the only good copy.

**Archive verification** detects missing/corrupted files, mismatched checksums, unsafe names/symlinks, unexpected/missing application databases, and incompatible archive headers. It works without a running database, using the local PostgreSQL 15 restore tool, but does not prove that a server can recreate all objects.

**Full restore verification** creates brand-new `finsight_backup_verify_<random>` databases in the existing local cluster, uses `pg_restore --exit-on-error --no-owner --no-privileges`, then compares every expected table's complete row fingerprint/count and exact account balances, plus sequence metadata. The source databases stay unchanged. These protected financial copies are retained and must never be automated-test fixtures or cleanup targets. New clusters and active overwrites are not used. Legacy archives can be validated/restored through the same UI where their existing manifest is complete; old files/manifests are not modified. A compatibility/metadata failure blocks restoration.

Retention preserves the configured daily count of most recent successful versions as a recent-undo window, including multiple manual versions in one day. It also selects the latest backup in each of the configured recent calendar days, ISO weeks, and calendar months, keeping their union. Multiple versions remain available across periods; manual versions within the same period may be retired once superseded. Integrity is checked before deletion; a newer verified backup must exist. Corrupt/failed entries are not evidence that an older valid copy may be deleted. Safety and legacy copies remain pinned. The latest fully restore-verified backup is also retained until newer full restore proof exists. Exports and protected test-restore databases are not pruned automatically.

## Restore and recovery

**Restore From Backup** shows the selected archive/date and the risk of replacing newer records. The action available in Phase 2E is **Confirm isolated restore test**:

1. Validate archive checksums, expected databases, metadata, and PostgreSQL compatibility.
2. Require explicit user confirmation.
3. Create and verify a safety backup of current source databases.
4. Restore into newly named protected copies; never `--clean`, DROP, or overwrite a source.
5. Compare complete rows/counts and exact balances and retain a private report/mapping.

**Replace active database is unavailable.** This is intentional: the running Java/recurring worker and connection pool must not be pointed at an archive restore in place. For actual disaster recovery, follow [the existing verified separate-location recovery/cutover procedure](database-migration.md#recovery-procedure): preserve current files, select the intended timestamp, validate archives, restore roles/data into separate empty recovery storage, verify against the chosen manifest, provision least-privilege local application credentials, stop/drain writers, then deliberately cut over after reviewing newer records. Do not execute that procedure as an acceptance test or restore an older archive over the sole current copy. Existing recovery instructions prohibit live overwrite; new recovery-cluster provisioning is a separately supervised disaster-recovery action, not ordinary Phase 2E operation.

Verify new managed archives from the CLI with JSON input and no financial output:

```sh
python3 scripts/backup_manager.py status
printf '%s' '{"backupId":"<listed backup ID>"}' | python3 scripts/backup_manager.py verify
```

A routine standalone check is `python3 scripts/backup_manager.py tick`. Keep PostgreSQL running; normal operations need no internet. Do not point commands at `/tmp/finsight-pgdata` or use an old archive to erase newer records.

## External SSD workflow

1. Create/select an existing directory on your mounted SSD, for example `/Volumes/My SSD/FinSight Backups`, and save it in Settings. Do not use a local directory that merely resembles a missing mount.
2. Connect periodically and choose **Copy verified backups to external drive**. The worker validates each archive again, copies to a unique staged directory under `FinSight AI Backups`, verifies every copied file's SHA-256, then publishes the copy atomically. Existing different files are never overwritten.
3. Confirm the last-successful-copy timestamp, then eject/disconnect normally. Repeat before the configurable overdue reminder expires.

Mount availability, device identity, and native diskutil local/external hardware metadata are checked during copying. Network volumes, internal disks and disk images are refused; unsupported disk metadata is treated as unavailable. a disconnection leaves local archives untouched and reports failure. A missing drive never prevents budgeting/local backups. Available destinations can receive an automatic verified copy after a scheduled backup. Copying does not delete local archives or format/erase a drive. Tests use simulated temporary destinations; no physical external SSD is assumed present.

## Manual exports

**Export JSON** prepares one versioned file with owned transactions, categories, accounts, recurring schedules/receipts, planned transactions and preferences. Monetary decimals remain strings, dates remain ISO, and savings data is explicitly unavailable because that feature does not exist yet. **Export CSV bundle** prepares a ZIP of CSV files for those entities, with exact decimal text; formula-like description/name text is prefixed with an apostrophe for spreadsheet safety. JSON retains the original text.

Downloads are local sensitive plaintext. The private prepared copy remains under managed/exports; the browser controls its downloaded location. Neither export includes complete PostgreSQL schema/roles/constraints/AI database history, so **exports are not substitutes for full database backups**. They cannot be used as restore archives. No export is sent to an external service.

## Tests and remaining limits

Executed verification: **131 backend tests on H2 and isolated PostgreSQL, 86 frontend tests, 35 worker tests including six native integration cases, and 27 AI tests**, both production builds, and synthetic browser acceptance scenarios A–F. The first real managed archive was fully restore-verified against independent pre-update financial fingerprints and sequence states. Run backend/frontend/AI checks as documented in the README. The stdlib worker unit suite is `python3 -m unittest discover -s scripts/tests -v`. Native integration is opt-in and requires the existing guarded isolated PostgreSQL environment; it must never use personal storage or retained restore copies. Integration checks cover real archive/restore preservation, source writes after the dump using a shared snapshot, corruption/failed restoration, scheduling/catch-up, exact exports, and verified simulated SSD copies. Browser scenarios A–F use synthetic financial data only.

Limitations: live replacement remains unavailable; existing Java/JPA startup still requires PostgreSQL, so if the API cannot start use offline CLI archive validation and the documented recovery procedure (running Settings can handle a later database outage); the approved LaunchAgent runs only in the owner's loaded session; powered-off/asleep/unavailable-service intervals cannot be backed up at their original time; physical SSD and disk-level encryption are not acceptance-tested; protected restore databases/failed partials/exports need manual storage review; no automatic cloud/offsite copy exists. Keep a disconnected verified SSD copy for hardware-loss protection. Phase 3 AI insights and desktop packaging are not implemented.
