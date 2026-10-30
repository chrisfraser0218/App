# Local Financial Assistant — Phase 4

Open `http://127.0.0.1:5173/#assistant` with the existing native PostgreSQL, Spring Boot and Vite startup. No new runtime, dependency, database schema, model weights, persistent chat store or service is required. This is a **deterministic offline assistant, not an LLM**. Existing Python categorization and optional spending statistics remain unchanged. Savings Goals are now available in Phase 5; desktop packaging remains unimplemented.

## Architecture and read-only boundary

`FinancialAssistant.tsx` sends a question and optional structured context to `POST /api/assistant/questions`. `AssistantController` validates the request; `AssistantParser` selects a fixed enum intent and validates extracted parameters. `AssistantService` dispatches only to existing owned financial read operations in a read-only repeatable-read transaction. It has no arbitrary SQL, shell, filesystem, restore, backup or financial mutation tools. The method calls and response templates are source-controlled, not chosen by user instructions or record descriptions.

| Operation | Calculation source |
|---|---|
| Spending, category totals, income/monthly income, comparisons | SpendingService summary/category/month rows |
| Largest expenses and recorded evidence | FinanceService owned ledger; exact BigDecimal sort, no new money arithmetic |
| Current actual balance | FinanceService.account |
| Future balance, daily minimum, warnings | ForecastService.forecast |
| Purchase scenario, baseline/difference | ForecastService.evaluate; one transient hypothetical expense |
| Recurring equivalents / exact pending totals | SpendingService recurring analysis, reusing ForecastService |
| Recurring income, next Salary paycheck / payment | ForecastService owned pending recurring events |
| Upcoming bills in selected dates | CalendarService.month projected expense entries |
| Unusual spending | SpendingService's validated optional local Python statistics and deterministic observations |

All displayed money/percentages come from these existing services as exact decimal strings. The assistant formats or selects their results; it does not generate financial arithmetic. Evidence preserves original scheduled/recorded dates, descriptions, categories, source and direction. Forecasts include actual starting funds plus existing pending recurring/open planned events; no future ordinary spending, settlement order or unrecorded income is guessed. Overdue pending flows use existing forecast assumptions. Hypotheticals never become actual payments or plans.

## Supported question patterns

Questions are case-insensitive English templates/keyword patterns, not unrestricted language understanding. Examples:

- “How much did I spend this month?” / “How much did I spend on groceries last month?”
- “What were my largest expenses?” (up to ten expenses, not income).
- “Which categories increased in spending this month?” / “Compare groceries spending last month.”
- “What unusual expenses have I had recently?”
- “What are my recurring expenses?” / “What subscriptions am I paying for?”
- “How much have I earned this year?” / “Income by month this year.”
- “Recurring income next month” / “When is my next paycheck?” / “Next recurring payment.”
- “What is my current actual balance?” / “How much will I have next month?”
- “Lowest projected balance next month” / “Any low-balance warnings next month?”
- “What bills are due next week?” / “Payments due from 2026-12-01 to 2026-12-15.”
- “What if I spend $1,000 in December 2026?” / “Can I afford a $1,000 purchase on 2026-12-01?”
- “How much money will I have in March 2027 if I buy a laptop for $2,000 in November 2026?”

Use the exact expense category names in the transaction form; groceries/grocery aliases are recognized. Multiple categories need separate questions. Unknown category phrases ask for clarification. Income-by-expense-category is unsupported. “Subscriptions” means active recurring definitions explicitly in the Subscriptions category; it does not infer all subscriptions from merchant text. “Paycheck” means recurring INCOME explicitly categorized Salary. Other recurring income is not silently labelled wages.

Historical periods support today/yesterday, this/last week, this/last month, last 3/6/12 months (current month included), this/last year, full named months with optional year, and one/two ISO dates. Historical ranges stop at today, start at 1900 or later, and span at most 1,831 days. Unspecified historical periods default to month-to-date; every answer discloses the actual dates. Future horizons default to one calendar month ahead, next-paycheck/next-payment searches default to 366 days, and next 30 days is inclusive today through day 29. “Next week” means the next Monday through Sunday in the injected business time zone. Upcoming bill periods are bounded to 93 days. Forecast limits remain those of ForecastService (3,660 days and bounded events). For exact days within named months, use YYYY-MM-DD; invalid/unsupported dates ask for clarification.

A future named month without a year means the nearest such month whose end is not past. Historical named months without a year use the current year; future historical queries are rejected. Include years across boundaries to remove ambiguity. Month-only purchases use the first of that month; month-only forecast targets use month-end, explicitly disclosed. A single exact scenario date is both purchase and horizon; with **two dates/months put the forecast target first and purchase date second**. Purchase amounts must be positive, at most 12 integer/two fractional digits, with valid optional comma grouping. Missing amounts/dates, conflicting dates, unsupported intervals and multi-topic questions ask for clarification rather than create an inferred plan.

## Follow-up context and interface

