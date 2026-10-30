# Balance Forecast — Phase 2C

Open **Balance Forecast** at `http://127.0.0.1:5173/#forecast`. PostgreSQL, Java, React, and optional Python AI startup remain unchanged; see [local operation](local-operation.md). Forecasting runs entirely in Java, works without the AI service or internet, and never invokes the classifier.

## Calculation and dates

`ForecastService` starts with the same authoritative `FinanceService.account()` balance used by the dashboard:

```text
actual = starting balance + all posted income − all posted expenses
projection = actual + pending scheduled income − pending scheduled expenses
                    + open planned income − open planned expenses
scenario = projection + hypothetical income − hypothetical expenses
```

All calculations use `BigDecimal`; stored money uses PostgreSQL `NUMERIC(19,2)`. New forecast/plan response amounts are decimal **strings**. JavaScript converts them to numbers only for formatting and Recharts coordinates, never for authoritative arithmetic.

The injected business clock/time zone is shared with Phase 2B (`FINSIGHT_TIME_ZONE`, default `America/New_York`). A forecast covers **today through the selected date, inclusive**, using each day's closing balance. Presets add 1, 3, 5, 6, or 12 calendar months with month-end clamping, rather than multiplying by 30 days. The first/last monthly rows may be partial months. The minimum includes today's actual starting balance and every projected daily close; it does not estimate intraday ordering or bank settlement timing.

Recurring dates come directly from **`RecurrenceDates`**, starting at each active rule's persisted next-date cursor. This respects start/end dates, future-only edits, resume skips, cancellation, all six frequencies, clamped month ends, deduplicated twice-monthly days, and February 29 yearly behavior. Any permanent rule/date receipt excludes that occurrence, including explicit handled/manual dates and receipts whose actual transaction was subsequently deleted. Posted ledger entries are already included in actual balance, so they are never added again.

A pending recurring occurrence due today or earlier is still an **unposted projected flow**. Overdue items are shown on today's projected flow, with their original scheduled dates retained and an explicit overdue notice. Overdue open plans follow the same disclosed assumption; none auto-post. This makes the selected-date projection consistent before and after recurring catch-up or explicit plan recording, as long as the same amount is paid. Future daily lows may change when a payment's actual date/amount changes.

Forecast/baseline/scenario reads use one read-only **REPEATABLE READ** database transaction for a consistent account/rule/receipt/plan snapshot. They do not process due dates, move cursors, save model feedback, insert default preferences, or store forecast results. Existing independent recurring startup/poll processing remains enabled; another worker or explicit user action can legitimately change the next snapshot. While this page is open, the frontend refreshes reads but suppresses its usual process-due POST.

## Planned one-time transactions

Add an expense or income with a description, positive amount, owned matching category, and future date. Plans affect projections only. Edit open plans or cancel them with confirmation; canceling preserves a record and changes no posted payment. Editing an overdue plan requires a future date, or explicitly complete/cancel it instead.

Due plans **never become actual automatically**. Choose **Complete / link payment**:

- **Record an actual payment**: available for due/overdue plans only. Explicitly creates one ordinary transaction at the plan's amount/category, dated today or a selected past date. The dialog clearly states that actual balance will change. For a different paid amount, enter it manually and link it.
- **Link an already recorded payment**: can be used for early payments. Preserves its date, amount, and category. Income/expense direction must match; a differing amount requires explicit confirmation. One actual payment can complete only one plan. A payment already associated with a recurring occurrence can also explicitly complete a plan: its money is still counted once.
- **Mark completed without recording money**: explicitly removes the intention from projections without creating or linking any cash movement.

Completed/canceled plans cannot be edited or completed again. Removing a linked actual transaction leaves the completed plan closed and reports the missing link; no payment is silently recreated. Creation and completion use stable request UUIDs/fingerprints for safe retries. Row locks, optimistic versions, unique request IDs, and unique transaction links protect concurrency. Stale edits return 409. Linked transactions remain ordinary ledger records; their later explicit edit/deletion correctly changes actual balance without reopening the plan.

## Interface and what-if comparison

The page includes six actual/projected summary cards, exact date controls, a daily step chart with monthly-closing mode, hover details, a zoom brush, lowest-balance marker, monthly breakdown, selectable daily transaction details, and low/negative closing-balance warnings. Low threshold defaults to $100 without a database write. Only **Save threshold** persists the nonnegative preference, with version conflict protection.

Hypothetical entries remain in page memory and disappear on removal/navigation/reload. The scenario endpoint compares baseline and scenario from the same snapshot. Both lines, selected-date difference, and monthly baseline totals are shown. Changing the range to exclude an existing hypothetical produces a clear validation message; remove it or restore a range that includes it. No hypothetical is converted into an actual payment or plan.

## API

