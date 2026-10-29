# Architecture and decisions

```mermaid
flowchart LR
  Browser[React + TypeScript] -->|same-origin /api via Vite| API[Spring Boot REST API]
  API --> Service[Transactional finance service]
  Service --> JPA[Spring Data JPA]
  JPA --> DB[(PostgreSQL)]
  Flyway[Versioned Flyway migrations] --> DB
```

The frontend is an independent Vite application. It loads account totals, transactions, categories, and a monthly summary from the API. Mutations refetch data; request generations prevent an older month request overwriting a newer one. Error states keep retry explicit. The service is the source of truth for account balances and summaries. Recharts uses JavaScript numbers only for visualization; monetary writes send decimal strings, and daily chart aggregation works in integer cents.

The backend is organized as a small feature package with controller/DTO, service, persistence, and security boundaries. API records prevent entities and ownership fields from leaking into writes. JPA transactions keep each mutation atomic; optimistic version columns protect simultaneous database updates. This does not provide stale-client ETag protection: sequential updates use last-write-wins. Flyway owns schema creation; Hibernate validates it rather than silently altering tables.

## Data model

- `users`: UUID, unique email, display name, optional future password hash, creation timestamp. Demo user cannot authenticate.
- `accounts`: owner, currency, precise opening balance, optimistic version. Ownership composite key supports referential constraints.
- `categories`: owner, name, income/expense type. Categories cannot be selected across owners.
- `transactions`: owner, account, category, positive decimal amount, type, local date, creation timestamp, version. Composite foreign keys require the same owner on account/category. Service validation also requires matching category type.

Money uses PostgreSQL `NUMERIC(19,2)` and Java `BigDecimal`. API amounts allow up to 12 integer digits and two decimal places; aggregates retain the wider database precision. Negative opening balances are permitted; transaction direction is represented by type, never a negative amount. Dates are calendar dates. The demo seed and default API month use the backend's local date; the UI explicitly requests the user's selected month. The product currently assumes a single USD account and local use.

Balance is calculated from the ledger on read: opening balance + income − expenses. There is no mutable cached balance to drift after edits/deletes. Monthly summaries group expense entries by category and filter by calendar month; income is reported separately. Phase 1 reads all owned transactions to keep the implementation small. Introduce database aggregation, pagination, and date indexes based on measured use before scaling.

## Local demo boundary

`DemoIdentity` supplies a fixed user and account on the server. Clients cannot choose an owner or account through input. Every read/write is scoped to that identity. Database constraints enforce consistent ownership; service tests verify foreign data remains inaccessible. This is data-scoping scaffolding, **not authentication**: anyone who can reach this local API can act as the demo user.

Spring binds to 127.0.0.1. Compose publishes PostgreSQL only on 127.0.0.1. The security filter rejects unexpected hostnames and browser origins; cross-origin access is disabled. Mutations require JSON, and the application uses no session/cookie authentication, so CSRF token processing is disabled for this demo. Revisit CSRF, CORS, sessions/tokens, secret management, request limits, and authorization when real authentication is added. Never expose this configuration publicly.

Sample data is created atomically only when the fixed demo account does not exist. Restarting leaves user edits and deletions intact. No machine learning, fake predictions, or financial advice is presented.

## Extension points

Replace `DemoIdentity` with a trusted principal-derived context and explicit account selection plus ownership checks. Add budgets and goals as owner-scoped tables in subsequent migrations. Extract feature packages as the code grows. Introduce a separate Python/FastAPI service for categorization only after labelled data, privacy boundaries, and failure behavior are designed; do not couple ledger writes to ML availability.
