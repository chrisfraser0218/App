# Savings Goals — Phase 5

Open `http://127.0.0.1:5173/#savings` using the existing native PostgreSQL, Spring Boot and Vite services. The feature runs locally and offline, needs no new dependency/runtime/model, and preserves existing forecasting, spending analysis, AI categorization, backups and the deterministic assistant. Desktop packaging is not implemented.

## Allocations are not bank movements

Savings has a separate allocation book. Actual account balance remains `starting balance + recorded income − recorded expenses`, calculated by FinanceService. Creating goals, adding/withdrawing/correcting allocations, planning contributions, archiving and completing goals never call ledger/plan/recurring mutation APIs.

Each entry explicitly chooses a location:

- **IN_ACCOUNT**: money reserved within the existing account. Unallocated balance is actual balance minus active in-account allocations across **all** goals.
- **EXTERNAL**: savings tracked outside this account. These are included in goal progress but are not subtracted from this account again.

Example: a $5,000 actual balance with a $1,000 in-account allocation still has $5,000 actual and $4,000 unallocated. If a separately recorded $1,000 expense represents an outbound savings transfer, linking it to a $1,000 **external** contribution leaves actual and unallocated at $4,000; the transfer is not subtracted twice. Goals do not infer whether an expense is a transfer; the user explicitly records and associates it. There is no new bank-transfer or multi-account ledger engine.

Allocations are bookkeeping assertions, not verification of bank-backed funds. Over-allocation is allowed and produces an explicit negative-unallocated warning; it never changes the actual balance. Spending/income/anomaly calculations still use only existing ledger entries. The separate savings note on Spending Insights does not classify allocations as expenses or income.

## Goals and states

Each goal has an owned UUID/account, name, description, positive decimal target, optional date, creation timestamp, version, creation request key, manual completed flag and archive flag. Current saved amount is derived from active contributions minus active withdrawals across both locations; remaining is `max(target − saved, 0)`. Progress is `saved / target × 100`, HALF_UP to two percentage decimals. Overfunding may exceed 100% numerically; the visual bar is capped at 100%.

The dashboard shows target/saved totals, progress, actual/reserved/external/unallocated balances, counts, completed goals and active targets within the next 30 days. Filters expose active/completed/archived cards; selecting a card loads its exact history/projection. Totals include archived and completed goals so money is never silently freed by hiding a goal.

- Editing preserves contribution history. Archived goals must first be restored.
- Complete is explicit and only allowed when saved allocations meet the target. This does not prove account funding or move money. Reopen before changing allocations, plans, or raising a completed target above saved funds.
- Archive preserves the goal, saved amounts, completion state and every audit entry. Restore preserves the prior completed flag. Restore/reopen are explicit actions, not new contributions.
- Existing targets may be overdue. Dates range from 1900 through the shared clock's 3,660-day forecast horizon. Missing/overdue targets do not get invented future completion promises.

## Contributions, withdrawals and corrections

All amounts are positive and use BigDecimal/PostgreSQL NUMERIC(19,2); direction is a separate CONTRIBUTION/WITHDRAWAL enum. Dates are from 1900 through the shared business clock's today. Notes and payment references are optional. Money accepts at most twelve integer/two fractional digits. No automatic entries are generated.

Balances must remain nonnegative **for each location on every recorded daily close**, not merely today. Backdated changes cannot overdraw an earlier date or consume the other location's funds. Same-day activity is date-based, without an inferred intraday ordering.

Corrections mark an original inactive and optionally insert a replacement, with an immutable correction record containing reason/time/request key. Original amount/date/note/reference remain visible. A void correction has no replacement. Dependent withdrawals must be corrected first if removing a contribution would overdraw a historic location balance. Only active entries count toward progress; charts recompute corrected history while the audit retains the old data. There is no destructive delete endpoint.

