# Spending Insights — Phase 3

All analysis runs locally and is read-only. Open `http://127.0.0.1:5173/#insights` with the existing native PostgreSQL, Java API and Vite running. Start the existing FastAPI service for optional transaction anomaly detection; summaries, comparisons, recurring estimates and manual budgeting work without it. No migration, dependency, training job or persistent insight metadata is added. Phase 4, savings goals and desktop packaging are not implemented.

## Data and calculations

Java obtains the server-selected account's recorded transactions in a read-only repeatable-read snapshot. Amounts, percentages, medians and thresholds use BigDecimal and return decimal strings. Chart coordinates use display-only numbers; tooltips/tables retain the server's exact values. Nothing from Python is trusted as a monetary statement.

- Presets: this month, last month, and current month plus the preceding 2/5/11 months. Custom ranges are inclusive, no later than the shared business clock's today, from 1900 onward and at most 1,831 days.
- Selected spending means gross EXPENSE entries on their exact recorded dates. Income includes refunds entered as INCOME; net is income minus expenses. The current schema has no refund relationship, so analysis does not guess or net refunds against expense categories. Editing/deleting a correction changes the next read, not another financial record.
- Category share is expense/category total divided by all selected expenses, rounded HALF_UP to two percentage decimals. A zero denominator has no percentage. Missing category metadata uses a fallback label without dropping its amount.
- Selected category comparisons use the immediately preceding **equal-length date interval**; both intervals are displayed. This is not necessarily the preceding calendar month.
- The independent month-to-date card compares this month through today against the previous month through the corresponding day, clamped to that month's end. Zero previous spending gives no percentage baseline.
- Average monthly spending uses the last three **complete calendar months**, independently of the selected filter. It is withheld unless each has recorded positive expense activity. This coverage rule does not prove complete bank records or treat missing months as known zero spending.
- Monthly trend rows explicitly identify clipped/partial months. Completed-month spending surges compare against the median of three preceding positive-spending months: total threshold `max(1.3 × median, median + $100)`; category threshold `max(1.5 × median, median + $100)`. These are statistical observations, not fraud findings.
- Recommendations to review category growth require at least 30% and $50 above the equal-length comparison. Descriptions/categories cannot establish whether a purchase is necessary. No investment advice is generated.

Each card identifies fact, statistical observation, estimate or recommendation; its dates, calculations and source transactions are inspectable. A zero-income fact only describes recorded data.

## Recurring expenses

Recorded recurring expenses are actual posted expenses linked through durable occurrence receipts. Each ledger payment counts once, even when also associated with a plan. Upcoming payments reuse ForecastService and existing occurrence handling; analysis never runs the posting worker.

Current active, unarchived expense definitions with a pending cursor contribute a separate steady-cadence monthly **estimate**, independent of the selected historical interval. Expired definitions are excluded. Factors are daily `365.2425/12`, weekly `365.2425/84`, biweekly `365.2425/168`, twice-monthly `2`, monthly `1`, yearly `1/12`. Each displayed row is rounded to cents before summing, so totals reconcile with the visible rows. These Gregorian long-run equivalents are not exact month counts and do not prorate future starts/end dates.

Exact pending totals are shown for today through month-end and today through the next 30 inclusive days. Dates/handled receipts/month-end clamping/overdue handling come from existing forecasting. Upcoming preview is limited to 100 rows; totals include every calculated pending event. Planned one-time expenses are excluded. Amount-change observations compare the latest two recorded payments for a rule, with the latest in the selected range. They cannot reconstruct past definition edits or prove a subscription price increase; partial/manual corrections can explain a change. Largest recurring expenses are ordered by monthly estimate and grouped by category, without guessing which definitions are subscriptions.

## Local statistical analysis

The existing FastAPI service adds `POST /analyze-spending`. Java sends only owned expense UUIDs, dates, integer cents, category UUIDs and optional recurring-rule UUIDs to the configured loopback AI URL. No account balances, descriptions, database credentials, financial writes, persistent training or external calls are involved. Existing AI timeout configuration applies (500 ms connect, 1,500 ms read by default).

Runtime method `robust-mad-v1` uses causal category and recurring-rule histories: strictly earlier dates within 180 days, latest 100 entries, at least eight prior examples. Same-day transactions never form each other's baseline. For baseline median `m` and median absolute deviation `MAD`, the integer-cent ceiling of the threshold is:

`max(m + max(5000 cents, m/2), m + 6 × MAD / 0.67448975)`

Only amounts strictly above the threshold are flagged. The $50/50% floor handles flat baselines conservatively. These thresholds are observations, **not probabilities or fraud verdicts**. Limited history produces an explicit abstention. Python returns identifiers/methods/baseline evidence; Java validates ownership, dates, exact causal baseline IDs and recomputes the numerical threshold before publishing a card. Category/rule flags for the same transaction are merged. Invalid/failed responses suppress transaction alerts while deterministic insights remain available.

Bounds: at most 5,000 eligible history rows per Python request, 100 baseline rows per comparison, 200 Python signals, 50 feed cards, latest 100 transaction previews per card and 200 category drill-down rows. Totals/counts remain complete, and limited/truncated states are disclosed. Large histories skip optional analysis rather than silently sampling the ledger. The returned evidence only includes current owned transactions.

## Controlled evaluation

Run from `ai-service/` with the existing environment:

