# FinSight AI — permanent development requirements

These instructions apply to the entire repository and all future development. The owner established this architecture on October 29, 2026. These requirements supersede older project suggestions about cloud hosting, AWS deployment, multi-user services, or paid integrations. Do not relax them without an explicit change from the owner.

## Product and operating boundary

- FinSight AI is a private, single-user personal finance application running exclusively on the owner's MacBook.
- All application services, financial records, models, inference, forecasting, and service-to-service communication stay on that MacBook.
- Normal operation must work without internet access. Do not introduce runtime downloads, external AI calls, remote databases, cloud hosting, external fonts/assets, telemetry, analytics, or remote service dependencies.
- Initial dependency installation and intentional development updates may need internet access; that must not become a normal-operation requirement. Never transmit financial records during development either.
- Operating cost must remain $0 per month. Use free/local/open-source technology. No paid APIs, API keys for paid services, cloud subscriptions, paid database/authentication hosting, or recurring licensing requirements.
- Source-only CI may use isolated synthetic fixtures, but application use and verification must not depend on remote CI. Never give CI personal data, backups, database connections, or financial screenshots; do not require paid CI features.

## Preserve the stack

Keep React + TypeScript, Java Spring Boot, PostgreSQL, Python + FastAPI, and scikit-learn. Keep existing Vite, Tailwind, and Recharts. Development must use the native Homebrew PostgreSQL installation: do not introduce/use Docker or create a new PostgreSQL cluster. Reuse the already-existing isolated test environment for PostgreSQL tests; if it is unavailable, report that rather than initializing a cluster. Explain why a stack replacement is necessary and obtain the owner's approval before replacing any of these technologies. In particular, do not replace PostgreSQL with SQLite to simplify packaging.

## Network and local security

- Bind native development/application services to `127.0.0.1` wherever possible, including preview servers, Spring Boot, PostgreSQL, and FastAPI. Do not use LAN/public listeners, public tunnels, cloud proxies, or router forwarding.
- Do not introduce or use Docker for the MacBook application or verification. Preserve the existing native Homebrew PostgreSQL configuration and existing isolated test cluster. Legacy container files are not authorization to replace them.
- Preserve host/origin validation, restrictive cross-origin rules, input validation, timeouts, and server-selected ownership. Localhost alone is not authentication or protection from other local processes/websites.
- Design appropriate local controls: least-privilege database roles, owner-only filesystem access, locally managed secrets, and narrowly scoped local API access. No paid or hosted identity provider is needed for this single-user product.
- Keep financial writes and precise calculations in Java/PostgreSQL; the AI service must not access the database directly. Suggestions remain optional and never override a user's manually chosen category.

## Protect existing records

