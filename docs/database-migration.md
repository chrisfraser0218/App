# PostgreSQL persistence migration — October 29, 2026

## Verified result

The active FinSight PostgreSQL cluster was migrated from `/tmp/finsight-pgdata` to:

`~/Library/Application Support/FinSight AI/postgres`

It uses Homebrew **PostgreSQL 15.17**, bound to **127.0.0.1:55432**. The original directory is retained and stopped; do not delete or restart it over the current endpoint. A separate Homebrew cluster under `/opt/homebrew/var/postgresql@15` was left untouched. Docker was not used for the migration.

The pre-cutover backup is:

`~/Library/Application Support/FinSight AI/backups/migration-20261029T184956Z-9fd9fc/`

All three non-template databases were backed up and restored: `finsight_demo`, `finsight_test`, and `postgres`. Standard `template0`/`template1` databases were identified; `template1` had no custom user tables and only the standard plpgsql extension, so system templates were initialized by PostgreSQL. There were no non-default tablespaces. Roles and configuration files were backed up separately. A new empty `finsight_local_maintenance` database was used to allow restoration of the source `postgres` database without dropping the destination's bootstrap database.

## Procedure actually executed

1. Identified the live PostgreSQL executable, directory, configuration, HBA rules, listener, database owners, templates, roles, tablespaces, and active clients.
2. Stopped only the identified FinSight Java writer and confirmed no other clients remained. The source PostgreSQL server remained available for read-only backup and verification.
3. Created owner-only backup storage, `pg_dumpall --globals-only`, custom-format `pg_dump --create` archives for all three databases, and copies of the original PostgreSQL configuration. Computed SHA-256 checksums and decoded every archive with `pg_restore --file /dev/null`.
4. Recorded private table counts and canonical row fingerprints, sequence states, and exact decimal per-account income/expense/opening/remaining balances. No personal records or balances were printed or stored in the repository.
5. Initialized a separate PostgreSQL 15 cluster in the new persistent directory. Staged it through an owner-only Unix socket on port 55433 with TCP disabled.
6. Restored global roles and every archive with error-on-failure enabled. Compared all **14 user tables** across the preserved databases, all sequence states, and every account's exact totals. Full row fingerprints covered transaction IDs, categories, accounts, users, model predictions/feedback, and Flyway history.
7. Created a database-scoped, non-superuser `finsight_app` login. Transferred only the personal application's database/schema/tables to it so future Flyway migrations can operate without cluster-superuser credentials. Restored original administrative roles and data remain intact. This deliberate ownership change does not change ledger contents. The extra bootstrap login was disabled.
8. Configured owner-only Unix sockets with peer administration and loopback SCRAM authentication for `finsight_app` only on `finsight_demo`. Stored generated credentials in owner-readable `backend.env` outside the repository. Other loopback logins are rejected.
9. Rechecked source and restored data before switching listeners. Stopped the verified staging server, then stopped the source. Started the persistent cluster on port 55432 and repeated data comparisons and authentication checks.
10. Started Java with the persistent credentials and privacy-conscious logging. Compared the read-only personal account API with the original exact totals. All preserved database fingerprints still matched. Regression writes/browser captures used a separately initialized synthetic cluster on port 55434, never the preserved databases.

## Local files and access

```text
~/Library/Application Support/FinSight AI/
  postgres/                 # Active PostgreSQL 15 cluster (owner only)
  run/                      # Owner-only Unix socket directory
  backend.env               # DB URL/user/password; mode 0600; never print/commit
  logs/                     # Restricted operational logs; payload/SQL debug disabled
  backups/
    migration-20261029T184956Z-9fd9fc/
      globals.sql
      finsight_demo.dump
      finsight_test.dump
      postgres.dump
      manifest.json
      restore-verification.json
      cutover-verification.json
      final-verification.json
      source-config/
```

The private manifest contains counts, row fingerprints, and exact balance comparison data; treat it as financial information. `restore-verification.json` and `cutover-verification.json` record the successful verification stages. `final-verification.json` records the final read-only data check. Do not copy these files into Git, CI, screenshots, or external services. Backups are local and restricted; backup encryption, Keychain integration, automatic schedules, retention, and a full restore UI are still future work.

