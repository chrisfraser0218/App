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

Keep React + TypeScript, Java Spring Boot, PostgreSQL, Python + FastAPI, and scikit-learn. Keep existing Vite, Tailwind, and Recharts. Phase 2B must use the native Homebrew PostgreSQL installation: do not introduce/use Docker or create a new PostgreSQL cluster. Reuse the already-existing isolated test environment for PostgreSQL tests; if it is unavailable, report that rather than initializing a cluster. Explain why a stack replacement is necessary and obtain the owner's approval before replacing any of these technologies. In particular, do not replace PostgreSQL with SQLite to simplify packaging.

## Network and local security

- Bind native development/application services to `127.0.0.1` wherever possible, including preview servers, Spring Boot, PostgreSQL, and FastAPI. Do not use LAN/public listeners, public tunnels, cloud proxies, or router forwarding.
- Container processes may need internal `0.0.0.0` listeners for container communication; any host port publication must explicitly bind `127.0.0.1`. This is not permission to expose the Mac's interfaces. Docker remains a development option, not the final application's runtime requirement.
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
- Phase 2C forecasts, Phase 2D bill calendar, desktop packaging, and commits remain unauthorized unless explicitly requested.

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
- Design automatic local backups, pre-upgrade backups, retention, integrity checks, and restore drills into the later persistence phase. A one-time verified backup/restore and persistent migration now exists; automatic backup scheduling/retention, complete offline acceptance, and desktop lifecycle automation do not. Do not claim those future capabilities are implemented.
- Keep updates, backups, models, and data local. A paid Apple Developer membership, cloud updater, or subscription must not become an operating requirement for this private app.

## Build/runtime safety

Build and verify a new executable before starting it. Do not overwrite/repackage a JAR that a running Java process is loading; stop the owned backend first or use a separate immutable build artifact. Replacing a loaded archive can break lazy class loading or shutdown. Database backup verification must still precede applying a new migration, and neither PostgreSQL cluster configuration nor the original stopped directory may be changed as a build shortcut.

## Delivery discipline

Preserve unrelated work. Do not deploy or make Git commits unless explicitly instructed. Run relevant local tests/builds and report only checks actually executed. Clearly identify untested behavior and remaining work. See [local operation and desktop plan](docs/local-operation.md), [database migration/recovery](docs/database-migration.md), [recurring transactions](docs/recurring-transactions.md), [architecture](docs/architecture.md), and [AI guide](docs/ai-categorization.md).
