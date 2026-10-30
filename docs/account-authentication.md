# Local accounts and authentication — Phase 6B

FinSight remains a private, offline application for one Mac owner. Separate local logins isolate the preserved legacy/demo book from newly registered personal books. No email, external identity provider, paid API, telemetry, model download or internet connection is used for authentication.

The owner approved retaining **every existing record together under its existing legacy user/account IDs** on October 30, 2026. Seeded and later-entered records are not classified, split, transferred or deleted. Account ownership was already present in V1–V6; this phase replaces the fixed server identity with authenticated identity rather than moving those records.

## Registration and empty accounts

The unauthenticated application shows **Welcome to FinSight AI**, **Create Account** and **Log In**, with existing light/dark styling. Financial components do not mount until the backend validates a session.

Registration requires a unique username, password and confirmation. Usernames are case-insensitive ASCII letters/digits/underscores, 3–32 characters, starting with a letter; the stored username is lowercase. Passwords require at least 12 Unicode code points and allow up to 1024 UTF-16 code units. Pasting and password managers are supported. No email is required.

One database transaction creates the user and one USD account with an exact `0.00` starting balance. It creates **no categories, transactions, income/expense history, recurring schedules/receipts, plans, forecast preferences, goals, savings entries, predictions or feedback**. Assistant history is never persisted. Nothing is copied from the legacy account. If registration fails, the account transaction rolls back.

Categories are user-owned financial metadata, not global system records. Choose **Add a category** on the dashboard to explicitly create income/expense categories before entering transactions. Names resembling model categories may support existing optional suggestions; suggestions never create categories or override manual choices. Production builds no longer contain the demo seeder. The old seeder is retained only in guarded synthetic test sources.

## Legacy/demo login: deliberate one-time setup

V7 deliberately supplies **no shared demo password and no unauthenticated claim/reset endpoint**. The preserved legacy identity remains locked until the Mac owner chooses its credentials in a local terminal. No financial record is changed by credential setup.

After the compatible Phase 6B release is available, run from the repository:

```sh
python3 scripts/configure-legacy-login.py
```

Choose a legacy username (for example, an available demonstration name) and a password of at least 12 characters. Password input is hidden; do not send it through chat, command-line arguments, logs or source files. Then use **Log In** in FinSight. Use **Create Account** for the separate personal book.

The script validates owner-only `backend.env` using the existing non-executing parser, selects the immutable local runtime and runs the narrow `LocalCredentialTool`. The wrapper verifies the preserved directory using existing owner-level maintenance access. The Java tool requires an interactive console, verifies the exact database and loopback endpoint, and only initializes a previously unconfigured legacy username/hash. It increments credential version; it does not change balances, categories, schedules or transactions. It refuses already-configured credentials. This is not a general password-reset utility. Password recovery/change UI is not implemented; future recovery needs a deliberate owner-controlled local workflow and must preserve records.

## Password storage and login protections

Spring Security's standard `Argon2PasswordEncoder` stores **Argon2id**, using a 16-byte random salt, 32-byte hash, 19,456 KiB memory, two iterations and parallelism one. Hash strings identify the algorithm and parameters. Long passwords are hashed in full; there is no bcrypt truncation or custom prehash construction. The free Bouncy Castle Java dependency is pinned in Maven and bundled in the JAR; it is an intentional build dependency, not a runtime download or new system-wide runtime.

Unknown usernames use a dummy hash verification. Login returns a generic invalid-credentials error. A global limit of 30 login/registration attempts per minute bounds attempts across usernames and sessions; exceeding it returns 429 with Retry-After. At most two expensive password operations run concurrently, with bounded waiting. Request field sizes and native request body limits remain bounded. The legacy account has no usable password until explicitly provisioned.