## Start the existing persistent database

From the repository:

```sh
sh scripts/local-postgres.sh status
sh scripts/local-postgres.sh start
```

The helper targets only the existing persistent cluster, checks the PostgreSQL major version, and never runs `initdb`. It does not register a background service or implement desktop packaging. Its default tool location is `/opt/homebrew/opt/postgresql@15/bin`; set `FINSIGHT_PG_BIN` if the matching installed tools are elsewhere. `stop` refuses while application/database clients remain connected; stop the backend first.

Start the Java backend with **Java 21** and Maven available:

```sh
set -a
source "$HOME/Library/Application Support/FinSight AI/backend.env"
set +a
cd backend
mvn spring-boot:run
```

Do not print the environment or put its values in command arguments. Do not substitute Docker's default port 5432 or the retained `/tmp` cluster. The backend's private environment explicitly selects `finsight_demo` on 55432. Runtime developer tools used during verification were provisioned in `/tmp`; durable developer installations of Java 21, Maven, Node 22, and the Python environment are still prerequisites, not bundled desktop capabilities. This does not affect the durable database directory or backups.

Start the AI service separately:

```sh
cd ai-service
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

If the project virtual environment has not been prepared, follow the [AI guide](ai-categorization.md) to install its pinned requirements and train a local artifact. These are setup steps, not normal inference downloads. The already generated artifact remains under `ai-service/artifacts`. Start React with `cd frontend && npm run dev` and open http://127.0.0.1:5173.

## Verify an exact restore without exposing data

For a restored cluster that should still match the migration snapshot:

```sh
PGHOST="$HOME/Library/Application Support/FinSight AI/run" PGPORT=55432 \
python3 scripts/verify-database-backup.py \
  --backup "$HOME/Library/Application Support/FinSight AI/backups/migration-20261029T184956Z-9fd9fc"