After a historical spending/income/largest/comparison/unusual question, the response supplies typed intent/category/date context. “What about the month before?” keeps the category/operation and moves to the preceding calendar month when the previous period was within one month. “What about groceries last month?” can select another known category/date. A multi-month “month before” or a topic change without a full question asks for clarification. Forecast/scenario answers do not carry hypothetical amounts into follow-ups. Context is revalidated on every request, including category ownership, allowed intents and historical date bounds. It cannot select a tool, account or arbitrary operation.

The chat shows user/assistant bubbles, eight suggested questions, busy/error/retry states, kind labels (actual, projected, estimate, statistical, hypothetical or limitation), exact dates, metrics, expandable assumptions/evidence and allowlisted links to the existing pages. It retains at most 20 exchanges in page memory. Clear aborts a pending request and removes context/messages; navigation/reload clears the conversation. Nothing is saved to localStorage, database, logs, backups, analytics or an external service. The existing theme setting remains separate. Old answers are snapshots, so ask again after modifying records elsewhere. Only one request is active at a time; aborted requests cannot repopulate a cleared conversation.

## Interpretation and limits

- Totals describe recorded cash flow, not verified complete bank activity. Empty records are disclosed, not interpreted as proof of no spending/income.
- Expenses are gross; refunds recorded as income are not semantically netted by category.
- Spending comparisons reuse the preceding **equal-length interval**, whose exact dates are shown, rather than pretending it is always a full preceding calendar month. For the existing matched-day month-to-date card, open Spending Insights.
- Recurring estimates describe current active definitions, independently of selected historical dates; their Gregorian normalization is documented in Spending Insights. Actual recurring totals use posted linked expenses in selected historical dates. Exact pending month/30-day totals are separate from monthly equivalents. Subscriptions category questions list matching current definitions without inventing historic rates or category subtotals.
- Paycheck/next-payment answers show all ties on the earliest matching scheduled date, excluding handled/posted receipts. Scheduled income is expected, not received. Bills show pending calendar expenses, including open plans, with original scheduled dates; overdue projected items retain their source dates.
- A forecast/scenario is conditional. A nonnegative projected balance is not an affordability guarantee; intraday settlement, unentered bills and emergencies are not known. No investment/professional advice is generated.
- Statistical observations retain Phase 3's conservative baselines, limited coverage and AI outage behavior. No confidence probability or fraud conclusion is invented.
- Evidence previews are at most 30 rows (ten largest); counts/totals retain their stated full scope. Underlying services remain unpaginated/bounded as previously documented. Unusual results inherit the 50-card feed/evidence limits. General reasoning, multi-turn hypothetical editing, fuzzy merchant/category matching and arbitrary natural-language date arithmetic are intentionally unsupported.

## Privacy and security

Questions use a JSON POST body, not URL query/history parameters. Existing loopback bindings, origin/host checks, stateless Spring security, no-store response headers, validation and server-selected ownership apply. The endpoint stores no chat. No LLM is installed or invoked. The existing optional Python service receives only Phase 3's minimal owned features; user messages/context are never forwarded to it. No raw database or financial mutation endpoint is exposed as a tool. Mutation/instruction/SQL/shell/exfiltration-like requests are rejected; retrieved descriptions stay data and React renders them as escaped text. Source links are restricted to application sections.

This boundary does not introduce authentication or isolate the app from other processes already on the Mac; existing local security limitations remain. Normal independent recurring/backup workers still run according to prior authorization. Viewing the assistant suppresses the frontend's process-due POST; its read-only questions neither trigger nor disable the independent workers. Financial integrity verification distinguishes those independent activities from assistant operations.

## Optional local language model assessment — no installation authorized

Inspected hardware: Apple M5 MacBook Air, 10 CPU cores, 16 GiB unified memory, approximately 237 GiB available disk. The existing local AI infrastructure is Python/FastAPI + saved scikit-learn models/statistics. Neither an `ollama` executable nor `/Applications/Ollama.app` was present. No runtime/model installation, download or persistent service change was performed.

