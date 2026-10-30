# Phase 6B completion report — October 30, 2026

Implementation, V7 migration and explicitly approved local Applications installation are complete. Final installed-bundle native/browser acceptance and normal-startup access-control verification passed. Phase 7 has not begun.

## 1. Features implemented

- Welcome, Create Account, Log In, confirmation/password validation, authenticated navigation, visible desktop/mobile Log out, and light/dark styling.
- Local username-only registration, with no email or external service.
- Empty account initialization and explicit user-owned category creation.
- Session expiration handling, financial-component/context disposal, stale-response protection and explicit retry after a rejected CSRF nonce. Financial writes are never automatically replayed.
- No production sample-data seeder, shared demo password or unauthenticated demo bypass.

## 2. Database migration

V7 makes email optional and adds normalized unique username, a username-format constraint and credential version. It changes no financial table or ownership value, supplies no password and seeds nothing. Original V1–V6 files/checksums/history remain intact.

The owner explicitly approved retaining every pre-existing record together under the original legacy/demo user/account. Migration ran without application writers, only after a fresh full native safety backup and protected restoration succeeded. Earlier safe refusals occurred before DDL while correcting restricted-role endpoint attestation; no privileges were broadened or financial records changed. All safety backups/copies were retained.

The active cluster remains the existing PostgreSQL 15.17 cluster at `127.0.0.1:55432`, under Application Support. No cluster, database or financial table was reset, dropped, truncated, reseeded, replaced or switched to a default/Docker database.

## 3. Authentication architecture

Spring Security enforces authenticated sessions on every financial, insight, assistant, prediction, backup and export API. `CurrentIdentity` derives ownership from the verified backend principal. Client account/user IDs are not accepted as ownership. Login creates no financial history; server-selected UUIDs and ownership constraints remain authoritative.

The independently authorized recurring worker uses explicit internal per-account scopes over persisted schedule owners. It does not adopt a client ID or the last login. Existing locks, receipts, atomic posting/cursor transactions and backup scheduling remain independent of frontend login.

## 4. Password hashing

Standard Spring Security Argon2id: 19,456 KiB memory, two iterations, parallelism one, 16-byte random salts and 32-byte hashes. Bouncy Castle 1.86 is bundled as a free Java build dependency. Passwords are never stored in plaintext, logged, exported as financial data or placed in renderer storage. Long passwords are supported without truncation. Two concurrent hash operations and a global 30-attempt/minute login/registration limit bound expensive work; unknown/incorrect login errors are generic.

## 5. Session management

Server-memory sessions use host-only, HttpOnly, SameSite=Strict cookies, cookie-only session tracking, session-ID/CSRF rotation at authentication, logout invalidation, 30-minute idle expiry, 12-hour absolute authentication age and credential-version revalidation. CSRF synchronizer tokens protect mutations, including authentication actions. Native cookies remain in the ephemeral native URLSession; the separate native per-launch service secret is retained.

Cookies intentionally lack Secure on the existing plain loopback HTTP transport; no TLS claim is made. Auth tokens/passwords do not enter localStorage. Service restart requires login again and preserves records. Automated expiration checks cover invalidation, configured idle timeout and absolute expiry; a real 30-minute idle wait was not performed.

## 6. Account isolation verification

Synthetic tests cover owned transactions/categories/starting balances, recurring schedules/receipts, plans, forecast preferences/projections, calendar, savings goals/entries/schedules/corrections, insights, assistant evidence/context and financial exports. Foreign record IDs and injected ownership fields are rejected. Calculations retain Java BigDecimal/PostgreSQL semantics and existing actual/projected distinctions.

Export owner is captured from the server session before background dispatch. Downloads require matching private ownership metadata; another account's export status/history/result is hidden. JSON/CSV financial exports exclude users/password hashes. Global full-backup maintenance remains shared Mac-owner administration; no HTTP route exposes raw full archives or private financial manifests.

## 7. Empty account verification

Real synthetic registration through backend APIs, browser UI and WKWebView produced exactly one new USD account at `0.00`, with no categories, transactions, recurring records, plans, stored forecast preferences, savings records, prediction/feedback data or financial/assistant history. No demo data was copied. Explicit synthetic income/expense entry produced the expected exact balance, and records persisted across logout/login and native restart.

The agent did not choose or create real personal credentials or seed personal fixtures. Choose **Create Account** in FinSight to create the owner's personal book, or **Log In** if already registered independently.

## 8. Legacy/demo preservation

Private full-row fingerprints/counts, exact balances, exact sequence states and original user-column/Flyway projections matched before/after the active migration. An independent recheck matched every recorded existing database snapshot and protected configuration. All canonical databases, pre-existing protected restore copies, transaction/category IDs, balances, feedback, schedules/cursors/receipts, plans/completions, preferences and savings history were retained. The original stopped cluster was not restarted or altered. The application role remains restricted; PostgreSQL configuration and the backup LaunchAgent definition are unchanged.

The legacy identity stays locked until the owner deliberately chooses local credentials. Run in an interactive local terminal from the repository:

```sh
python3 scripts/configure-legacy-login.py
```

Password input is hidden. The wrapper verifies preserved storage using existing owner-level maintenance access; the Java tool uses application-role-compatible database/loopback checks, not privileged global settings. It initializes only unconfigured legacy authentication metadata and changes no financial records. No shared password was supplied. After choosing credentials, make a full backup through Settings so the new hash is included in a current recovery point.