```

The verifier checks archive/global checksums, the complete user-table set, counts and streamed canonical row digests, sequence states, and exact per-account balances. It only reads the database and prints aggregate pass/fail information. It deliberately fails once legitimate new transactions/predictions have changed the active data; use it against a fresh restore of this snapshot for later recovery drills. Do not mistake a later expected difference for permission to reset the live ledger.

## Recovery procedure

Recover into a **new, empty location**, never over the active cluster or retained original. Keep the damaged/current copy, available backups, and private environment intact. Stop application writers before any final cutover.

1. Select the intended timestamped backup and matching PostgreSQL 15 tools. Validate `globals.sql` and each `.dump` against SHA-256 values in the private manifest. Run `pg_restore --list` and `pg_restore --file /dev/null` for each archive; do not proceed if decoding/checksums fail.
2. Create a separate owner-only recovery data directory under Application Support and a short, owner-only recovery socket directory. Initialize PostgreSQL 15 with UTF-8/C locale and a **new bootstrap role name** not present in the archived globals (for example `finsight_recovery_admin`). Use a prompted bootstrap password, never a password in arguments. During restoration use private Unix sockets, TCP disabled, and a different port (for example 55435). Temporary local trust is acceptable only within that owner-only socket directory for this restore step.
3. Start the fresh recovery cluster with `pg_ctl -D "$RECOVERY_DATA" -o "-h '' -p 55435 -k '$RECOVERY_SOCKET'" -l "$RECOVERY_LOG" start`. Define these variables to your new local recovery paths; they are not the active `postgres/` path. All remaining restore commands must target this recovery socket/port, not 55432.
4. Connect as the new recovery administrator to `template1` and rename the new empty bootstrap `postgres` database to a unique maintenance name. This preserves an administrative connection target while the original `postgres` database is recreated. Do not rename/drop any existing financial database.
5. Restore `globals.sql` using `psql -X -v ON_ERROR_STOP=1 -h "$RECOVERY_SOCKET" -p 55435 -U finsight_recovery_admin -d "$MAINTENANCE_DB" -f "$BACKUP/globals.sql"`. Use a bootstrap role name absent from the globals so duplicate-role errors are not ignored.
6. For each of `finsight_demo.dump`, `finsight_test.dump`, and `postgres.dump`, execute `pg_restore --exit-on-error --create -h "$RECOVERY_SOCKET" -p 55435 -U finsight_recovery_admin -d "$MAINTENANCE_DB" "$BACKUP/<archive>"`. Do not use `--clean`, restore over nonempty databases, or ignore errors.
7. Run `scripts/verify-database-backup.py` against that recovery socket/port, with the restore administrator selected through `PGUSER`. It must report matching checksums, all 14 user tables, sequence states, and exact account totals. The original pre-migration globals do not include the `finsight_app` role created at cutover; the restored data initially retains the original owner's permissions.
8. Before application use, provision a non-superuser application role and transfer only the `finsight_demo` database, public schema/tables/sequences to it, as during migration. Set its password through `psql`'s interactive `\password` prompt (no plaintext password in history/arguments), and update the owner-only `backend.env` locally. Configure private peer administration and database-specific loopback SCRAM rules; disable the temporary bootstrap login and local trust rules. Do not blindly copy the archived temporary-directory `postgresql.conf`.
9. Explicitly configure the recovered cluster's permanent data/socket/log paths and loopback listener. Stop/drain writers, stop the current and staged clusters cleanly, switch the connection/listener only after verification, and rerun the verifier plus read-only API balance comparisons before resuming normal use. Preserve previous directories until recovery has been proven.

If any step fails, stop before overwriting or cutting over and retain both copies for diagnosis. Restarting `/tmp/finsight-pgdata` is only an emergency pre-migration snapshot option: it will not contain transactions posted after the verified cutover. Never silently revert to it or assume that a snapshot rollback preserves newer records.

## Scope and remaining work

This is a verified one-time backup, restore, persistent cutover, and manual recovery procedure. No automatic backup scheduler, retention deletion, desktop wrapper, LaunchAgent, deployment, database reset, or Phase 2B functionality was introduced. All regression fixtures must remain separate from `finsight_demo`, `finsight_test`, and `postgres` on port 55432, regardless of their names.

## Regression verification executed after cutover

- **33 backend tests passed** on H2 and independently on a newly initialized synthetic PostgreSQL 15 cluster. The three additional guard tests cover rejection of personal clusters and acceptance only of explicit local/CI verification storage. The guard runs before Spring creates application beans, Flyway, or the demo seeder.
- **12 frontend tests passed**, including suggestion acceptance, manual overrides, stale requests, and unavailable-model handling.
- **27 Python tests passed**. The synthetic training/evaluation rerun produced 45/45 correct classifications, offering 43/45 suggestions; no claim of real-world accuracy is implied. One upstream Starlette/httpx deprecation warning remains.
- Backend executable packaging and the optimized frontend build passed.
- Synthetic Chromium regressions checked 16 dashboard snapshots against independently summed ledger values, transaction creation/edit/deletion, AI suggestions/actual confidence, manual corrections, database feedback, unknown/stale input, mobile layout, and manual CRUD while the real AI process was stopped. The AI process was restarted afterward.
- The startup helper was executed: status/start work; start is idempotent; stop refuses active clients; missing data is never initialized. The reusable read-only backup verifier passed against the persistent cluster.
- Final personal-data verification remained read-only and matched the original snapshot. All financial comparison details are in the private backup manifests, not logs or screenshots. The isolated test server was stopped; normal frontend, Java, AI, and persistent PostgreSQL were left running.

Docker/remote CI were not executed, and developer runtimes/virtual environments provisioned temporarily during development are not a packaged or durable application installation. No automatic backup scheduler, data deletion/reset, deployment, commits, or Phase 2B features were introduced.

## Phase 2B V3 schema update

A newer backup at `~/Library/Application Support/FinSight AI/backups/phase2b-pre-v3-20261029T192555Z-378583/` was created and verified before installing V3. All four then-current non-template databases (including the empty maintenance database) were dumped, checksummed, decoded, restored as separate protected databases in the **existing** persistent cluster, and compared by full user-table fingerprints/counts, sequence states, and exact balances. Private `manifest.json` records the restore-copy mapping; `restore-verification.json`, `pre-v3-validation.json`, and `post-v3-verification.json` record the checks. No new cluster or Docker was used, and all copies are retained.

V3 created only recurring_rules, recurring_occurrences, recurring_prediction_feedback, and a successful Flyway entry. Existing financial tables and balances, other preserved databases, original Flyway rows, and PostgreSQL configuration files were verified unchanged. No personal schedules/payments were created. The personal endpoint and storage path remain 127.0.0.1:55432 and Application Support/postgres; startup and local credentials are unchanged. The original temporary cluster was not modified, deleted, or restarted.

The exact-restore verifier supports `--use-restored-copies` for the retained pre-V3 copies instead of comparing the upgraded active schema against the old table set. See [Phase 2B backup verification and recovery notes](recurring-transactions.md#database-migration). Never restore a pre-V3 archive over the active database to make a comparison pass.

## Phase 2C V4 upgrade

The authorized Phase 2C update was completed on the same native Homebrew PostgreSQL 15.17 cluster at `127.0.0.1:55432`, with data still under `~/Library/Application Support/FinSight AI/postgres`. Neither this configuration nor the stopped original `/tmp/finsight-pgdata` was changed.

Before migration, the owned application writer was stopped. A fresh backup was created at:

`~/Library/Application Support/FinSight AI/backups/phase2c-pre-v4-20261029T200833Z-51b8a4/`

All four source databases (`finsight_demo`, `finsight_test`, `postgres`, and `finsight_local_maintenance`) were archived, checksummed, completely decoded, and restored into separate protected databases **inside the existing persistent cluster**. Every restored row fingerprint/count, sequence state, and exact account balance matched. Previously retained financial restore copies were preserved, never treated as test fixtures. No new cluster, Docker, reset, deletion, or restore over an existing database was used.

The backup and retained restore copies were verified again immediately before installation. All four source snapshots still matched; no personal rule was due for catch-up. The final built executable was checked against the source V4 migration and configuration, then started with the existing private environment.

`V4__planned_transactions_and_forecast_preferences.sql` created only `planned_transactions` and `forecast_preferences`. V1–V3 SQL remains unchanged. Post-upgrade verification confirmed:

- Every pre-existing financial row fingerprint/count, transaction identity, sequence state, and exact balance matched the pre-V4 snapshot.
- Recurring rules/receipts and AI prediction/feedback data were preserved.
- Other source databases and all original Flyway history rows were unchanged.
- Only one successful V4 Flyway entry and the two **empty** tables were added. No personal plan, threshold, schedule, or payment was seeded.
- PostgreSQL configuration files were unchanged, and the original temporary cluster remained stopped.
- Read-only personal forecast checks for all five presets matched authoritative account balance, daily/monthly totals, and exact decimal arithmetic. The complete personal database fingerprint remained unchanged by those reads.

Private evidence is stored beside the archives: `manifest.json`, `restore-verification.json`, `pre-v4-validation.json`, `post-v4-verification.json`, `post-v4-snapshots.json`, and `forecast-readonly-verification.json`. These contain protected comparison data and must never be committed, logged, or screenshotted.

To reverify the retained exact pre-V4 restores without comparing the upgraded live schema to the old table set:

```sh
PGHOST="$HOME/Library/Application Support/FinSight AI/run" PGPORT=55432 \
python3 scripts/verify-database-backup.py \
  --backup "$HOME/Library/Application Support/FinSight AI/backups/phase2c-pre-v4-20261029T200833Z-51b8a4" \
  --use-restored-copies