Creating a goal, recording an entry and correcting an entry use stable UUID request keys and fingerprints. Retrying the same request cannot add money twice; reusing a key for a different request conflicts. Account row locking serializes savings mutations, versions reject stale forms, and unique active payment guards/unique correction branches reinforce application checks. Goal/schedule/state edits also require the current version. Forms retain their UUID on retry and preserve unsaved values while background financial refreshes occur.

### Existing transaction association

Links reference **one whole owned existing payment**, with exact matching date/amount. Split-payment allocation across multiple goals is not supported. A transaction can link to only one active savings entry; an explicit correction releases/replaces that effective link while retaining the historical reference.

| Location | Contribution link | Withdrawal link |
|---|---|---|
| In account | Recorded INCOME | Recorded EXPENSE |
| Outside account | Recorded EXPENSE | Recorded INCOME |

Selecting a payment copies its amount/date for explicit review. No source transaction is created/edited. A later source edit/deletion does not rewrite savings history: the details flag changed/missing references and retain the original UUID. Reconcile through an explicit correction. For a physical move between locations, explicitly record the corresponding withdrawal/contribution in the allocation book and any real cash movement through existing ledger controls; no counterpart is inferred.

## Savings forecasts versus cash-flow forecasts

One optional current allocation schedule per goal supports all six shared frequencies: daily, weekly, every two weeks, twice monthly, monthly and yearly. It reuses RecurrenceDates, including clamped 1–31 month days, deduplicated twice-monthly collisions and leap-day behavior. A historical start may anchor the cadence, but projections begin **strictly after today**. Missed intentions never auto-post, catch up or backfill the allocation book. Disabled, archived or completed goals do not project new planned allocations.

There are two distinct schedule modes:

1. **Allocation only**: future contribution dates/amounts change the savings estimate only. In-account reservations do not deduct from the bank forecast; external allocation intentions also do not invent a cash transfer.
2. **Explicit existing cash-flow association**: select a current owned planned or recurring transaction. It must match the allocation amount and direction (external uses EXPENSE, in-account uses INCOME). Projection dates come only from its still-pending ForecastService events within the chosen allocation date bounds. Posted, handled, paused or canceled flows yield no pending allocation; stale amount/direction changes are withheld and explained. A whole cash-flow reference may be assigned to only one savings schedule. Existing ForecastService includes that bank movement once, independently; savings never adds another cash-flow event.

If no allocation schedule exists, an observed-rate estimate is supported only when each of the last three **complete calendar months** has positive net recorded allocations. Their combined net divided by three, HALF_UP to cents, is repeated monthly starting next month on today's day, with month-end clamping. A disabled plan deliberately suppresses this fallback. This is limited recorded history, not proof of a sustainable rate or future income.

Completion is the earliest future allocation date when projected saved reaches the target, bounded to 3,660 days. If already funded, the date means “requirements met as of today,” not a reconstructed historical achievement date. Missing history/no qualifying plan/no completion within the horizon gives no date. Projections assume no unentered withdrawals and do not guarantee affordability.

Expected saved by a future target uses current saved plus qualifying pending projected allocations through that date. An overdue target has no invented historical target-date value. Required per planned occurrence divides remaining savings by projected occurrences through the target, CEILING to cents. Required monthly divides remaining by remaining calendar month-end opportunities (last clamped to target date), excludes today, and rounds upward. These are explicit recommendations based on stored targets, not cash-flow commitments. With no future target/opportunity they are unavailable.

The chart separates recorded allocation history and dashed projected allocations, with a target reference line and exact-value tooltips. Projected plot dates stop at the later of supported completion and target, or twelve months when neither is supported; calculations remain bounded to ten years. The monthly chart shows the latest 24 recorded months, contributions and withdrawals separately. The history table previews the latest 200 entries; all retained entries still count in totals/exports. A separate **bank** projection through twelve months comes directly from ForecastService and remains unaffected by savings-only activity.

## APIs and storage

All paths are under `/api/savings-goals`, server-owned and subject to existing local host/origin/JSON checks:

