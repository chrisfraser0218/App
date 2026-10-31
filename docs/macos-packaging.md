# FinSight AI — native macOS packaging

**Current status:** packaging, installed-app synthetic financial workflows and native lifecycle acceptance are implemented and verified. Personal read-only acceptance and integrity verification also passed; manual offline/hardware acceptance remains pending. The repaired build disables Python bytecode writes during smoke tests and runtime, verifies signatures after smoke tests, and treats recently closed TCP connections as reusable while still rejecting active foreign listeners. Personal PostgreSQL management and the existing backup LaunchAgent remain unchanged; a stopped personal server is refused until automatic startup is separately approved. The unchanged backup agent still uses its existing external runtime/repository paths, so the complete system is not yet fully independent of those installations.

Phase 6 preserves React/TypeScript, Java 21/Spring Boot, PostgreSQL 15.17 and Python/FastAPI/scikit-learn. The desktop shell uses Swift AppKit and WKWebView. No Rust, Electron, new runtime installation, remote updater, model download, Docker or paid service was introduced.

## Decision

| Option | Frontend engine / extra runtime | Size, memory and launch implications | Service management / maintenance |
| --- | --- | --- | --- |
| Tauri | System WebKit, Rust native layer | Small shell; Java, Python and PostgreSQL still dominate total distribution. No measured Tauri benchmark here. | Suitable sidecars, but adds Rust tooling and macOS packaging integration to this project. |
| Electron | Bundled Chromium and Node | Adds browser/runtime size and processes beyond the existing services. No measured Electron benchmark here. | Mature tooling; more runtime updates and a larger attack surface to maintain. |
| Swift AppKit + WKWebView (selected) | System WebKit; installed Swift compiler for builds only | Small native shell; distribution includes the required financial/AI runtimes. Actual bundle measurement is recorded below. | Mac-only code using native menus, Dock, file panels and a narrowly scoped local supervisor; no additional build runtime installation. |
| Browser / script launcher | Existing browser plus system-installed services | Minimal distribution, but depends on external runtimes and manual browser/service setup. | Does not meet standalone Applications launch requirements. |