- Treat the existing database as personal data even if its name, UI, or account says demo/test. Do not assume it is disposable or still contains only seeded examples.
- Never reset, recreate, truncate, drop, reseed, or delete the user's database/volume during an update. Never use `docker compose down -v`, volume pruning, `DROP DATABASE`, or equivalent cleanup against personal storage.
- Preserve transaction IDs, balances, categories, model feedback, recurring rules, and future user records through versioned migrations. Never rewrite applied Flyway migrations to repair an upgrade.
- Keep data in persistent local storage outside the checkout and application bundle. The active native cluster is `~/Library/Application Support/FinSight AI/postgres` on `127.0.0.1:55432`. This persistent cutover has been verified; never silently switch it to a fresh Docker/default database. Private credentials are in `~/Library/Application Support/FinSight AI/backend.env`; never print or commit that file.
- The original `/tmp/finsight-pgdata` is stopped and retained after a verified migration. Do not delete, reinitialize, test against, or silently restart it. The authoritative data is now the persistent cluster above. Verified pre-cutover backups, checksums, and private integrity manifests are under `~/Library/Application Support/FinSight AI/backups/migration-20261029T184956Z-9fd9fc/`. That snapshot does not contain future writes; reverting to it requires an explicit recovery plan. All three restored databases (`finsight_demo`, `finsight_test`, `postgres`) must be preserved regardless of their names. See `docs/database-migration.md` for startup, verification, and safe recovery.
- Never run automated tests or destructive test fixtures against the personal/demo database. Use an explicitly isolated test database with synthetic data. Backend PostgreSQL tests require database `finsight_verification` in the already-existing `/tmp/finsight-isolated-verification-12473ab7c796/postgres` cluster on loopback 55434 (or source-only CI's ephemeral test environment); retain the pre-startup isolation guard and never bypass it to test personal storage. Do not alter personal records merely to perform verification.
- Do not include real financial information in logs, screenshots, issue/PR bodies, source files, test fixtures, model datasets, or Git commits. Disable payload/SQL-result debug logging when personal data is present; inspect metadata rather than dumping records. Capture screenshots only from an isolated synthetic fixture.
- Do not train on or export personal feedback implicitly. Keep future reviewed-label processing local and intentional.

## Phase 2B installed behavior and data protection

- V3 adds recurring_rules, recurring_occurrences, and recurring_prediction_feedback without altering existing financial tables. Never rewrite applied V1/V2/V3 migrations.
- The fresh restore-verified pre-V3 backup is `~/Library/Application Support/FinSight AI/backups/phase2b-pre-v3-20261029T192555Z-378583/`. Protected restore-copy database names are in its private manifest; never use those financial copies as test fixtures or delete them as cleanup.
- A permanent `(rule_id, occurrence_date)` receipt, a schedule row lock, and one atomic ledger/receipt/cursor transaction guarantee idempotent posting. Receipts survive transaction deletion. Do not remove these protections or regenerate deleted/handled occurrences.
- Support all six frequencies, month-end clamping without duplicate twice-monthly dates, yearly leap-day behavior, and a configurable injectable-clock business time zone (default America/New_York).
- Future-only edits preserve history; resume skips paused dates; cancel retains all posted entries. Manual reconciliation is explicit and never infers duplicates or silently deletes/rewrites a payment.
- Recurring expense AI suggestions retain manual category control. Definition feedback is separate from ordinary transaction feedback; no automatic retraining or AI dependency in the posting worker.
- No personal schedules or transactions were seeded during V3 installation. Verify any future schema update against a new restore-verified local backup before applying it to the personal database.
- Phase 2C forecasting is authorized and implemented. Phase 2D bill calendar is authorized and implemented. Phase 3, desktop packaging, deployment, and commits remain unauthorized unless explicitly requested.

## Current development priorities

Continue improving the browser-based application, preserving Phase 1 and Phase 2A behavior. Prioritize in this order:

1. Recurring income and expenses.
2. Automatic, idempotent recurring transaction processing.
3. Future balance forecasting.
4. Interactive bill calendar.
5. Accurate financial calculations.
6. Automated testing of these behaviors and existing functionality.

Use precise decimal money, explicit calendar/time-zone semantics, and deterministic tests. Keep forecast entries separate from posted ledger entries. Plan for missed occurrences while the app is closed and safe catch-up on reopening; never duplicate postings on retries or restarts. Local AI failure must not prevent budgeting or ledger writes.

## Backups and future desktop packaging

- Do not implement desktop packaging during Phases 2B–2D. Do not introduce Tauri scaffolding, Rust sidecars, installers, LaunchAgents, or autostart changes in those phases.
- After the prioritized browser features, implement automatic local backups and tested restoration; then pursue desktop packaging. Design new features so both remain possible.
- Evaluate Tauri as a candidate, not an already approved framework replacement. Keep the current frontend, Java API, Python ML service, and PostgreSQL.
- The final app must launch from Applications, start and supervise its necessary local services automatically, and close normally without requiring VS Code, Terminal, manual Docker startup, or manual database/Java/Python startup.
- Future packaging must bundle/provision compatible local runtimes and models, manage PostgreSQL safely, coordinate readiness/migrations/recurring catch-up, handle crashes and ports, and shut down only processes it owns without losing data.
- Design automatic local backups, pre-upgrade backups, retention, integrity checks, and restore drills into the later persistence phase. A one-time verified backup/restore and persistent migration now exists; Phase 2E now adds local backup scheduling/retention and isolated restoration verification. Complete offline desktop acceptance and desktop lifecycle automation remain future work.
- Keep updates, backups, models, and data local. A paid Apple Developer membership, cloud updater, or subscription must not become an operating requirement for this private app.

## Build/runtime safety

Build and verify a new executable before starting it. Do not overwrite/repackage a JAR that a running Java process is loading; stop the owned backend first or use a separate immutable build artifact. Replacing a loaded archive can break lazy class loading or shutdown. Database backup verification must still precede applying a new migration, and neither PostgreSQL cluster configuration nor the original stopped directory may be changed as a build shortcut.

## Delivery discipline

Preserve unrelated work. Do not deploy or make Git commits unless explicitly instructed. Run relevant local tests/builds and report only checks actually executed. Clearly identify untested behavior and remaining work. See [local operation and desktop plan](docs/local-operation.md), [database migration/recovery](docs/database-migration.md), [recurring transactions](docs/recurring-transactions.md), [architecture](docs/architecture.md), and [AI guide](docs/ai-categorization.md).

## Phase 2C installed behavior

- V4 adds only `planned_transactions` and `forecast_preferences`; never rewrite applied V1–V4 migrations. Preserve open/completed/canceled plans, completion links/receipts, and threshold versions in future migrations/backups.
- Forecasts/scenarios must be read-only snapshot calculations using authoritative actual balance and Phase 2B `RecurrenceDates` plus persisted cursors/receipts. Never call the posting worker, write default preferences, send model requests, or persist hypothetical/forecast entries to the ledger from a forecast read.
- Use the shared injectable business clock, exact BigDecimal values/decimal-string forecast responses, inclusive daily closing balances, and explicit overdue assumptions. Keep input horizons/event counts bounded.
- Plans never auto-post. Completion requires explicit RECORD (due only), LINK (with mismatched-amount confirmation), or HANDLED. Preserve stable request IDs, row/version locks, unique payment links, and completion history even if a linked actual payment is deleted. Do not silently reopen completed plans or infer duplicate payments.
- What-if state stays transient. Threshold persistence is an explicit versioned user action. Preserve actual/projected distinctions, manual categories, existing recurring catch-up, and all AI functionality.
- See [forecast semantics and contracts](docs/balance-forecast.md). Pre-V4 backup: `~/Library/Application Support/FinSight AI/backups/phase2c-pre-v4-20261029T200833Z-51b8a4/`. Its private manifest maps retained protected restore copies; never use these financial copies as test databases or delete them as cleanup.

## Phase 2D calendar behavior

- Calendar composition is read-only and adds no tables/migrations. Reuse ForecastService for exact balances/flows/warnings and Phase 2B scheduling/receipts; never generate an independent occurrence or money calculation engine.
- Preserve one recorded row per actual payment, including dual recurring/plan links. Completion/handled/canceled markers on scheduled dates do not add cash again. Never recreate removed/handled receipts.
- Past balances are unavailable because the opening balance is undated; show recorded history and explain the limitation. Never label future projections actual or infer missing historic amounts/categories from today's schedule.
- Reuse the existing plan/schedule mutation APIs, idempotency/version/confirmation controls, and manual categories. Calendar reads must never process due dates or mutate personal storage. Independent recurring worker behavior remains unchanged.
- Query/return the selected month, carrying the existing forecast forward only as necessary. Keep local business dates, decimal strings, response bounds, ownership checks, abort/stale-response handling, keyboard navigation, and usable mobile scrolling.
- See [Bill Calendar semantics, API, tests, and limitations](docs/bill-calendar.md). Phase 2E backups/recovery are now authorized and implemented. Do not implement Phase 3 or desktop packaging without a new request.

## Phase 2E backup/recovery protections

- Preserve the stdlib local worker, native PostgreSQL 15 tools, private snapshot manifests, shared `flock`, atomic progress/history, and matching dump/metadata exported snapshots. Never replace this with live directory copies or remote services.
- Managed storage is `~/Library/Application Support/FinSight AI/backups/managed`. Retention applies only to verified managed bkp-* folders. Never prune legacy migration archives, safety backups, the final valid backup, or the latest fully restore-verified point without newer full proof. Protected restored databases are never test fixtures or automatic cleanup targets.
- Daily/missed scheduling is frontend-independent via backend startup/poll or the backup-only LaunchAgent `com.finsight.local-backups`, explicitly approved, installed and loaded in Phase 2E. Routine checks/reloads within that approved behavior need no new approval. Never introduce additional persistent services or expanded behavior without owner approval. Polling/launchd cannot back up a powered-off Mac; detect missed slots when services return.
- Restore From Backup is isolated verification only: explicit selection/confirmation, archive checks, verified current safety backup, new protected database names, full row/count/balance checks. Live replacement remains unavailable; follow the documented deliberate recovery/cutover procedure. Never DROP an existing database or restore over active data.
- All backups/exports are unencrypted by this app. Keep owner-only permissions, secrets out of args/logs, safe IDs/paths, local-only endpoints, JSON/origin checks, and exact decimal exports. Do not claim encryption or hardware-loss protection from copies on the same disk. External SSD copies are optional, checksummed, and never justify local deletion.
- Preserve all four canonical source databases and all financial records through backup/restore tests. Test mode is restricted to the existing isolated cluster and synthetic storage; never bypass the database isolation guard or allow an HTTP request to change database/tool locations.
- See [backup/recovery semantics and approval-controlled launchd behavior](docs/backup-recovery.md). Phase 3 and desktop packaging remain outside scope.