| Method | Path | Operation |
|---|---|---|
| GET | `/` | Dashboard summary and retained goal cards |
| GET | `/{id}` | Goal, allocation history, schedule, projection/recommendations |
| POST | `/` | Create goal with stable requestId |
| PUT | `/{id}` | `{goal: {...}, version}` edit |
| POST | `/{id}/state` | `{action: ARCHIVE/RESTORE/COMPLETE/REOPEN, version}` |
| POST | `/{id}/entries` | `{entry: {amount,type,bucket,date,note,transactionId}, requestId, version}` |
| POST | `/{id}/entries/{entryId}/correct` | `{replacement: entry-or-null, reason, requestId, version}` |
| PUT | `/{id}/schedule` | Amount/location/frequency/days/date bounds/enabled/linkType/linkId/version |

Monetary view values are decimal strings. Savings creation and entry POST return 201. Invalid inputs return existing Problem Details; ownership misses return 404 and stale/duplicate/conflicting links return 409. Caps: 100 retained goals/account and 10,000 retained allocation entries/goal, plus the existing cash forecast horizon/event bounds. There is no financial deletion/automatic posting route.

V5 adds `savings_goals`, `savings_entries`, `savings_corrections` and `savings_schedules`. V6 adds unique whole-cash-flow schedule association; it is a database version, **not Phase 6 desktop work**. V1–V4 and existing financial tables are unchanged. A separate additive constraint migration preserves the already-tested V5 history rather than rewriting it.

Native database backups/inventory automatically include every table. JSON/CSV exports now include all four savings tables when present, preserve exact decimals, protect note/reason spreadsheet formula prefixes and remain compatible with pre-savings archives. Exports distinguish allocation data from transactions and are not a substitute for full PostgreSQL backups. No backup service/configuration/retention expansion was introduced.

## Assistant and insights integration

The deterministic read-only assistant routes recognized savings questions to SavingsService, with explicit allocation/estimate labels, owned evidence and a Savings Goals link. Examples:

- “How much have I saved toward my Vacation?”
- “How much more do I need for my Emergency Fund?”
- “When will I reach my savings goal?”
- “Which savings goal is closest to completion?”
- “How much should I save each month for my Vacation?”

Use exact goal names. A generic “my savings goal” / “my target” can resolve a sole goal. Multiple/duplicate names ask for clarification. Closest uses the highest displayed progress among active incomplete goals; rounded ties are disclosed and returned together. Historical savings questions are limited to the current allocation book; use history for date-specific review. Assistant goal follow-ups are not persisted/inferred, mutation requests remain rejected, and no LLM/runtime is added. Spending Insights shows a separate reservation note without altering existing spending, income, anomaly inputs or totals.

## Safety, migration and operation

Before personal migration, the owned backend was paused, fresh canonical fingerprints recorded, and a full native managed backup created and restored to protected separate databases. Independent comparison covered all four canonical databases, every row/count/sequence and exact account balances. Existing cluster/port and the original stopped `/tmp` directory were unchanged. See the [migration report](database-migration.md) for the executed archive and final integrity results. Never reset any personal or retained recovery database. Future upgrades require a fresh verified backup again.

Use the same local startup and approved backup-only agent. No new persistent service, external API, internet connection, paid dependency or Docker is required. All write-based tests/screenshots use only the established isolated native cluster and synthetic databases. No personal goal or contribution is inserted by development verification.

Known limits: one local USD cash account; external savings are manually tracked assertions, not independently reconciled bank accounts; no split payment/cash-flow reference allocation; no automatic contributions/transfers; one current schedule per goal (schedule edits are not a revision-history product); no interest/investment/growth prediction; incomplete recorded history cannot prove a sustainable rate; unpaginated bounded history/service work may be slow at caps. Source cash-flow forecast event limits still apply. Already-disclosed local authentication/security and unencrypted same-disk backup limitations remain unchanged.

## Manual acceptance

Use synthetic data in the existing isolated environment when creating fixtures:

