# Phase 2B — recurring income and expenses

Phase 2B is implemented in the existing local browser application. It uses the existing Homebrew PostgreSQL 15.17 cluster at `~/Library/Application Support/FinSight AI/postgres`, `127.0.0.1:55432`. No new PostgreSQL cluster, Docker service, cloud dependency, forecast engine, bill calendar, desktop wrapper, or paid service was introduced.

## Using recurring transactions

Open **Recurring Transactions** in the sidebar. Add an income or expense with a description, positive USD amount, category, frequency, start date, optional inclusive end date, and initial active/paused state. Expense suggestions use the existing local AI model; they never select a category automatically. **Use suggestion** is explicit, and you can change the category afterward. Manual entry works without AI.

Active schedules post transactions when dates are due, including today's first occurrence. Future dates remain unposted. Creating an active schedule with a past start date requires explicit authorization for catch-up. Creating it paused creates no ledger entries. For a payment already recorded manually, start paused or use a future first due date, reconcile the exact payment/date, then resume. Do not authorize backfill for dates you intend to reconcile first.

| Frequency       | Rule                                                              |
| --------------- | ----------------------------------------------------------------- |
| Daily           | Every calendar day from the start date                            |
| Weekly          | Every 7 calendar days anchored to the start date                  |
| Every two weeks | Every 14 calendar days anchored to the start date                 |
| Twice monthly   | Two configured days, 1–31, with the second greater than the first |
| Monthly         | A configured payment day, 1–31                                    |
| Yearly          | The start date's month/day each year                              |

Monthly and twice-monthly days that are missing use the month's last day. The original configured days remain the anchor: January 31 → February 28 → March 31, not March 28. Twice-monthly days 30/31 produce only one payment in February, but resume separate dates in March. February 29 yearly becomes February 28 in non-leap years and returns to February 29 in leap years. No weekday, holiday, banking-business-day, or variable-amount rules are inferred.

Scheduling uses calendar dates in **America/New_York** by default, configurable with `FINSIGHT_TIME_ZONE`. This is an application business time zone, not an assumption of 24 elapsed hours across DST. Changing that configuration can change what date is due; review it intentionally rather than silently changing existing behavior.

## Summaries, history, and upcoming dates

The workspace shows recurring income and expenses **grouped by cadence**, active schedule count, and the next unhandled payment. Weekly, every-two-weeks, twice-monthly, monthly, yearly, and daily amounts are not combined into a fabricated monthly total. Amounts are per occurrence within each cadence; a twice-monthly amount is not presented as if it were the whole month's amount.

Each schedule has **View history & upcoming**. Upcoming shows dates over the next 60 days and their status, not predicted account balances. Recorded occurrences show generated/manual/handled entries and linked transaction amounts where still present. The transaction history marks linked entries as recurring. Actual account balances and spending charts continue using only the ordinary posted transaction ledger; schedules are never added again to balance totals.

States are active, paused, canceled, and additionally completed when no unpaid occurrence remains within the end date. Canceled schedules stay available for history; they are not physically deleted. Future occurrences already linked/handled are omitted from the next-unhandled payment date.

## Editing, pause/resume, and cancellation

- Editing changes description, amount, type/category, frequency, payment days, start anchor, and end date **for future occurrences only**. Already due entries are settled under the previous definition first. The new definition is calculated strictly after today; no historical transactions or handled receipts are rewritten.
- Pause settles previously due entries and stops further automatic posting. Resume skips all unresolved dates through the resume date; the first new automatic payment is a later scheduled date. Paused dates are not backfilled.
- Cancel requires confirmation. Due entries are settled first; future posting stops, and all posted history remains. Cancellation is irreversible in the UI; create a new schedule for a new agreement.
- A backlog over the per-batch limit must be processed before editing, pausing, or canceling. The API returns a conflict asking you to process due entries rather than making ambiguous partial changes.
- Edits/state changes include the current version. If a schedule changed or processed while the form was open, the API rejects stale updates with 409. Refresh and reopen rather than overwriting a newer state.

Deleting a generated ledger transaction recalculates the actual balance, as before. Its occurrence receipt remains as removed, so the processor never recreates that deleted transaction. Editing a posted transaction affects that transaction only, not the schedule's future amounts.