```sh
python -m pytest -q
python evaluate_spending.py
uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

The categorization model must already be trained as documented in [AI categorization](ai-categorization.md); spending detection itself needs no trained artifact and never retrains as records change. Evaluation is offline and uses only generated synthetic cases. Results are saved in `ai-service/evaluation/spending-v1.json` (seed 1303):

| Method / cases | Precision | Recall | False-positive rate |
|---|---:|---:|---:|
| Runtime MAD, all 240 controlled cases | 100% | 50.83% | 0% |
| Steady / flat / rich history, 40 cases each | 100% | 100% | 0% |
| Limited history, 40 cases | Undefined (no alerts) | 0% | 0% |
| Uneven history, 40 cases | 100% | 5% | 0% |
| Small-dollar spikes, 40 cases | Undefined (no alerts) | 0% | 0% |
| Offline Isolation Forest, 40 rich-history cases | 85.71% | 90% | 15% |

Overall counts: TP 61, FP 0, FN 59, TN 120. Limited history coverage is zero by design. A one-dimensional log-amount Isolation Forest (50 trees, 5% contamination), fitted only to each synthetic prior history, was evaluated as a lightweight alternative. Its false positives on this narrow benchmark and runtime complexity do not justify adding it to production inference. This comparison cannot establish general superiority. Synthetic labels are constructed expectations, not verified real-world ground truth. Small/uneven anomalies are frequently missed; no real-world accuracy or calibrated confidence is claimed.

## API and manual verification

- `GET /api/insights?range=this_month` returns period/comparison, summaries, category comparisons, monthly flows, recurring analysis, detector status, classified insight cards and owned supporting evidence. Other ranges: `last_month`, `last_3`, `last_6`, `last_12`, `custom&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- `GET /api/insights/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD&categoryId=UUID` returns bounded owned expense evidence and full count. Invalid ranges/inputs return existing Problem Details errors.
- `POST http://127.0.0.1:8000/analyze-spending` is internal optional statistical analysis, not a database endpoint.

Use synthetic data in the existing isolated verification environment for write-based checks. Choose a date range; compare cards/category percentages/monthly rows with transaction history; hover the five charts; open a card's supporting calculations and category drill-down. Confirm that monthly normalized recurring estimates differ from exact dated payments. With fewer than eight prior same-group expenses, expect withheld alerts. With sufficient prior history, an expense above the documented threshold should show its median/evidence. Stop only the owned AI process and refresh: summaries continue with an unavailable-detector explanation. Restore the AI service afterwards. Do not add fake transactions to the personal database to test these behaviors.

Insights reads never process due dates or save preferences. Existing independent recurring startup/poll processing remains active; a real due payment can appear while viewing any page because of that separate worker. Personal integrity checks must account for authorized worker activity rather than claim an insights read suppresses it.

## Verification scope

Automated coverage includes exact totals/filtering/comparisons, missing categories, zero income, refunds/corrections, six recurring estimates, handled/dual links, amount changes, anomaly baselines/abstention, hostile AI evidence, outage/timeouts, read-only storage, chart tooltip values, loading/error/empty states and stale filter responses. Browser acceptance uses only the guarded synthetic database and real local services. See the delivery report for executed regression counts and integrity evidence.

Known limits include unpaginated source ledger loading, conservative fixed thresholds, incomplete-record ambiguity, no semantic merchant/subscription identification, no currency conversion, no alert dismissal persistence and no model probability. Phase 4 should build a separately authorized local assistant grounded in these deterministic contracts, with explicit evidence and abstention, preserving read-only analysis and optional AI.

### Executed delivery checks — October 30, 2026

| Check | Executed result |
|---|---|
| Backend complete H2 suite | 169 passed, 0 failures/errors |
| Backend complete guarded PostgreSQL suite + Maven verify/JAR | 169 passed, 0 failures/errors; executable built |
| Frontend Vitest | 102 passed across 9 files |
| AI pytest | 44 passed; one existing Starlette/httpx deprecation warning |
| Backup worker including native PostgreSQL integration | 35 passed, including 6 native cases |
| Frontend TypeScript/Vite production build | Passed |
| Browser Phase 3 scenarios A–F | 9 checks passed using real local Java/Python, synthetic data, chart hover/drill-down, responsive dark mode; 0 runtime errors |
| Existing dashboard/manual ledger/category-AI browser checks | 6 checks passed; accepted/corrected feedback, edit/delete balance recalculation, mobile layout; fixture ledger restored |
| Real local AI outage | Deterministic exact summaries and manual entry access remained available; no financial writes |
| Personal financial integrity / normal frontend proxy | All four canonical database snapshots and exact balances unchanged; all five preset summaries independently matched SQL |

Browser testing exposed standalone Java client date serialization incompatible with Pydantic. Dates now explicitly use ISO strings, the request-contract test asserts all three date fields, and both full backend suites and real-service browser acceptance were rerun successfully after the fix. A restricted-sandbox test attempt could not open local mock-server sockets/JVM instrumentation; the full suite was rerun with those local permissions and passed. Initial browser harness selector/off-screen-hover failures were corrected and the complete acceptance script rerun; they were not reported as passes.

No personal records were added as fixtures, no applied migrations changed, no schema/configuration updates were made and no new backup/restore cutover was needed. Private before/verification manifests are retained under `~/Library/Application Support/FinSight AI/backups/phase3-verification-20261030T125416Z/`; financial payloads are excluded from repository reports/screenshots. The original database directory stays stopped and retained. Existing test-cluster data is retained after clean shutdown; normal personal PostgreSQL, backend, frontend, updated AI and the approved backup-only agent remain available. No deployment or Git commit was made.