```

Executed verification: **95 backend tests on H2 and independently on the existing isolated PostgreSQL cluster**, **54 frontend tests**, **27 AI tests**, executable backend packaging, and optimized frontend build. Synthetic Chromium checks covered 22 forecast/UI/data-integrity checks, existing recurring workflows, real local AI/manual categories, transaction editing/deletion and dashboard arithmetic, chart hover/monthly views, scenarios, plan completion/retries, mobile dark mode, and read-only database fingerprints. No personal database writes were used for testing. One existing upstream Python test-client deprecation warning remains.

Startup/credentials/ports are unchanged. See [local operation](local-operation.md) and [forecast methodology, contracts, and limits](balance-forecast.md). Recovery still requires a separate empty recovery destination and full verification before explicit cutover; never restore this pre-V4 snapshot over the live database or discard newer payments/plans to make an old fingerprint match. Automatic backup scheduling, retention cleanup, Phase 2D, and desktop packaging remain future work.

After verification, the synthetic browser API/frontend and isolated test server were stopped cleanly, retaining all their databases/data directories. Normal frontend (`127.0.0.1:5173`), personal backend (`127.0.0.1:8080`), local AI (`127.0.0.1:8000`), and persistent PostgreSQL were left running. Read-only proxy comparisons matched the personal account/plans/preferences/forecast endpoints, and AI health reported ready.

## Phase 2D read-only calendar update

Phase 2D introduces **no tables, database migration, configuration change, or seeded financial data**. Applied Flyway V1–V4 files/history are unchanged. No new pre-migration backup was required because no migration was applied; earlier restore-verified backups and protected restore copies remain intact.

Before replacing the backend executable, the owned personal writer was stopped and a fresh private integrity snapshot was captured for all four preserved source databases. Backend/H2/PostgreSQL regression writes and browser acceptance used only the existing isolated test cluster on 55434. A synthetic browser database was added within that cluster; no cluster was initialized. The original `/tmp/finsight-pgdata` was neither started nor modified. Personal PostgreSQL stayed on the same persistent directory and port.

After rebuilding/testing and restarting the personal API, read-only verification confirmed:

- Every pre-existing user-table fingerprint/count, sequence state, transaction identity, exact account balance, and Flyway history row matched the current pre-update snapshot.
- Recurring rules/receipts, plans/preferences/completion links, categories/users/accounts, and AI predictions/feedback were preserved.
- Other source databases and PostgreSQL configuration files were unchanged.
- Calendar daily projections and monthly income/expenses/ending balance matched the existing forecast exactly for current and future months. Historical months returned unavailable balances with an explanation.
- Calendar/forecast reads did not change personal records. Browser writes/screenshots used synthetic data only.

Owner-only private comparison evidence is at:

`~/Library/Application Support/FinSight AI/backups/phase2d-verification-20261030T110551Z/`

This folder holds integrity snapshots and a verification report, **not a recoverable database backup**. Recovery continues to use the existing timestamped full archives and the separate-restore verification procedure above; never overwrite current storage or discard newer payments/plans to match an older archive.

Executed tests: **123 backend on H2 and independently on isolated PostgreSQL**, **74 frontend**, **27 AI**, executable backend packaging, and optimized frontend build. Synthetic browser acceptance passed the five requested calendar scenarios with 18 checks and no runtime errors. Existing recurring/AI/reconciliation browser workflows and six legacy dashboard/manual/AI balance checks also passed. Final mobile calendar verification checked readable internally scrolling cells, no page overflow, and exact daily forecast equality with unchanged synthetic records. One existing upstream Python test-client deprecation warning remains.

Normal startup, credentials, storage, and ports are unchanged. The synthetic test server/processes are stopped after verification while retaining their data. See the [calendar guide](bill-calendar.md) for semantics and limits. Automatic backup scheduling, retention cleanup, Phase 2E/3 features, deployment, and macOS packaging remain unimplemented.

## Phase 2E backup/recovery update

Phase 2E adds no schema migration or database reset. Applied V1–V4 files/history, all canonical source records, and native PostgreSQL configuration are preserved. The original `/tmp/finsight-pgdata` remains stopped and untouched. Backup settings/history live in private filesystem metadata under `backups/managed`, independent of application schema health.

The first real managed backup is:

`~/Library/Application Support/FinSight AI/backups/managed/bkp-20261030113653-2c5d7c298326/`

It covers `finsight_demo`, `finsight_test`, `postgres`, and `finsight_local_maintenance`, plus globals and checksummed PostgreSQL configuration reference copies. Every native archive was decoded, checksummed, and checked for PostgreSQL 15 compatibility. Dump and metadata used matching exported snapshots. Full protected-copy restores were then compared against the manifest **and independently against the pre-update source inventories**, including every user-table fingerprint/count, exact account balance, and sequence state. All matched. These are retained protected financial copies in the existing persistent cluster, not automated-test fixtures. No new cluster, DROP, active restore, or PostgreSQL configuration change occurred.

The owner explicitly approved the backup-only per-user LaunchAgent. Its reviewed plist is installed at `~/Library/LaunchAgents/com.finsight.local-backups.plist`, loaded as `com.finsight.local-backups`, with a successful standalone invocation verified while the personal backend was stopped. The covered daily slot correctly produced no duplicate. It runs at login/load and checks every five minutes while the owner session/Mac/services are available; it starts no PostgreSQL or application services. The backend also checks on startup/every minute using the same lock/history. See [complete schedule, DST, sleep/offline-service semantics, and removal instructions](backup-recovery.md#approved-macos-launchd-backup-agent).

Safety: existing migration archives are outside managed retention. Safety copies, the last valid backup, and the latest fully restore-verified point remain protected. User-selected restore tests require confirmation and a new verified current safety backup, then create/verify only protected copies. Live replacement is unavailable; actual recovery still follows the separate-location verification and deliberate cutover procedure above. No backup or export encryption is implemented. Keep a verified disconnected SSD copy for protection against loss of the Mac itself.

Verification executed: **131 backend tests on H2 and independently on the existing isolated PostgreSQL cluster**, **86 frontend tests**, **35 backup-worker tests including six real native PostgreSQL integration cases**, **27 AI tests**, and both production builds. Native tests include source changes after the dump while shared-snapshot metadata remains consistent, restore corruption/failure, preservation, scheduling/catch-up/DST, safe retention, exports, permissions, redaction, and simulated SSD copies. Synthetic browser scenarios A–F passed ten acceptance checks, plus six legacy dashboard/manual/AI checks and final mobile/export-persistence checks, with no runtime errors. Real external hardware/encryption was not tested. One existing upstream Python test-client deprecation warning remains.

All personal verification remained read-only apart from explicitly authorized backup files/protected restore copies. No real financial payloads appear in source, test fixtures, logs, exports to external services, or screenshots. Test writes used only the existing isolated synthetic PostgreSQL environment. See [Backup & Recovery](backup-recovery.md) for API contracts, archive versus full-restore proof, SSD/export workflow, and known limitations. No Phase 3, desktop packaging, deployment, or commits were performed.

Final owner-only evidence is under `~/Library/Application Support/FinSight AI/backups/phase2e-verification-20261030T121003Z/` (integrity snapshots/report, not a separate database backup). Final real-browser acceptance also confirmed that Settings/archive checks remain usable after the isolated PostgreSQL server stops, and export downloads survive a scheduled no-op. Unused Spring Boot development-user/password generation is disabled; existing local host/origin restrictions still pass all tests. The synthetic servers were stopped with data retained, and normal personal frontend/backend/AI/PostgreSQL plus the approved backup-only LaunchAgent were restored/left running.

## Phase 3 — no schema migration

Spending Insights adds no table, column, Flyway migration or persistent analysis preference. Applied V1–V4 and native cluster configuration remain unchanged. Regression writes and screenshots use the existing isolated cluster's synthetic databases only; personal storage is checked with private canonical row/count/sequence/exact-balance manifests. There is no Phase 3 restore/cutover or database reset. Existing verified backups and the approved backup-only LaunchAgent remain intact. See [read-only analysis design](spending-insights.md).

Final Phase 3 verification on October 30, 2026 compared all four preserved source databases before/after: canonical rows, counts, sequences and exact account balances matched. PostgreSQL configuration and Flyway history also matched. Five real insight-filter responses through the normal frontend proxy independently matched exact SQL. Private manifests are retained in `~/Library/Application Support/FinSight AI/backups/phase3-verification-20261030T125416Z/`. No financial payloads were added to the checkout. The original cluster remains stopped; the isolated test cluster was cleanly stopped with its data retained.