## 9. Automated test results

| Check executed locally | Result |
| --- | --- |
| Backend, guarded native PostgreSQL verification database | 274 passed; zero failures/errors/skips |
| Backend, existing H2 test profile | 273 passed; one PostgreSQL-only role case skipped; zero failures/errors |
| Frontend | 139 passed |
| Python AI service | 45 passed; one existing upstream Starlette/httpx deprecation warning |
| Backup worker, including opt-in native PostgreSQL integration | 37 passed, including six real archive/restore integration cases |
| Native supervisor unit suite | 10 passed |
| Production frontend/backend builds | Passed |
| Bundled Java/Python/AI/PostgreSQL smoke checks and deep/strict signatures | Passed |
| Migration maintenance source compilation/endpoint refusal | Passed |
| `git diff --check` | Passed |

The PostgreSQL-only restricted-role test confirms registration/login need neither superuser privileges nor `data_directory` access. Test-only pools were bounded after the expanded suite reached the existing verification server's connection limit; no cluster configuration or startup guard was changed. Sandbox socket/agent restrictions were handled by scoped local test permission, not an authentication/isolation bypass.

## 10. Browser acceptance

Synthetic Chromium checks passed registration/empty state, explicit category setup and income/expense UI entry, exact arithmetic, logout/login/reload persistence, second-account isolation, preserved synthetic legacy records, all financial pages, real HttpOnly/SameSite cookies and CSRF rejection, owner-only hash-free exports, mobile dark mode/logout and zero renderer errors. Screenshots contain only guarded synthetic data.

Final packaged-asset browser acceptance passed against the installed app’s isolated synthetic profile, without Vite. The final compiled frontend, real backend sessions and account-scoped exports were exercised.

## 11. Desktop acceptance

Actual WKWebView checks passed empty registration, login/logout, transaction CRUD, real bundled category prediction, recurring catch-up/idempotency, forecasts/calendar/insights/assistant/savings, allocation separation, full backup/verification/restore, simulated external copying, native directory-panel rendering/cancel, authenticated export writing, account isolation and quit/reopen/login persistence. Restart discards the session but preserves records and password hashes. Zero renderer exceptions were reported in successful runs.

A synthetic-only Save-panel helper was corrected after an AppKit programmatic-action abort during testing. The final harness renders the real panel, then supplies a fixed synthetic destination to the same production export writer. This verifies authenticated download/writing and owner-only permissions; it is **not** a claim that a human Save-button click was executed. Normal production operation cannot enable that harness.

The installed app is version 0.6.1 at `/Applications/FinSight AI.app`. Previous bundles and immutable runtime releases are retained. Installation was explicitly approved after automatic review initially classified it as deployment; no remote deployment occurred. Prior V6 bundles correctly refuse V7 rather than downgrading the database.

The final installed-bundle native repeat passed. Normal personal-mode startup/readiness then passed with the synthetic harness disabled: financial/backup APIs required login, the separate native service gate denied unattested requests, Java/AI listeners were loopback-only, and the unchanged backup agent remained loaded. No personal financial UI automation or screenshots were used.

## 12. Backup and restore verification

Immediately pre-V7: `bkp-20261030220749-644d51a788b9`.

Post-V7 full safety backup: `bkp-20261030221843-f305ae73be19`.

Both are under `~/Library/Application Support/FinSight AI/backups/managed/`, with verified archives and full protected restoration of every canonical source database. The post-upgrade point covers V7 metadata/history. Native synthetic restoration separately verified multiple accounts, Argon2id hashes, all financial ownership and nonempty recurring/savings/feedback records. Restored financial copies are protected logical databases in the existing native cluster; none were used as application test fixtures or cleanup targets.

Private migration evidence includes `phase6b-before.json`, `phase6b-after.json`, `phase6b-independent-recheck.json` and the restricted Flyway log beside the pre-V7 backup. Root metadata records the successful upgrade and post-upgrade backup. Financial fingerprints/counts/balances, protected database mappings and credentials are not included in this repository/report. Every earlier safety backup and protected copy remains retained.

The same approved backup LaunchAgent, schedule, paths, worker, retention and restoration rules remain in place. Full database backups include sensitive authentication hashes and are unencrypted. Financial JSON/CSV exports omit hashes and are not restoration substitutes.

## 13. Known limitations and remaining owner actions

- Personal and legacy usernames/passwords must be chosen by the owner; no real credentials were invented or requested through chat. Legacy setup is deliberately a one-time local console action; no password-change/recovery UI or unauthenticated reset route is implemented.
- Login is required after app/service restart. Sessions/chat stay transient; financial records and hashes persist in PostgreSQL.
- Same-macOS-user malware, administrators and a compromised OS are outside this login boundary. Full backups are unencrypted and same-disk copies do not protect against hardware loss.
- Wi-Fi-disabled, closed-IDE/Terminal, physical external-SSD and human native Save-button acceptance were not executed in this phase. No editor, Terminal or network settings were closed/changed to simulate those checks.
- PostgreSQL automatic startup and backup-agent path migration remain outside the approved continuation scope. Existing stopped-server refusal and unchanged LaunchAgent behavior are preserved.
- No Docker, cloud service, paid dependency/API/subscription, optional LLM/runtime installation, Phase 7 work, remote deployment or Git commit was introduced.

See [account architecture and operation](account-authentication.md) for contracts, security limits and reproduction instructions.
