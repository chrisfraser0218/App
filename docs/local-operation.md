# Permanent local operation and future macOS application

Status: permanent architecture and future desktop plan, with a verified one-time native PostgreSQL backup/restore and persistent migration. No desktop launcher is implemented; Phase 2E now provides approved automatic local backups. The owner established this direction on October 29, 2026; it replaces previous cloud/AWS and public multi-user deployment suggestions. Repository-wide instructions are in [AGENTS.md](../AGENTS.md).

## Operating contract

FinSight AI is a private, single-user application on one MacBook, with $0 monthly operating cost. Financial records, recurring processing, forecasting, categorization, model training, and service communication remain local. Normal use must work offline, with no paid APIs, remote databases, telemetry, hosted authentication, CDN assets, or model downloads at launch. Dependency installation and intentional development updates are separate from normal application use.

Preserve React/TypeScript, Java/Spring Boot, PostgreSQL, Python/FastAPI, and scikit-learn. Any stack replacement needs an explanation and the owner's approval. Use native Homebrew PostgreSQL; Docker is prohibited for current development and verification.

## Current state and gaps

| Area              | Present implementation                                                     | Required later work                                                                                                           |
| ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Browser UI        | React/Vite; loopback dev server; local assets                              | Keep browser workflow through Phases 2B–2D; package built assets later                                                        |
| Java API          | Loopback by default; local PostgreSQL; bounded AI requests                 | Desktop-managed compatible Java runtime, lifecycle, readiness, and local access controls                                      |
| AI service        | Local saved scikit-learn pipeline; no database client                      | Bundle/provision Python and numerical libraries, trusted model artifact, architecture compatibility; no runtime pip/downloads |
| PostgreSQL        | Existing native persistent Homebrew cluster on loopback 55432 | Persistent cluster selected and verified; future desktop-managed PostgreSQL with safe upgrades and shutdown                   |
| Records           | Versioned Flyway migrations preserve existing data                         | One-time verified backup/restore and cutover complete; recurring backup policy and restore UX remain                          |
| Local security    | Host/origin checks, authenticated sessions/CSRF and account-scoped ledger access  | Explicit local threat model, least-privilege roles, owner-only storage, secrets and session protection                        |
| Backups           | Phase 2E local scheduler/retention/verified restore copies                     | Continue verified local backups; desktop lifecycle integration remains later work                   |
| Offline use       | Existing assets and model are local once installed/trained                 | Formal acceptance with networking disabled for budgeting, recurring processing, forecasts, and AI                             |
| Desktop lifecycle | No desktop wrapper or service supervisor                                   | Start from Applications, supervise services, catch up recurring work, and quit normally                                       |

Native listeners must bind to `127.0.0.1`. Use the existing Homebrew installation and existing isolated test cluster; do not introduce Docker. Never expose the application to the LAN or public internet. Loopback binding does not protect against all local applications or hostile browser origins, so preserve the documented local authentication/session and native bridge controls. Optional source CI must use synthetic data only and is not a runtime dependency or a destination for financial information.

### Existing data must remain intact

The active Homebrew PostgreSQL 15.17 cluster is now `~/Library/Application Support/FinSight AI/postgres` on `127.0.0.1:55432`. A full restore was verified before cutover; all table rows, sequence states, and exact account totals match the preserved snapshot. The original `/tmp/finsight-pgdata` is stopped and retained, not a test database or a rollback destination for newer writes. All three source databases were preserved. A separate Homebrew cluster was left untouched.

Verified archives, original configuration, checksums, and private integrity manifests are in `~/Library/Application Support/FinSight AI/backups/migration-20261029T184956Z-9fd9fc/`. Use `sh scripts/local-postgres.sh start` and source `~/Library/Application Support/FinSight AI/backend.env` before starting Java. The private environment contains SCRAM credentials for a database-scoped non-superuser; native administration uses the owner-only Unix socket with peer authentication. Do not print or commit it.

The [migration and recovery guide](database-migration.md) documents the executed procedure, database and AI startup, a reusable read-only verification command, and restoration into a separate empty recovery cluster. Never reset the active data, switch to a new empty default database, or run destructive tests against any restored database. A one-time backup is not an automatic backup policy.

The current persistent layout is outside the application bundle and repository:

```text
~/Library/Application Support/FinSight AI/
  postgres/       # Private PostgreSQL cluster
  backups/        # Local database backups and manifests
  backend.env     # Generated local credentials; mode 0600
  run/            # Owner-only PostgreSQL Unix socket
  logs/           # Operational metadata only, no financial payloads
```