Passwords, hashes and session credentials are not returned in session views, financial exports or logs. Full native database backups necessarily contain hashes and are sensitive. [Spring Security password storage](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html) documents the standard encoder; [Bouncy Castle](https://www.bouncycastle.org/download/bouncy-castle-java/) supplies the bundled implementation dependency.

## Sessions and CSRF

The backend keeps sessions in server memory. `FINSIGHT_SESSION` is a host-only, session-lifetime, HttpOnly, SameSite=Strict cookie, restricted to cookie session tracking. Login/registration rotate the session ID and CSRF secret. Logout invalidates the session and expires the cookie. Idle expiry is 30 minutes; absolute authentication age is bounded to 12 hours. Every authenticated request revalidates user/account ownership and credential version, so credential revocation takes effect on the next request. Restarting Java/native services requires login again and never deletes financial data.

The current transports are plain loopback HTTP. The cookie is **not Secure** because Secure cookies are not reliably compatible with the existing local HTTP/WebKit architecture. Do not claim TLS transport protection. HttpOnly/SameSite, strict local host/origin checks, synchronizer-token CSRF protection and the desktop's separate native service secret provide the implemented controls.

`GET /api/auth/csrf` returns a session-bound CSRF token. Mutations require it in `X-CSRF-TOKEN`, including registration, login and logout. Tokens stay in page memory and rotate with authentication; neither passwords nor authentication tokens enter localStorage. The theme is the only persisted renderer preference. APIs use no-store responses, disable request caching and retain JSON/origin restrictions. A failed financial mutation is never automatically replayed while refreshing authentication.

The frontend unmounts all financial pages on logout or expired authentication, clearing component state, assistant context and selections. Existing abort/stale-response checks remain. A session generation check prevents a delayed unauthorized response from an older login clearing a newer session. Log out is available in the top toolbar at mobile widths as well as desktop widths.

See [Spring Security session persistence](https://docs.spring.io/spring-security/reference/6.5/servlet/authentication/session-management.html) and [CSRF integration](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html) for the underlying framework contracts.

## API boundary

| Endpoint | Behavior |
| --- | --- |
| `GET /api/auth/csrf` | Start/refresh CSRF protection; no financial reads |
| `POST /api/auth/register` | Validate and atomically create empty account; establish session |
| `POST /api/auth/login` | Verify local credentials; rotate session |
| `POST /api/auth/logout` | Require session/CSRF; invalidate session |
| `GET /api/auth/me` | Return authenticated username and owned account ID |
| `GET /api/auth/session` | Revalidate the same authenticated session |

All financial APIs, predictions, assistant questions, insights and backup/export operations require authenticated sessions. Desktop health retains its existing service-readiness role without exposing financial records. Desktop requests additionally require the random native per-launch service secret, even for authentication endpoints.

## Ownership and background workers

`CurrentIdentity` derives user/account IDs exclusively from the verified backend principal. Controllers do not accept account selection or ownership fields from the frontend. Existing strict unknown-field deserialization rejects injected ownership fields.

Finance, categorization feedback, recurring schedules, plans, forecasts/preferences, calendar, savings, insights and both assistant paths use owned queries and mutations. Savings no longer caches fixed IDs in static constants. Foreign IDs cannot be read, edited, completed, reconciled or linked through another account. Existing ownership foreign keys, version/account locks, unique request fingerprints, permanent recurring receipts, savings corrections and exact Java/PostgreSQL money remain in place. Account selection is deliberately one cash account per registered login; an unexpected legacy ownership/account graph blocks migration/login rather than guessing.

The independent recurring worker enumerates persisted schedule owners and establishes an explicit internal per-account processing scope. It does not depend on a browser session, last login or client ID. Every posted payment retains its schedule's user/account, receipt, row lock and atomic cursor transaction. Forecast/calendar/assistant reads remain separate from posting. Backup polling and the already-approved LaunchAgent remain independent of login.

## Desktop integration

Swift/AppKit/WKWebView, Java 21, native PostgreSQL 15.17, Python/FastAPI/scikit-learn and React are retained. The native API bridge adds the authentication route family and only the bounded CSRF header needed by the session design. The native ephemeral `URLSession` owns the HttpOnly session cookie; WebKit's renderer does not receive it. The pre-launch service secret stays in native code. Normal production operation still cannot enable the synthetic automation harness.

Reload Workspace can validate the existing native session. App quit/reopen starts a fresh ephemeral native cookie store and requires login, while PostgreSQL retains records and password hashes. Native supervision, maintenance-aware quit, private single-instance/process identity controls, loopback listeners and readiness checks are unchanged. PostgreSQL startup management and the backup LaunchAgent definition/paths are not expanded or replaced.

## Backup, exports and shared maintenance

Full backups remain **Mac-owner maintenance across all accounts**; account login is not a separate macOS security boundary. Authenticated maintenance settings/archive metadata remain global because they protect the complete local installation. There is no HTTP route for downloading raw full database archives or inspecting their private financial manifests. Personal forecast preferences and financial settings remain account-scoped.

The existing native worker backs up every table and thus includes users, Argon2id hashes, account ownership and all financial data. Snapshot/receipt preservation, `flock`, archive checks, restore comparison and retention rules remain unchanged. Protected financial restore copies are never automated-test fixtures or cleanup targets. Backups are **unencrypted**; compression/checksums are not encryption, and same-disk copies do not protect against hardware loss.

JSON/CSV financial exports use the authenticated server-selected owner. Prepared export files have owner-only ownership sidecars; download checks that ownership. Status/history/operation responses hide another account's exports. Old exports without ownership metadata are retained on disk but unavailable through authenticated HTTP downloads; prepare a fresh owned export. Financial exports never include users, password hashes, session cookies or authentication metadata.

## Safe V7 migration

V7 changes only authentication metadata: email becomes optional, nullable unique normalized username and credential version are added, and username format is constrained. All existing owners, IDs, financial rows and original V1–V6 files/history remain intact. No credentials or financial fixtures are seeded by the migration. Earlier backups/releases remain retained; the previous V6 app correctly refuses an upgraded V7 database rather than silently downgrading it.

Before the active upgrade, the migration must pass synthetic V6-to-V7 preservation and two-account tests in the already-existing isolated environment. The production JAR must be built and verified before use. Quit/drain FinSight normally; never overwrite an archive that Java is loading.

The authorized maintenance command is:

```sh
python3 scripts/apply-account-authentication.py --confirmed
```

It checks the exact active directory/endpoint, matching V1–V6 Flyway checksums, expected legacy ownership and absence of application clients. Under the existing maintenance lock, it captures private fingerprints for all existing databases, exact sequence states/balances, PostgreSQL configuration and the backup plist. It creates a fresh pinned full safety backup and fully restores it into new protected database names, then runs the packaged V7 migration with **no application writers/seeder**. It compares every existing financial table and original user-column values, previous Flyway rows, other existing databases, sequences/balances, configuration/plist and the stopped original cluster. Evidence is private under the backup directory; no records or credentials are printed. A failure leaves services stopped for deliberate inspection and never resets/restores over active storage.

The maintenance Java source launcher is a development/upgrade action using the already-installed Java 21, not a normal-operation compiler dependency. The wrapper attests the preserved storage using owner-level maintenance access; the Java launcher accepts only the preserved database/loopback endpoint and refuses unknown migration history. It does not grant the application role access to global PostgreSQL settings. Do not run this command as a test against financial storage. Normal automated tests retain `IsolatedDatabaseGuard` and the existing synthetic database/cluster; no cluster is initialized.

## Manual acceptance and limitations

Use **synthetic data only** for acceptance/screenshots:

1. Register a new username; verify $0.00, empty categories/transactions/schedules/plans/goals/history, and no stored preferences or feedback.
2. Explicitly create income/expense categories, then record income and an expense. Check exact balance and owned source IDs.
3. Log out; verify financial content disappears. Log back in and verify record persistence. Test expired sessions and CSRF rejection without replaying writes.
4. Register a different synthetic user; verify no first-user records, categories, schedules, preferences, goals, insight evidence, assistant evidence or exports are accessible, including manipulated foreign-ID requests.
5. Return to the first synthetic account and verify its data is unchanged. Use private fingerprint verification for real legacy preservation, not screenshots or test writes.
6. In the native app, quit/reopen, log in again and verify records persist. Keep PostgreSQL and the approved backup worker running.
7. Create/check/restore a synthetic full backup and verify all users/hashes/financial owners; confirm JSON/CSV financial exports contain only the requesting account and no hashes.

Source tests cover the authenticated boundary without a production bypass. `desktop/tests/authentication_acceptance.py` accepts only the existing private synthetic native profile and exercises actual WKWebView, financial workflows, backup/restore and native dialogs. Broad frontend/backend/AI/worker checks and real OS acceptance are reported separately in the Phase 6B completion record.

Same-user malware, an administrator or a compromised OS can access local storage/processes; app login is not protection from a compromised Mac. Session memory is deliberately lost on service restart. There is no password-recovery UI, email verification, remote account system, encrypted app backup, cloud updater or Phase 7 implementation. Wi-Fi-disabled, closed-IDE and physical external-SSD acceptance must be reported only when actually executed.
