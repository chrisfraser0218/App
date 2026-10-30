# Bill Calendar — Phase 2D

Open **Bill Calendar** at `http://127.0.0.1:5173/#calendar`. The calendar runs in the existing local browser application; no extra dependency, service, schema migration, Docker, subscription, external API, or desktop packaging is required.

## Using the calendar

Navigate with previous/next month, **Current month**, or the month/year selectors. Today's date is marked. Select a day to inspect its exact starting/projected closing balance, recurring income/expenses, planned income/expenses, recorded activity, source/category/type/status, and low/negative balance warnings. Day cells show at most two activity chips, with **+N more** leading to the complete details. Income/expense colors are supplemented by text and status labels. On narrow screens the month scrolls horizontally, keeping amounts readable; the details and summary cards adapt to the available width.

Date buttons use roving keyboard focus: arrows move one day or week, Home/End select the week's first/last day, and Enter/Space selects a focused date. Arrow navigation across a month loads that month and restores focus. Navigation controls, selector labels, full date/activity/balance accessible names, selected state, and today's date are exposed to assistive technology. Requests are canceled/ignored when superseded; failed reads show a retry action without guessing balances.

Select a **future** date and choose **Add planned expense** or **Add planned income**. The existing Phase 2C form opens with that exact date and direction. Saving creates one ordinary plan with its existing idempotency request key. It changes projections, never actual balance. **Manage planned transaction** reuses the existing versioned edit, confirmed cancellation, and explicit record/link/handled completion workflow. Due plans may explicitly record a payment; early payments can be linked with amount-difference confirmation. Plans never auto-post. Source links open the original recurring schedule with its history/upcoming details, or the recorded transaction history.

## Meaning of activity and balances

- **Upcoming / overdue, recurring or planned**: projected pending cash flows from `ForecastService`. Original due dates remain visible. Pending overdue items are projected on today, exactly as in Balance Forecast.
- **Completed / reconciled, recorded**: real ledger payments, already included in actual balance. A payment linked to both a schedule and a plan is still one recorded row. Calendar projection totals do not add it again.
- **Completed/reconciled markers on a different planned/scheduled date**: identify an intention that was already paid on another date. These markers have no additional cash effect; the recorded row remains on the actual transaction date.
- **Canceled plans**: remain visible with cancellation styling, excluded from projections. Canceled or paused recurring definitions produce no active future entries. Previously posted payments remain visible; the original schedule can still be opened.
- **Handled / removed receipts**: permanent proof that an occurrence must not be recreated. Where the old receipt contains no amount/category/type snapshot, those fields are explicitly unavailable; the current schedule is not used to invent historical values.
- **Overdue historical plans**: past intentions, not recorded activity. They remain manageable, with their unposted amount included in today's forecast rather than retrospectively changing a historical balance.

Historical balances are intentionally **unavailable**: the opening balance is undated and has no revision history. Past dates show recorded activity and completion/cancellation markers, never a fabricated actual balance. Today/future values are always labeled **projected**, even when no pending transaction changes that balance. Actual balance remains available from the dashboard/Balance Forecast.

Summary cards cover the **selected month**: pending upcoming expenses, pending expected income, next pending bill in that month, projected month-end closing balance, and lowest projected balance. Current-month projections cover today onward; earlier recorded activity is already in actual balance and excluded from pending totals. Future-month totals and ending balance match the corresponding **monthly row** in Balance Forecast. Daily values match its exact daily rows. The monthly minimum includes the carried starting balance and each daily close in that month; the forecast page's overall minimum may occur in a different month. Historical month-end/minimum balances remain unavailable.

## Implementation and API

New frontend components/resources:

- `BillCalendar.tsx`: navigation, summary cards, scrollable monthly grid, day panel, source navigation, and shared plan management.
- `calendar.ts`: calendar DTOs and presentation-only date navigation/padding helpers; no recurrence or money arithmetic.
- `BillCalendar.test.tsx`: calendar behavior, navigation, forms, errors, stale responses, keyboard control, and leap-month rendering.
- Existing `PlanForm`, `PlannedTransactions`, and `RecurringTransactions` accept optional calendar date/type/plan/schedule context. Existing callers retain their behavior.