The postgres, backups, logs, run directories and backend.env are provisioned. Model artifacts currently remain in ai-service/artifacts; their later desktop-managed location is still planned. Use owner-only permissions, a dedicated database role, and locally generated credentials stored through an appropriate macOS secret facility such as Keychain. Separate test data/storage from personal data. Replacing or uninstalling the app must not silently erase financial records or backups. Do not collect financial descriptions, amounts, balances, feedback text, or SQL results in application/debug logs. The backend now explicitly suppresses web/JDBC payload and Hibernate SQL/bind logging, and the private runtime environment disables debug mode. Keep financial payloads out of any future diagnostic features.

## Tauri assessment

Tauri is a promising candidate for the later shell: macOS uses the system WKWebView, and the existing React UI can remain the presentation layer. This avoids replacing the application stack. WKWebView compatibility must be tested; current Chromium verification alone does not establish desktop compatibility. See [Tauri webview documentation](https://v2.tauri.app/reference/webview-versions/).

Tauri supports bundling and launching external binaries as sidecars. That offers a possible route for local service launch, but it does not automatically package a Java runtime, Python/scikit-learn environment, or PostgreSQL distribution or manage their data. Those are additional engineering responsibilities. See [Tauri sidecar documentation](https://v2.tauri.app/develop/sidecar/).

Recommendation: keep Tauri on the shortlist and evaluate it in a dedicated packaging phase after Phases 2B–2D and local backup/restore work. A small Rust lifecycle supervisor could be an additional packaging component; business logic, ledger storage, and model inference remain in the existing services. No Rust/Tauri dependency or desktop scaffolding is introduced now.

Tauri capability controls can constrain desktop commands and sidecar execution; any shell/filesystem permissions must be narrowly scoped. A desktop origin will differ from Vite's current origin, so plan a restricted IPC or authenticated loopback bridge and review Spring's host/origin rules, rather than broadly allowing CORS or shell execution. See [Tauri capabilities](https://v2.tauri.app/security/capabilities/).

For a private, locally built app, evaluate a local/ad-hoc signing path and its macOS security prompts. Do not introduce an Apple Developer subscription or notarized public-distribution requirement into the $0 operating model. Ad-hoc signing has a different trust/installation experience; smooth installation on other people's Macs is outside this single-Mac requirement. See [Tauri macOS signing guidance](https://v2.tauri.app/distribute/sign/macos/). This assessment does not claim signing or packaging has been tested here.

## Future service-management work

The final Applications launch should start only the app's owned processes, with no Terminal, IDE, package manager, or Docker interaction:

1. Resolve persistent paths, a single-instance lock, and safe local port allocation. Never terminate an unrelated process or overwrite an existing cluster to resolve a conflict.
2. Locate the bundled/provisioned Java, Python, numerical libraries, PostgreSQL tools, and model. Verify compatibility and bundled license notices, including Apple Silicon versus Intel support decisions. No runtime dependency downloads.
3. Start the owned local PostgreSQL instance; verify readiness and identity. Back up before schema changes once the backup subsystem exists, then run forward migrations. First-run initialization must occur only for a genuinely new data directory; never reseed an existing user's records.
4. Start Java and FastAPI on loopback, wait for readiness with bounded waits, and then display the React UI. Preserve manual transaction entry if optional AI is unavailable.
5. Process recurring occurrences missed while the app was closed, using deterministic, idempotent posting keys. Reopening, retries, and crashes must not duplicate financial transactions. No assumption of always-running cloud workers or background daemons.
6. On quit, stop scheduling and drain in-flight writes before shutting down owned Java/Python processes and then PostgreSQL cleanly. Handle failed starts, crashes, force-quit recovery, sleep/wake, and concurrent launches without losing records. Do not shut down a database owned by another application.

Evaluate an app-owned supervisor first. Any later LaunchAgent or background scheduling choice needs a clear lifecycle design; it is not part of Phases 2B–2D. The packaged UI should have native-feeling macOS window/menu behavior and usable startup/error states without requiring the owner to troubleshoot services in Terminal.

## Backup and restore design for the later persistence phase

After the prioritized browser features, implement local automatic backups and restoration before desktop cutover:

- Use PostgreSQL-supported consistent backups, such as `pg_dump` plus necessary database-role/configuration metadata; do not copy a live data directory as if it were a consistent backup.
- Trigger local backups on a documented schedule and before migrations/updates. Write to a temporary file, verify success and a manifest/checksum, then finalize atomically. Never upload backups or require a paid storage service.
- Keep version/timestamp metadata, a configurable retention policy, and at least one verified recoverable backup. Do not silently delete the last valid recovery point on rotation failure. Protect backup files as financial data; any encryption keys must also have a local recovery strategy.
- Restore into a separate temporary verification database, never on top of the only live copy. Validate schema, transaction identities/counts, decimal totals, categories, recurring state, and prediction feedback without logging financial payloads.
- Before relocating a cluster, create and verify a local backup, restore into a separate persistent destination, compare results locally, stop/drain writers for a final consistent cutover, and retain the original until recovery is proven. Do not silently overwrite a nonempty destination.
- Test failed backups, insufficient disk space, incompatible PostgreSQL versions, interrupted migrations, and failed restores. A backup file existing is not proof it can be restored.

A one-time full backup/restore and data relocation has now been executed and verified; see the migration report. The automatic schedule, retention cleanup, backup encryption, Keychain integration, and full restore UX described here remain future work. No automatic backup guarantees should be inferred from a successful one-time migration.

## Browser roadmap and acceptance

Phases 2B–2D stay browser-based. Prioritize recurring income/expenses, automatic idempotent posting, future balance forecasting, an interactive bill calendar, accurate calculations, and automated tests. Keep forecast occurrences distinct from committed ledger entries and document local date/time-zone and recurrence rules. The verified one-time database migration is complete. Automatic backup scheduling follows these features; desktop packaging follows safe persistence and restoration.

Future acceptance must include: cold launch from Applications without an IDE/Terminal/Docker; fully offline budgeting/AI/forecasting; loopback-only listeners; missed-recurring catch-up without duplicates; accurate decimal balances; normal quit/reopen; recovery after crashes and upgrades; successful verified local restore; and no financial payloads in logs/screenshots/source. Do not claim any of these unimplemented desktop or backup behaviors already work.

## Phase 2B update

Recurring income/expenses and automatic exactly-once catch-up are now installed; see [recurring behavior and API](recurring-transactions.md). V3 was applied to the unchanged native persistent PostgreSQL cluster only after a fully verified backup/restore. The new private backup is `~/Library/Application Support/FinSight AI/backups/phase2b-pre-v3-20261029T192555Z-378583/`; separate restore-copy databases were created inside the existing cluster and retained. No new cluster, Docker, paid service, or PostgreSQL configuration change was introduced. The original `/tmp/finsight-pgdata` remains stopped and untouched.

Normal startup commands are unchanged. The worker runs locally on backend readiness and every 30 seconds, with bounded catch-up and durable occurrence receipts, so the services need not run continuously. The frontend also processes due dates on opening/reconnect. Paused dates are skipped on resume; canceled schedules preserve history. Deterministic balance forecasts are now available in Phase 2C; an interactive calendar remains deferred.

For PostgreSQL regression tests, reuse the already-existing isolated test cluster on 55434, never a preserved/restore-copy financial database. Do not initialize another cluster or relax test isolation guards. Startup/restart and concurrency verification used synthetic data only. Existing financial record fingerprints and exact balances matched the backup after V3; all three new tables were empty at installation. Automatic backup scheduling and desktop lifecycle automation are still future work.

When developing updates, stop the owned API before replacing the executable JAR it is loading, build/verify first, and then restart. Do not overwrite a live JAR while running Maven packaging. This does not require stopping or reinitializing PostgreSQL; preserve the existing cluster and verify a fresh backup before schema migrations.

## Phase 2C operation

Open `http://127.0.0.1:5173/#forecast` after the same native PostgreSQL/backend/frontend startup above. No extra service, dependency, Docker, or internet is required for forecasts. Python AI remains optional for existing categorization. Forecast reads do not process recurring dates; the existing independent startup/poll worker continues its usual catch-up. Plans never auto-post, even after reopening: explicitly complete, link an actual payment, or mark handled. See [forecast behavior and limits](balance-forecast.md).

V4 adds planned-transaction/preference storage on the same persistent cluster/port without changing PostgreSQL configuration. The fresh verified backup is `~/Library/Application Support/FinSight AI/backups/phase2c-pre-v4-20261029T200833Z-51b8a4/`; retained restore copies and private verification manifests are documented in the [V4 migration report](database-migration.md#phase-2c-v4-upgrade). Keep backups and credentials owner-only. Recovery follows the existing procedure: restore and verify into separate recovery storage, never overwrite the current database, and account for newer writes before cutover. Automatic backups/desktop lifecycle are still future work.

## Phase 2D operation

Open `http://127.0.0.1:5173/#calendar` using the same local PostgreSQL/backend/frontend startup. No new service, dependency, table, migration, or persistent database change is required. Calendar reads use the shared forecasting/recurrence engines; existing independent recurring catch-up continues. Calendar-created plans require explicit completion or linking before affecting actual balance. Historical balances are not invented. See [calendar behavior, API, and verification](bill-calendar.md).

Keep regression writes/screenshots in the existing isolated synthetic environment. Do not use personal storage or retained restore copies as fixtures. Phase 2E automatic backups and macOS packaging are still future work.

## Phase 2E local backup operation

The existing Java backend now checks the configured daily backup slot on readiness/every minute, with no frontend requirement. The stdlib Python maintenance worker uses the existing private native PostgreSQL socket/admin role and checks cluster identity/tool compatibility. No new database table, migration, cloud dependency, or desktop supervisor is introduced. Native services/startup remain unchanged; settings are at `/#settings`.

Managed data is under `backups/managed`, with private schedule/history/lock and verified archives. Existing migration/verification folders remain protected. The backup-only LaunchAgent was prepared/reviewed, explicitly approved, then installed and loaded for the owner. Future persistent-service changes still require approval. It never starts PostgreSQL or application services. Powered-off/asleep/missing-service intervals are caught up on the next available invocation. See [backup guide](backup-recovery.md) for timing, paths, approval instructions, retention, SSD copies, and failure behavior.

Live restoration is unavailable; the UI performs confirmed isolated copy verification after a verified current safety backup. Actual recovery still requires the separate verified cutover procedure. Archive encryption, Keychain integration, automated deletion of protected restore copies, and desktop packaging are not implemented. Keep verified backups periodically on a disconnected SSD; copies on the same Mac do not protect against hardware loss.

## Phase 3 operation

Open `http://127.0.0.1:5173/#insights` with the same local PostgreSQL/Java/Vite startup. Start the existing FastAPI service on `127.0.0.1:8000` for optional robust spending detection; it uses no new trained artifact. Summaries, comparisons, recurring analysis and manual entry remain usable when AI is unavailable. No new service, dependency, schema migration, financial write, persistent schedule or database configuration change is introduced. Existing independent recurring and backup workers continue unchanged. See [Spending Insights](spending-insights.md) for exact date/normalization semantics, offline evaluation and synthetic-only acceptance checks.

## Phase 4 operation

Open `http://127.0.0.1:5173/#assistant` using the same native services. The deterministic assistant has no LLM/runtime/download requirement and needs no migration. Existing optional Python statistics remain useful for unusual-spending questions; all core questions work offline with Java/PostgreSQL. Chat remains in page memory only. No new persistent service or PostgreSQL configuration change was made. See [supported questions, local model assessment, security and tests](financial-assistant.md). Optional model/runtime installation needs explicit owner approval; none was installed.

## Phase 5 operation

Open `http://127.0.0.1:5173/#savings` with the same native services. Goals are a separate allocation book; current bank balances and cash-flow forecasts keep their existing calculations. Optional contribution intentions are never automatic ledger transfers. V5/V6 require the fresh restore-verified pre-upgrade backup documented in [database migration](database-migration.md); do not start an upgrade against personal data without verifying it. Backup/export includes the savings tables. See [savings semantics and verification](savings-goals.md). No new persistent service or PostgreSQL configuration is introduced, and Phase 6 packaging is deferred.

## Phase 6 native desktop operation

The owner has now authorized desktop packaging. The selected wrapper is Swift AppKit/WKWebView, preserving all existing services and using bundled copies of the already-installed runtimes; Tauri/Electron were evaluated rather than assumed. See [macOS packaging](macos-packaging.md) for the comparison, installation, startup/shutdown, offline acceptance and security details.

Double-click `/Applications/FinSight AI.app` after installation. It serves built React assets through bundled Java on loopback 18480 and local AI on 18481. It uses the unchanged existing PostgreSQL cluster on 55432, refusing safely if it is stopped until automatic startup is approved, and never creates a replacement. No development web server/Terminal/IDE is needed to display the app while that database is running. The unchanged backup agent still requires its established global Python/repository/Homebrew paths. PostgreSQL intentionally remains running for the same approved backup-only LaunchAgent after the app drains its owned Java/Python services. Credentials, records, backups and versioned runtime copies stay under persistent Application Support. Earlier future-packaging discussion is historical.
## Phase 6B account access

The compatible application opens at **Welcome to FinSight AI**. Create a personal login to start with an empty $0.00 book; add your own categories explicitly. The existing legacy/demo book is preserved separately and locked until the Mac owner runs `python3 scripts/configure-legacy-login.py` in an interactive local terminal to choose its credentials. Passwords are never provided through chat, arguments or source files. Logging out or restarting services discards the session, not financial records. See [local account authentication](account-authentication.md).

The V7 upgrade requires the fresh full backup, protected restore test and preservation checks in `scripts/apply-account-authentication.py`; it must not run as an automated test against personal storage. Keep a compatible Phase 6B desktop build with the V7 schema. PostgreSQL management and the existing backup LaunchAgent are unchanged.