1. Create Vacation with a $5,000 target. Confirm $0 and 0% progress.
2. Add a $500 in-account contribution. Confirm $500/10%, while actual account balance stays unchanged.
3. Withdraw $100 from the same location. Confirm $400/8%, with unchanged cash balance.
4. Add a $500 monthly intention. Inspect exact completion/target-date estimate, required amounts and tooltips; compare bank forecast before/after for no additional cash effect.
5. Ask the assistant how much is saved toward Vacation. Check $400 allocation, evidence and source link.
6. Archive/restore, correct/void an entry with a reason, and verify retained audit history/reservations. Attempt an overdraw or duplicate whole-payment link and expect rejection.
7. Compare old transactions, balances, recurring rules, plans, preferences, spending insights and protected backup archives. Test mobile/dark mode and confirm open forms survive background refreshes.
8. Restore a synthetic nonempty savings backup into separate test copies and inspect exact export/audit entries. Never restore over active data.

Executed test/browser/migration results are recorded below after final verification.

### Executed verification — October 30, 2026

| Check | Executed result |
|---|---|
| Full backend H2 suite | 248 passed; zero failures/errors |
| Full guarded PostgreSQL suite + Maven verify | 248 passed; zero failures/errors; executable built |
| Full frontend Vitest suite | 129 passed across 11 files |
| Existing AI pytest suite | 44 passed; one existing upstream deprecation warning |
| Backup worker tests, including native integrations | 36 passed, including six native PostgreSQL cases |
| TypeScript/Vite production build | Passed |
| Savings browser scenarios A–F | Ten checks passed: 0→10→8% progress, exact completion estimate, chart hover, assistant allocation answer/link, archive/restore/correction, responsive dark mode; zero runtime errors |
| Existing ledger/AI browser regressions | Six checks passed; create/edit/delete balances, actual local category suggestions/overrides/feedback, mobile layout; original synthetic ledger restored |
| Nonempty final savings native backup/restore/export drill | Passed: goal, three retained entries, correction audit and schedule restored into separate synthetic copies; exact decimals and source snapshots preserved |
| Personal migration and integrity | V5/V6 successful; prior financial records/counts/sequences/balances unchanged across all four canonical databases; V1–V4 history/configuration unchanged; new savings tables empty |

The fresh restore-verified pre-upgrade managed archive is `~/Library/Application Support/FinSight AI/backups/managed/bkp-20261030163504-f0c253d61ef1/`. Its protected restore mapping and independent pre-upgrade row/count/sequence/balance proof remain private inside that directory. They represent the pre-V5 schema; deliberate recovery must account for future savings/user writes and restore separately, never overwrite live data.

Final before/after/integrity evidence is private at `~/Library/Application Support/FinSight AI/backups/phase5-verification-20261030T171311Z/`. All old financial tables matched their fresh canonical fingerprints; only the approved new savings tables and two Flyway rows were added. Original migration rows, all sequences, exact balances and native configuration matched. Normal frontend proxy, empty savings summary, read-only assistant, cash forecasts, spending insights and the approved backup agent were verified. The source archive and all four protected pre-upgrade restores still independently matched the original snapshots. No personal goal/contribution was seeded and no financial payloads were printed or added to screenshots/source.

Initial compilation/test/browser failures were investigated and corrected: explicit type/import issues, native select labeling, a browser selector matching both chart tick and summary, and unsaved form refresh handling. The final complete browser pass and relevant suites/builds were rerun. A separate V6 migration added whole-cash-flow uniqueness after V5 had already been exercised in test storage, preserving applied migration history instead of editing it. The reported passes are executed results, not assumptions.

No cloud service, Docker, runtime/model download, desktop package, deployment or Git commit was introduced. Existing financial/AI/backup services and local startup remain available. Phase 6 should separately evaluate Tauri/runtime bundling, owned-process lifecycle and safe PostgreSQL/backup upgrades with full offline/quit/reopen/recovery acceptance; none of that packaging is implemented here.