**GET `/api/calendar?month=2026-11`** returns one month (`month` defaults to the injected business clock's current month):

```text
month, asOfDate, timeZone, minMonth, maxMonth, lowBalanceThreshold,
historicalExplanation,
summary { upcomingExpenses, expectedIncome, nextBill,
          monthEndBalance, lowestBalance, lowestDate },
days[] { date, today, projection, flows, warnings, entries[] }
```

`projection` is the existing Phase 2C day DTO unchanged. `flows` contains exact scheduled/planned income/expense subtotals using the existing forecast summation helper. Past projection/flows are null. `entries` identify source, status, original scheduled date, schedule/plan/actual IDs, decimal-string amount or explicit null, projected flag, and explanatory note. All monetary arithmetic remains `BigDecimal`; JavaScript handles display formatting only.

`CalendarService` composes the existing `ForecastService` once per requested month and queries only that month's recorded activity, plans/status markers, and occurrence receipts. A future month necessarily carries the forecast forward from today to establish its opening balance, but only the selected month's days/events are returned. It does not issue per-day or per-rule occurrence requests. Existing Phase 2B `RecurrenceDates`, cursors, start/end rules, pause/resume skips, clamping/leap behavior, and durable receipt exclusions remain authoritative. No duplicate scheduling or forecasting engine was introduced.

The full composition uses one read-only **REPEATABLE READ** transaction, so recorded payments, receipts, plans, and projection share a database snapshot. Calendar reads never post recurring dates, persist preferences, create predictions/feedback, modify a plan, or save forecast output. The frontend suppresses its ordinary process-due POST while the calendar is open. The independent existing recurring startup/poll worker continues normally; a subsequent snapshot can legitimately change after an authorized payment posts.

Existing mutation APIs are reused unchanged: `/planned-transactions` and its versioned edit/cancel/complete actions; `/recurring-transactions` and its existing actions/reconciliation; and `/transactions` for actual history. Calendar money responses are decimal strings. Server-selected ownership, local host/origin checks, JSON-only mutations, and database isolation safeguards remain in force.

## Verification

Executed **123 backend tests on H2 and independently on the existing isolated PostgreSQL cluster**, **74 frontend tests**, and **27 AI service tests**. Backend executable packaging and optimized frontend build passed. The 28 calendar backend cases include every frequency, month/year boundaries, February/leap years, pause/resume/cancel, edits/end dates, decimal totals, plans/completion/idempotency, reconciliation and deleted receipts, warnings, exact daily/monthly forecast agreement, empty/historical months, ownership, invalid ranges, and read-only preservation.

Synthetic Chromium acceptance passed all five requested scenarios with 18 checks: rent on the clamped month-end date, exact biweekly paydays, a $500 calendar-created plan with unchanged actual balance, recurring cancellation preserving recorded history, and exact selected-date comparison with the Balance Forecast interface. Additional workflows exercised planned income, editing, cancellation, early manual linking with amount confirmation, warnings, source navigation, historical/empty months, keyboard navigation, desktop and mobile dark mode, with no runtime errors. Personal records were never used for browser writes or screenshots.

Tests use the existing guarded `finsight_verification` database on the already-existing isolated native cluster at 55434. No new PostgreSQL cluster was initialized. Synthetic browser fixtures use a separate database in that same isolated cluster. See the [README](../README.md#verify) for commands and [database integrity report](database-migration.md#phase-2d-read-only-calendar-update) for personal-data verification.

## Limits and next steps

The calendar supports historical months from January 1900 through the last full month within the existing 3,660-day forecast horizon, retaining the forecast's 100,000-occurrence safety limit. It is single-account USD, Sunday-first, uses the shared business time zone (default America/New_York), and shows closing balances rather than intraday or bank-settled funds. It does not edit recurring dates by dragging, infer duplicates, retain discarded historical schedule versions, invent receipt metadata, or synchronize external calendars/banks. Browser verification uses Chromium; macOS WKWebView packaging/accessibility acceptance remains a later phase.

Recommended Phase 2E scope: agree on and implement automatic **local** backups, retention safeguards, and verified restoration/recovery UX before desktop packaging. Keep personal data offline, versioned migrations guarded, and all backup/restore tests isolated. Phase 3 AI spending insights, desktop service supervision/packaging, cloud hosting, and deployment are not included.