A possible later experiment is **Ollama with Qwen2.5 3B Q4_K_M**. The [official model tag](https://ollama.com/library/qwen2.5:3b) lists approximately 1.9 GB of weights. Allow roughly 3–4 GB free disk for the runtime, one model and overhead (additional models multiply storage); estimate 3–5 GB working memory at a short, e.g. 4K, context. The working-memory figure is a planning estimate, not a measurement; context cache, runtime version and other apps affect it. On this 16 GiB machine it is a plausible modest model with headroom, but comfort/speed/thermal behavior must be measured alongside Java/PostgreSQL/Python before adoption. A larger model or full advertised context is not assumed comfortable. Review the exact model license for intended use before installation.

The current assistant needs **no LLM** and already works offline. A later approved model should only produce validated structured read-only intents or explain verified results, with cloud features disabled, loopback-only inference, no runtime downloads/telemetry, strict token/time/resource limits, and deterministic fallback. It must not independently calculate money or get SQL/filesystem/mutation tools. Installation and weight downloads require separate explicit owner approval; this assessment is not installation authorization.

## API

`POST /api/assistant/questions`

```json
{"question":"How much did I spend on groceries last month?","context":null}
```

A response includes `status` (`answered`, `clarification`, `unsupported`), `mode` (`deterministic`), `kind`, title/text, as-of/from/to dates, decimal-string metrics, evidence/count, assumptions, fixed source links, suggested questions and optional context. Replay only the supplied context on the next question. Unknown fields, blank/over-1,000-character questions, invalid context enums/dates or malformed JSON fail validation with existing Problem Details. Recognized uncertainty/unsupported requests return HTTP 200 with an explicit non-answer status. Existing service limits/errors remain errors; the frontend presents retry. No stream or persisted conversation ID is used.

## Manual testing

1. Open `/#assistant`, confirm the deterministic/offline disclosure and click a spending suggestion. Check dates, amount, source and transaction preview against Spending Insights.
2. Ask a groceries question for last month, then “What about the month before?” Confirm the same category and earlier calendar month. Clear, repeat the follow-up alone and expect clarification.
3. Ask for next month's balance; choose that exact month-end in Balance Forecast and compare. Ask for the lowest balance and low-balance warnings too.
4. Ask about bills next week and compare original dates/amounts with the Bill Calendar. Check a next Salary paycheck against Recurring Transactions.
5. Ask a hypothetical purchase with an explicit amount/date; compare with an unsaved Phase 2C scenario. Actual balance, ledger, plans and preferences must remain unchanged.
6. Ask a general or mutation question; expect an unsupported answer with no action. Unknown dates/categories should ask for clarification.
7. With sufficient synthetic prior history only, stop the owned optional AI service, ask about unusual spending and confirm an unavailable/limited explanation while other financial questions continue; restart it afterwards.
8. Test dark mode/mobile, clear, retry and reload. Conversation must not survive reload/navigation. Use **only the established isolated synthetic environment** for fixture creation/screenshots; never add fake personal records.

Executed delivery counts, acceptance and integrity results are recorded below after final verification.

### Executed delivery verification — October 30, 2026

| Check | Result |
|---|---|
| Full backend H2 suite | 213 passed; zero failures/errors |
| Full guarded isolated PostgreSQL suite and Maven verify | 213 passed; zero failures/errors; executable JAR built |
| Full frontend Vitest suite | 115 passed across 10 files |
| Existing Python AI suite | 44 passed; one pre-existing Starlette/httpx deprecation warning |
| Existing backup worker suite | 35 passed, including six native PostgreSQL cases |
| TypeScript/Vite production build | Passed |
| Browser scenarios A–G | Eight checks passed against final build, including real source-page forecast agreement, calendar dates/amounts, category totals/follow-up, hypothetical read-only fingerprints and unsupported/injection refusal |
| Existing manual ledger/category AI browser regressions | Six checks passed: dashboard, create/edit/delete balance calculations, real AI acceptance/override feedback, stale/unknown suggestions and mobile layout; original synthetic ledger restored |
| Real optional Python outage | Core questions remained usable; statistical question explicitly reported unavailability |
| Desktop/mobile dark mode, evidence, source links and privacy | Passed; zero browser runtime errors; synthetic question not present in backend log |

All write-based checks and screenshots used only the established isolated cluster and named synthetic fixtures. Final API validation rejected invalid ranges/amounts, unsupported topics, mutation requests and forged context. Initial automated tests exposed multi-topic ambiguity and a duplicate test selector; these were corrected and full suites rerun. Review also added regressions for four-digit amounts, reversed future intervals, compare/change phrasing, irrelevant “learn” wording and retrying with the original context. All reported pass counts are executed final results. No migration or personal fixture writes were needed.

Final normal-application verification also passed: ten assistant questions through the standard frontend proxy (including a hypothetical), correct actual balance, no-store responses, unchanged forecast responses and independently matched insight totals. All four preserved source databases retained identical canonical rows/counts/sequences/exact balances; applied Flyway history and native PostgreSQL configuration matched the fresh pre-work snapshots. Existing protected backup dump/manifest/checksum fingerprints matched. Private evidence is at `~/Library/Application Support/FinSight AI/backups/phase4-verification-20261030T160713Z/`. No personal financial payloads were printed or placed in repository reports/screenshots.

The original `/tmp/finsight-pgdata` remains stopped and untouched. The existing isolated test cluster was cleanly stopped and its data retained. Normal personal PostgreSQL/backend/frontend, existing local Python AI and the approved backup-only LaunchAgent remain available. No new persistent service, database migration, model/runtime installation, deployment or Git commit was made.

## Phase 5 savings questions

The deterministic assistant now reads SavingsService for exact saved/remaining/progress/required-monthly/completion values, with explicit recorded-allocation or allocation-estimate labels and a Savings Goals link. Use exact goal names; duplicate/ambiguous goals ask for clarification. A sole goal can resolve “my savings goal” or “my target.” Closest compares displayed progress and reports ties. Source contributions remain separate from bank transactions; the assistant cannot create goals/entries, edit schedules or perform transfers. No goal conversational context or language model is added. See [savings assumptions and language limits](savings-goals.md#assistant-and-insights-integration).