Framework references: [Tauri architecture](https://tauri.app/concept/architecture/), [Electron architecture](https://www.electronjs.org/docs/latest/why-electron), [Apple WebKit](https://developer.apple.com/documentation/webkit/webkit-for-appkit-and-uikit). Comparisons are architectural; alternative frameworks were not installed or benchmarked.

The private build targets **Apple Silicon, macOS 13 or later**. This is not a universal/distributable release. The shell is locally ad-hoc signed, not Apple-notarized; no paid signing membership is required for this private local build. Do not disable Gatekeeper globally. Locally rebuilding/signing is the supported remedy for a damaged or untrusted copied bundle.

## Distribution and runtime separation

- Generated bundle: `desktop/build/FinSight AI.app`.
- Local disk image: `desktop/build/FinSight AI.dmg`, containing the app and an Applications shortcut.
- Installed app: `/Applications/FinSight AI.app` after explicit local installation.
- Persistent data stays at `~/Library/Application Support/FinSight AI/` and is never stored inside the app or checkout.
- Authoritative cluster: `postgres/`, unchanged port `127.0.0.1:55432` and existing configuration/roles.
- Credentials: `backend.env`, owner-readable only. Never share or print it.
- Backups: `backups/managed/` plus all protected historical migration archives.
- Versioned immutable runtime copies: `desktop/releases/<buildId>/`. `desktop/current` points to the successfully started production release used by the existing backup agent. Old releases remain for deliberate compatibility review; no automatic pruning occurs.

The app includes existing Java 21, CPython 3.11, verified Python packages/model, PostgreSQL 15.17 binaries and recursively relocated native libraries. The app bundles Java/Python/PostgreSQL tools and does not use Maven, Node, Vite or the development venv during normal operation. **The unchanged backup LaunchAgent still requires its existing global Python, repository script and Homebrew PostgreSQL tools. PostgreSQL itself remains managed by the existing Homebrew arrangement.** macOS AppKit/WebKit/system libraries remain required. Native runtime licenses/notices accompany the bundle. No financial data or credentials enter the bundle/DMG.

This build opens the owner's **existing initialized database**. It refuses missing/wrong clusters, ports or accounts rather than creating or seeding a replacement. It is not an installer for a new user's PostgreSQL cluster. `/tmp/finsight-pgdata` remains stopped and untouched.

## Startup, readiness and shutdown

1. Double-click the app in Applications. A native loading view reports progress.
2. A private single-instance file lock prevents two supervisors. Packaged payload hashes are checked while copying a new immutable release; critical assets are checked on every launch.
3. The supervisor validates the existing cluster identity/location. If the personal server is stopped, startup refuses safely; automatically starting it with bundled tools is prepared but awaits separate owner approval. An unrelated server/port is never adopted or killed.
4. Existing Flyway history/checksums must match the build. A future pending migration requires a complete backup and full protected restore verification under the existing shared maintenance lock before Spring Boot starts; incompatible/unknown schemas are refused.
5. Bundled FastAPI listens on `127.0.0.1:18481`; bundled Spring Boot serves the built React assets and API on `127.0.0.1:18480`. Per-launch instance IDs and separate random service secrets attest readiness. No Vite server runs.
6. WKWebView loads only after readiness. Normal startup retains existing idempotent recurring catch-up and backup scheduling behavior.
7. Quit or close the last window: the supervisor waits for the shared backup/restore lock, gracefully drains Java and Python, and exits. It never force-kills a draining operation or shuts down unrelated processes.

PostgreSQL intentionally remains available after the window closes: the already-approved backup-only LaunchAgent needs database access while the application is closed. No additional login agent or Java/Python server autostart job is installed. PG is the one documented retained service. App crashes cause the supervisor to notice parent loss/stdin closure and drain owned services. A later launch recovers only recorded PIDs whose full start-time/command identity still matches; it never kills a process just because it occupies a port.

## Local security

Loopback is necessary but insufficient. Desktop `/api/**` requests require a random per-launch secret held by native code, not frontend JavaScript/local storage/cookies. The native fetch bridge accepts only bounded relative paths, allowlisted finance API roots and HTTP methods; it exposes no general command, SQL, filesystem or shell API. The Python service requires its separate secret. Host/origin validation remains enforced. Cross-origin navigation and remote resources are blocked; CSP restricts resources to the packaged origin. WKWebView storage is nonpersistent; only light/dark preference is copied to native preferences. API caching and payload logs remain disabled.

Credentials and private session/process manifests are owner-only. Secrets are passed to owned services through process environment, not command-line arguments. This protects other websites/ordinary unauthenticated local clients, but is not a defense against malware already running as the same macOS user, an administrator or a compromised OS. Backups/exports are not encrypted by the app; use macOS account controls/FileVault and protected external storage.

Native directory/save panels grant deliberate user-selected backup/export paths. Browser development retains the existing manual path field. The synthetic-only fixed-operation UI harness requires a private `/tmp/finsight-desktop-test-*` profile, a fixed isolated database and port; it is unavailable for normal personal operation.

## Existing backup agent

Preserve the **same** `com.finsight.local-backups` LaunchAgent, label, login behavior and 300-second check interval. Its internal daily/missed-slot policy and shared `flock` remain unchanged. No installed paths or job definition have been changed. A path-only migration to the bundled release is prepared in the installer but **must not be applied without new explicit approval**, following the owner’s continuation instructions. `desktop/backup-launcher.sh` starts only the backup check, never PostgreSQL/Java/FastAPI. The installer would retain a prior plist if that separately approved change were later applied; no such installed change or saved prior definition is claimed now.

A powered-off/asleep Mac cannot execute a backup. Missed slots are checked after login/wake/returning service availability; a stopped existing database requires the established startup procedure until automatic startup is approved. Do not install a second agent. External copy tests using a local synthetic directory establish copy/checksum behavior, not physical SSD availability or disk-loss protection.

## Building and installing offline

Build tools and application dependencies must already be installed/cached. Stop a development Java process before repackaging its loaded JAR; the desktop uses immutable release copies.

```sh
cd frontend
npm test
npm run build
cd ../backend
mvn verify
cd ..
python3 desktop/package.py --dmg
```

`package.py` accepts `--java-home`, `--python-home`, `--site-packages` and `--postgres-home` for existing local installations. Its defaults describe this development machine's verified sources; they are not runtime dependencies or download instructions. It relocates and locally signs copied libraries, verifies signatures and tests Python/Java/PostgreSQL with a minimal system-only PATH.

Copy `FinSight AI.app` from the local DMG to Applications, or use the reviewed local installer:

```sh
python3 desktop/install.py --install-app
```

Launch once to provision the verified immutable production release. Keep the existing backup LaunchAgent unchanged. The installer contains preparation/update support for a future path-only migration, but **do not invoke `--update-approved-agent` without new explicit owner approval**. No additional persistent service is authorized.

With the existing PostgreSQL server running, launch the packaged UI through Applications → FinSight AI. Its API is intentionally not an unauthenticated browser application; use the native app. Browser development can still use the documented separate development ports with desktop mode off.

## Updates and rollback

Updates are intentional offline copies, never internet checks. Quit FinSight AI and let maintenance finish. Keep a new **restore-verified full backup** before any schema update. Verify/sign/build a new app, replace only the application bundle, and launch. The installer retains an existing FinSight bundle as `FinSight AI previous <timestamp>.app`; it refuses an unrelated bundle identity. Persistent records/configuration/backups are untouched. New runtime releases are versioned, and `current` switches only after successful readiness.

Rolling back application binaries is safe only when the older build accepts every applied Flyway version/checksum. Never edit Flyway history or run a downgrade script to force an old build. If incompatible, keep the working newer app and use the deliberate isolated restore/cutover procedure in [backup recovery](backup-recovery.md) and [database migration](database-migration.md), with explicit owner approval before live replacement. A backup verified earlier does not contain subsequent writes. Retain original clusters and protected restored copies; never delete them as cleanup.

## Troubleshooting and acceptance

- **Port busy:** close the identified conflicting application yourself; FinSight never kills it. Retry Startup.
- **Missing/mismatched existing database:** stop and check the authoritative path/port and private environment; never initialize an empty database.
- **Schema mismatch:** use a compatible app. Do not alter applied migration files/history.
- **Waiting to quit:** an active backup/restore or request is draining. Allow completion; avoid force-quitting during maintenance.
- **AI unavailable:** the app shows startup/service errors and offers Retry; existing transaction forms continue to allow manual categories in the unchanged browser workflow.
- **Runtime verification/signature error:** retain data/backups and reinstall a verified local bundle. No runtime downloader exists.
- **Backup worker check:** inspect `launchctl print gui/$(id -u)/com.finsight.local-backups` for label/load/last exit metadata; never print credential files or financial manifests.

Automated acceptance uses the already-existing isolated PostgreSQL cluster on 55434 and a dedicated synthetic database; no cluster initialization or personal writes. `desktop/tests/native_acceptance.py` verifies real WKWebView navigation. `financial_workflows.py` exercises actual bridge/UI finance/AI/backup/native dialog behavior. Supervisor unit tests cover private configuration, process ownership, port conflicts and Flyway checksum calculation. Personal read-only acceptance disables recurrence posting and rejects mutation endpoints while checking preserved records independently.

The final verification record below distinguishes executed checks from outstanding OS/hardware checks. Automated acceptance must leave VS Code, Terminal and network settings alone. Run any future editor-closed or Wi-Fi-disabled acceptance manually in a deliberate saved-work session; never send quit commands to those applications from a test script. Never infer that offline operation was tested simply because all URLs are local.

## Phase 6 verification record

Acceptance resumed on **October 30, 2026** after the interrupted offline script closed Visual Studio Code. That script attempted to quit VS Code and Terminal, then failed before completing its offline checks. Its result records only restoration to the original Wi-Fi state; it is **not evidence of offline acceptance**. It was not rerun. Resumed checks left the editor, Terminal and network settings alone.

Executed during this continuation:

- Installed `/Applications/FinSight AI.app` and generated bundle passed deep/strict code-signature verification.
- All **10 supervisor unit tests passed**. The sandbox initially blocked the two loopback socket tests; rerunning with local socket access passed all ten.
- The installed native app rendered all **nine financial pages** through the authenticated WKWebView bridge using the existing isolated synthetic profile/database.
- Native synthetic workflows passed transaction create/edit/delete, actual bundled AI category prediction, recurring catch-up/idempotency, forecasts/calendar/insights/assistant/savings, allocation separation, backup/archive/isolated restore verification, simulated external copy, and native folder/export dialogs. **Zero renderer exceptions** were reported.
- Native lifecycle checks passed maintenance-aware graceful quit, reopen persistence, rejection of unauthenticated API calls, AI-service crash/retry, port-conflict handling without stopping the foreign listener, and abrupt native-host recovery/drain. Warm readiness measured **4.46 seconds** in this run; this is one local observation, not a benchmark. Cold PostgreSQL restart was **not run**.
- Installed-app personal acceptance passed in enforced **read-only mode**: existing financial APIs and assistant reads succeeded, and quit/reopen preserved the account. Independent integrity verification matched complete rows, sequence states and exact balances across all four canonical databases and four protected restore copies; archive checksums, PostgreSQL configuration and the backup LaunchAgent were unchanged, and the original cluster remained stopped. No financial responses or credentials were printed.
- `git diff --check` passed.

Retained pre-interruption verification artifacts report **129 frontend tests**, **45 Python service tests**, a successful frontend production build and packaging smoke checks; current backend Surefire XML reports **254 tests, zero failures/errors/skips** from the isolated PostgreSQL run. These broad suites were not rerun during this continuation.

Still pending: an intentionally manual Wi-Fi-disabled and editor/Terminal-closed session, physical external-SSD behavior, and any separately approved PostgreSQL startup or backup-agent path migration. No claim of full offline/closed-IDE acceptance is made. No application installation, runtime rebuild, deployment, Git commit, model installation, PostgreSQL management change or LaunchAgent update was performed during this continuation.
## Phase 6B authentication compatibility

Version 0.6.1 adds local account authentication while retaining this native architecture and service lifecycle. The native ephemeral URLSession owns the HttpOnly login cookie; its existing per-launch service secret is still required independently. The bridge supports only local API requests and the bounded CSRF header. Quit/reopen requires login again and preserves records. Production startup does not seed demo data. See [account authentication and verification](account-authentication.md).

V7 adds authentication metadata without moving financial records. A previous V6 bundle remains retained for compatibility review but correctly refuses V7 on a later launch; never edit migration history to force a downgrade. A compatible new bundle must be available with the authorized schema upgrade. The original PostgreSQL directory/configuration, stopped original cluster, private credentials and approved backup LaunchAgent remain unchanged. Full backups now include sensitive password hashes and remain unencrypted.


## October 31 category regression update

The fixed 0.6.1 bundle was rebuilt, locally signed, smoke-tested and installed through the unchanged safe installer after direct owner approval. The previous app was retained. Installed WKWebView synthetic acceptance verified 20 owned defaults immediately after registration, visible bundled AI suggestions without history, accepting/overriding suggestions, correct saved balances, account isolation and logout/restart persistence, plus the existing financial/backup/export workflows. No renderer exceptions were reported. No packaging/supervisor implementation, runtime installation, schema migration, PostgreSQL management or backup LaunchAgent change was required. Private pre/post personal-database and protected-configuration fingerprints matched. See the [updated completion report](phase6b-completion-report.md) for exact suite counts and remaining manual/remote acceptance; editor-closed and Wi-Fi-disabled operation were not executed.