## Explicit manual-payment reconciliation

No description, date, amount, or merchant similarity is used to infer duplicates.

1. Use **Reconcile payment** or an upcoming **Handle occurrence** action.
2. Select an exact date that belongs to the schedule (or an existing removed receipt).
3. Select an existing unlinked payment, or choose **Mark handled — no ledger entry**.
4. Explicitly confirm any amount difference. The selected payment must belong to the same account/user and match income/expense direction. Its recorded date and category can differ; neither is overwritten.
5. Confirm. No new transaction is created. A linked payment already contributes to the balance exactly once, while a handled-only receipt contributes no money.

A transaction can link to only one occurrence. A receipt with an existing posted transaction cannot be silently replaced or deleted by reconciliation. Review the history and, if appropriate, explicitly delete the unwanted generated entry using the existing transaction confirmation flow; its receipt remains and can then link the actual manual payment. Repeated identical links are idempotent. Deleting a linked manual payment also leaves its receipt, preventing surprise recreation.

## Processing and exactly-once persistence

`RecurringRuleService` runs with an injectable `Clock`. `RecurringScheduleRunner` processes due rules on `ApplicationReadyEvent` and then every 30 seconds while the backend runs. The frontend requests a bounded pass on opening/reconnect and during its visible refresh cycle. There is also **Process due now**. Nothing needs to run while the MacBook/application is closed: persistent due dates are caught up next time the backend starts or the UI reconnects.

For each schedule, a pessimistic row lock serializes posting and schedule mutations. A database transaction creates the ordinary transaction, inserts the occurrence receipt, and advances the next date atomically. `PRIMARY KEY (rule_id, occurrence_date)` is the durable idempotency key. The receipt survives ledger deletion. A unique transaction link also protects manual reconciliation, and the existing transaction is locked before validating and linking it.

Each rule is limited to **500 dates per processing pass**, with committed progress. Longer gaps continue in later passes or via repeated **Process due now** requests. One failing schedule does not roll back other schedules' committed work; it is reported and retried. No future date is posted. There is no automatic retraining, AI call, cloud worker, or elapsed-time assumption in the posting path.

Create requests carry a client-generated `requestId`, stable while retrying the form. An account lock plus a unique owner/request key prevents a repeated create from duplicating the schedule and its postings. Reusing a key with a different creation payload returns 409. Reopening a new blank form intentionally creates a new key.

## Database migration

`V3__recurring_transactions.sql` is additive:

- `recurring_rules`: owner/account/category, exact decimal amount, recurrence dates/days, state flags, next date, request key, creation fingerprint, timestamps, optimistic version.
- `recurring_occurrences`: permanent owner-scoped schedule/date receipt, nullable unique transaction link, POSTED/MANUAL/HANDLED resolution, timestamp.
- `recurring_prediction_feedback`: server-verified prediction reference and schedule category acceptance/correction, with `reviewed=false`.

Existing transaction, account, category, user, prediction, and feedback tables are not altered. The only change to an existing table during installation is the successful Flyway V3 history entry. No example schedules or payments are seeded. Future-dated schedule feedback is stored without creating a premature ledger entry, and it is never used for automatic training.

Before V3 was applied to the active database, a fresh backup was created and fully restore-verified:

`~/Library/Application Support/FinSight AI/backups/phase2b-pre-v3-20261029T192555Z-378583/`

It contains custom archives of all four then-current non-template databases, globals, configuration copies, checksums, exact private snapshots, and restore mappings. Four separate protected restore databases were created **inside the existing persistent cluster**, not a new cluster. Their names are in private `manifest.json`; they are retained as recovery evidence and are never used for destructive tests. No source database was overwritten, dropped, or reset.

Verification after installation confirmed all existing financial row fingerprints/counts, sequence states, exact balances, other databases, original Flyway rows, and PostgreSQL configuration files remained unchanged. All three new tables were empty; no personal schedules or transactions were created. The original `/tmp/finsight-pgdata` remains stopped and untouched.

To verify the retained pre-V3 restore copies read-only:

