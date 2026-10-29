# Local API

Base: `http://127.0.0.1:8080/api`. JSON writes only; no authentication in Phase 1. All endpoints implicitly use the server-selected demo user/account. Errors use HTTP status codes and Spring Problem Details; validation responses include an `errors` array.

| Method | Path                               | Result                                                                 |
| ------ | ---------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/account`                         | Opening balance, all-time income/expenses, remaining balance, currency |
| PUT    | `/account/starting-balance`        | Updated account totals                                                 |
| GET    | `/categories`                      | Available demo categories and their transaction types                  |
| GET    | `/transactions`                    | Owned transactions, newest date/creation first                         |
| GET    | `/transactions/{id}`               | Owned transaction; missing/foreign id returns 404                      |
| POST   | `/transactions`                    | 201, created transaction and Location header                           |
| PUT    | `/transactions/{id}`               | 200, full replacement of editable fields                               |
| DELETE | `/transactions/{id}`               | 204; missing/foreign id returns 404                                    |
| GET    | `/summaries/monthly?month=2026-10` | Monthly income/expenses and expense category totals                    |

The summary defaults to the server's current month if omitted. Invalid month strings return 400. Transaction amounts must be positive, finite decimal values with at most two fractional digits and twelve integer digits. Opening balance may be negative or zero. Descriptions must be nonblank and at most 160 characters. Dates use `YYYY-MM-DD` and cannot be in the future. Category type must match `INCOME` or `EXPENSE`. Unknown input properties are rejected.

Start with `GET /categories` and use a returned category UUID:

```sh
curl http://127.0.0.1:8080/api/categories
curl -X PUT http://127.0.0.1:8080/api/account/starting-balance \
  -H 'Content-Type: application/json' -d '{"startingBalance":"2500.00"}'
```

Example transaction request body (replace category UUID and use today's date or earlier):

```json
{
  "description": "Weekly groceries",
  "amount": "86.42",
  "type": "EXPENSE",
  "categoryId": "<UUID from GET /categories>",
  "date": "2026-10-29"
}
```

POST and PUT use the same body. Monetary request strings preserve exact decimal input. Responses contain JSON decimal numbers; frontend numbers are for display/charting and never used to calculate the authoritative balance. List endpoints are unpaginated for Phase 1.

## Category suggestions (Phase 2A)

`POST /api/category-predictions` accepts `{ "description": "Starbucks Coffee", "amount": "8.75" }`. It returns `predictionId`, canonical `category`, mapped `categoryId`/`categoryName`, actual `confidence`, `modelVersion`, and `status` (`suggested`, `unknown`, `uncertain`, or `unavailable`). An unavailable AI service does not fail transaction entry.

Transaction POST/PUT now accepts optional `predictionId` in addition to the unchanged Phase 1 fields. Java validates the stored prediction's owner, description, amount, and expense type; it records the final category as accepted/corrected in the same database transaction. Omit the ID when no current suggestion exists. Confidence and model metadata cannot be written by the client. See the [AI guide](ai-categorization.md) for contracts, mappings, and feedback semantics.

## Recurring transactions (Phase 2B)

All routes are under `/api/recurring-transactions`: list/get/create, future-only PUT edits, PUT `/{id}/state` for pause/resume, POST `/{id}/stop` for cancellation, POST `/process-due`, GET `/{id}/history`, GET `/{id}/occurrences?from=...&to=...`, and POST `/{id}/reconcile` for explicit manual association or handled-only dates. Create requires a stable UUID requestId; edits/state/cancel require the current version. Existing transaction responses now add nullable recurringRuleId and occurrenceDate provenance. Existing manual transaction inputs and balance calculations are unchanged.

See [full contracts and recurrence semantics](recurring-transactions.md#api).