All paths are below `/api`; ownership is server-selected as in existing services. Existing host/origin checks, JSON-only writes, validation, and local-only listeners remain enforced.

| Method | Path | Purpose |
|---|---|---|
| GET | `/forecasts?months=5` | Full summary, days/events, partial months, warnings |
| GET | `/forecasts?endDate=2027-03-29` | Custom future date (choose months **or** endDate) |
| GET | `/forecasts/monthly?months=3` | Same calculation's monthly breakdown |
| GET | `/forecasts/daily/2027-01-01` | One day's opening/closing and contributing events |
| POST | `/forecasts/scenarios` | Pure baseline/scenario comparison |
| GET / PUT | `/forecast-preferences` | Read defaults or explicitly save threshold/version |
| GET / POST | `/planned-transactions` | List or create a plan (POST returns 201) |
| PUT | `/planned-transactions/{id}` | Edit an open plan using current version |
| POST | `/planned-transactions/{id}/cancel` | Cancel using current version |
| POST | `/planned-transactions/{id}/complete` | Explicit record/link/handled completion |

Synthetic request examples (replace dates and UUIDs; write examples should be tried only in an isolated fixture unless intentionally recording a personal plan):

```json
{"description":"Vacation","amount":"2000.00","type":"EXPENSE","categoryId":"<owned category UUID>","date":"2027-01-15","requestId":"<stable UUID>"}
```

Edit wraps that body: `{ "plan": { ... }, "version": 0 }`. Cancel uses `{ "version": 0 }`. Completion uses `{ "mode": "LINK", "transactionId": "<actual UUID>", "recordedDate": null, "confirmAmountDifference": false, "requestId": "<stable completion UUID>", "version": 0 }`. RECORD may set recordedDate and must omit transactionId; HANDLED omits both. Retries reuse identical request IDs and bodies.

```json
{"endDate":"2027-03-01","transactions":[{"id":"<scenario UUID>","description":"Unexpected repair","amount":"500.01","type":"EXPENSE","date":"2027-01-10"}]}
```

Scenario requests can optionally supply a nonnegative `lowBalanceThreshold` override without saving it. The response contains `baseline`, `scenario`, and exact `projectedDifference`. A plan's `transactionId`, status, and completionMode expose completion history; forecast events include source, original scheduledDate, effectiveDate, and overdue flag. Empty accounts/schedules produce flat projections, not fabricated income or expenses.

## Storage and verification

V4 creates only `planned_transactions` and `forecast_preferences`, with owned account/category foreign keys, positive decimal amount checks, unique create requests and completion links, versions, and persistent completion metadata. Forecast results/hypotheticals have no table. Applied V1–V3 migrations remain unchanged. The [migration report](database-migration.md#phase-2c-v4-upgrade) records the fresh restore-verified backup and post-upgrade integrity checks.

Local automated verification: `cd backend && mvn verify`; `cd frontend && npm test && npm run build`; `cd ai-service && python -m pytest -q`. PostgreSQL tests must use the **existing isolated cluster on 55434**, database `finsight_verification`, with the pre-startup isolation guard. Never export personal database credentials into tests. See the README for test configuration.

Executed verification: **95 backend tests on H2 and isolated PostgreSQL, 54 frontend tests, and 27 AI tests**, plus executable/backend and optimized/frontend builds. The 33 forecast backend cases cover exact calendar horizons, all six frequencies, month ends/leap years, pause/resume/edits/cancellation, manual/deleted receipts, immutable reads, catch-up consistency, plans, completion/idempotency/concurrency/rollback, ownership, thresholds/negative balances, scenarios, invalid input, and decimal precision. Frontend tests cover ranges, actual/projected labels, tooltip values, chart mode, scenario addition/removal, failures, validation, explicit cancellation/completion, manual linking, and threshold persistence. Browser acceptance uses synthetic data only, including desktop/mobile dark mode and real Recharts hover behavior.

## Limits and next phase

This is a deterministic projection of currently known definitions, not a guarantee, statistical model, or bank-cleared balance. It does not invent spending, estimate variable bills, model future schedule-definition changes, infer duplicate payments, or estimate intraday lows. Paused schedules stay excluded until explicitly resumed. Custom horizons are bounded to **3,660 days**, **100,000 projected occurrences**, and **100 hypothetical entries** per request; shorten the horizon if these limits are reached. Lists are unpaginated, as in prior phases. USD/single account remains the existing scope.

Automatic plan posting, bank synchronization, inflation, probabilistic forecasts, automatic backup scheduling, and desktop packaging are not implemented. [Phase 2D Bill Calendar](bill-calendar.md) now reuses these exact forecast days, flows, warnings, and recurring rules. Scheduled/planned/actual items remain visibly distinct, with explicit reconciliation controls.