```sh
PGHOST="$HOME/Library/Application Support/FinSight AI/run" PGPORT=55432 \
python3 scripts/verify-database-backup.py \
  --backup "$HOME/Library/Application Support/FinSight AI/backups/phase2b-pre-v3-20261029T192555Z-378583" \
  --use-restored-copies
```

The active database now has V3, so an exact V2 table-set comparison against that older backup is expected to differ. The restore-copy flag compares the retained exact restores instead; `post-v3-verification.json` records the separate active-data preservation checks. No personal totals or backup contents belong in Git, logs, or screenshots. Recovery still uses a separate empty database and an explicit cutover; do not restore a pre-V3 archive over the live database or restart the original cluster. See [database migration/recovery](database-migration.md).

## API

All routes are under `/api/recurring-transactions`, implicitly scoped to the local user/account.

| Method | Route                                             | Purpose                                                           |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| GET    | `/`                                               | All owned schedules, including canceled history                   |
| GET    | `/{id}`                                           | One owned schedule                                                |
| POST   | `/`                                               | Create with an idempotency request key; post due dates only       |
| PUT    | `/{id}`                                           | Future-only edit: `{ "rule": <input>, "version": <current> }`     |
| PUT    | `/{id}/state`                                     | Pause/resume: `{ "enabled": false, "version": <current> }`        |
| POST   | `/{id}/stop`                                      | Cancel: `{ "version": <current> }`                                |
| POST   | `/process-due`                                    | One bounded processing pass; returns posted/pending/failed counts |
| GET    | `/{id}/history`                                   | Recorded receipts and linked ledger details                       |
| GET    | `/{id}/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD` | Read-only schedule-date list, range at most 366 days              |
| POST   | `/{id}/reconcile`                                 | Explicit manual link or handled-only receipt                      |

Create/edit input fields: `description`, positive `amount` (up to 12 integer digits and 2 decimals), `type` (`INCOME`/`EXPENSE`), owned `categoryId`, `frequency` (`DAILY`, `WEEKLY`, `BIWEEKLY`, `TWICE_MONTHLY`, `MONTHLY`, `YEARLY`), `paymentDay` (monthly/twice-monthly only), `secondPaymentDay` (twice-monthly only), `startDate` (1900–9999), optional inclusive `endDate`, `enabled`, UUID `requestId`, `backfillConfirmed`, optional current `predictionId`.

Reconciliation input: `{ "occurrenceDate": "YYYY-MM-DD", "transactionId": "<owned unlinked transaction UUID or null>", "confirmAmountDifference": false }`. Null transaction means handled without money. Invalid fields/date/category/type return 400, foreign/missing resources return 404, and version/request/link conflicts return 409. Unknown properties are rejected. Financial errors do not contain rejected payload values.

## Verification and limits

Executed **62 backend tests** on H2 and again on the already-existing isolated PostgreSQL 15 test cluster, including all earlier tests and 29 recurring cases. Coverage includes all frequencies, clamped days, leap years, DST, catch-up, large batches, concurrent workers, rollback between ledger/receipt creation, deleted-entry tombstones, edits, pause/resume, cancel, owner isolation, balances, AI feedback, and explicit manual reconciliation.

Executed **27 frontend tests**, including the earlier manual/AI tests and recurring form/action/summary validation, plus **27 AI service tests**. Optimized frontend and executable backend builds passed. Synthetic Chromium checks covered the recurring UI, summaries, history, AI/manual control, reconciliation, mobile dark mode, and an unsaved draft surviving real background refresh. A persisted synthetic past-due fixture posted four distinct dates automatically on real backend startup; PostgreSQL/API restart and six concurrent repeat requests created no duplicate. Existing Phase 1/2A browser regressions also passed with synthetic data. With the real FastAPI process stopped, a recurring expense still posted using the selected category, and ordinary manual create/edit/delete still worked; the model service was restarted afterward.

AI evaluation/limitations are unchanged: the model is trained on synthetic descriptions with uncalibrated probabilities; there is no real-world accuracy claim. One upstream Python test-client deprecation warning remains. The browser smoke scripts were local verification tooling rather than a maintained packaged test runner. No Docker or remote CI execution was performed. Local automatic backup scheduling, authentication hardening, pagination, desktop packaging, future balance forecasting (2C), and interactive bill calendar (2D) remain outside this phase.
