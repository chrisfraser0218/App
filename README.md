# FinSight AI

A personal finance workspace built with React, TypeScript, Java 21, Spring Boot, and PostgreSQL. Phase 1 delivers a functional local demo: record income and expenses, set an opening balance, and understand spending through interactive charts.

**Local demo only.** The application uses a clearly labelled Alex Morgan demo account. There is no production authentication. The API and database bind to loopback; do not expose them with tunnels, public interfaces, or deployment services. AI features are planned, not implemented.

![FinSight AI financial dashboard in light mode](docs/screenshots/dashboard-light.png)

[Dark mode](docs/screenshots/dashboard-dark.png) · [Mobile view](docs/screenshots/dashboard-mobile.png)

## Features

- Responsive overview and transaction history, sidebar navigation, and persistent light/dark theme.
- Starting balance editor; income/expense creation, editing, and confirmed deletion.
- Available balance derived from opening balance + all recorded income − all recorded expenses.
- Selected-month income, expenses, daily cash flow, and category breakdown with Recharts tooltips.
- Transaction search by description/category, type filtering, and month selection.
- Loading, empty, validation, success, and retryable error states; accessible labels and native modal dialogs.
- PostgreSQL persistence, versioned Flyway migration, JPA validation, user-scoped queries, JSON problem responses, and decimal arithmetic.
- First-run sample data in the current month. Existing records and deletions survive restarts.

## Prerequisites

- Java **21** and Maven **3.9+** (`java -version`, `mvn -version`).
- Node **22.x, version 22.12 or newer**, and npm.
- Docker Desktop or Docker Engine with Compose v2, running locally.

## Run locally

From the repository root, create your local configuration:

```sh
cp .env.example .env
```

Edit `.env` and set a local database password. Keep `POSTGRES_PASSWORD` and `DB_PASSWORD` equal, and `POSTGRES_USER` and `DB_USERNAME` equal. `.env` is ignored by Git. No real credentials ship with the application.

Start PostgreSQL:

```sh
docker compose up -d --wait
```

In a backend terminal, export the configuration and launch the API:

```sh
set -a
source .env
set +a
cd backend
mvn spring-boot:run
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to **127.0.0.1:8080**, so there is no cross-origin frontend configuration. The server seeds an everyday USD account with a $2,500 opening balance and sample transactions at first startup. Change the starting balance and create an expense to see the available balance and charts refresh.

The default configuration expects the root `.env` to be exported before launching the backend; Spring does not automatically load that file. Example values use plain shell-compatible assignments; quote values containing spaces or shell metacharacters. All data is stored in the Compose named volume. `docker compose down` stops the database without deleting it.

## Verify

```sh
cd frontend
npm test
npm run build
```

```sh
cd backend
mvn verify
```

The backend suite starts the full application with MockMvc, Flyway, and H2 in PostgreSQL compatibility mode. It covers CRUD, exact decimal balances, starting balance changes, invalid values, category/type validation, calendar-month summaries, data isolation, and local access restrictions. Tests roll back their changes.

To run the same suite against an **isolated test PostgreSQL database**, set its URL, username, and password as Java system properties (never use a database containing data you want to keep):

```sh
mvn test \
  -Dspring.datasource.url=jdbc:postgresql://localhost:5432/finsight_test \
  -Dspring.datasource.username="$PG_TEST_USER" \
  -Dspring.datasource.password="$PG_TEST_PASSWORD"
```

The test suite deletes transactions inside rollback-only test transactions. CI runs both H2 and PostgreSQL 17, plus frontend tests and the production build. CI derives a disposable test-service password from workflow run metadata; it contains no deployed credentials.

For a backend artifact, run `mvn package` and then `java -jar target/finsight-api-0.1.0.jar` with database environment variables exported. `npm run build` creates frontend assets in `frontend/dist`. Use `npm run dev` for the documented integrated local demo.

## Structure

```text
finsight-ai/
├── frontend/
│   ├── src/                 # App state, API client, formatting, styles, tests
│   │   └── components/      # Charts, cards, table, form, modal, icons
│   ├── package.json
│   └── vite.config.ts       # React, Tailwind, loopback dev proxy
├── backend/
│   ├── src/main/java/com/finsight/
│   │                        # REST controllers, service, entities, repositories, security
│   ├── src/main/resources/
│   │   ├── application.yml
│   │   └── db/migration/    # Flyway SQL
│   ├── src/test/            # Full-context API tests
│   └── pom.xml
├── docs/
│   ├── architecture.md
│   └── api.md
├── .github/workflows/ci.yml
├── .env.example
└── compose.yaml
```

## Configuration

| Variable                                              | Purpose                         | Default                                     |
| ----------------------------------------------------- | ------------------------------- | ------------------------------------------- |
| `DB_URL`                                              | JDBC connection                 | `jdbc:postgresql://localhost:5432/finsight` |
| `DB_USERNAME` / `DB_PASSWORD`                         | Backend database credentials    | Required                                    |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Compose database initialization | Required                                    |
| `PORT`                                                | Backend loopback port           | `8080`                                      |

If changing `PORT`, also change the Vite proxy target and allowed local origins. Prefer the documented default ports. Database initialization environment variables only apply to a fresh PostgreSQL volume; changing a password in `.env` does not change an existing database user's password.

## Scope and next steps

Phase 1 supports one demo user, one USD account, and predefined categories. Future-dated transactions are rejected. Available balance includes every recorded transaction; month selection changes charts, summary totals, and visible history, not that balance. Starting balance is an opening amount, not a transaction or a dated balance adjustment.

Next: introduce authenticated principals and ownership authorization tests before any public exposure; add pagination and API-driven search; add budgets and savings goals through new migrations; add browser end-to-end tests; then design the separate FastAPI categorization service. Forecasting, unusual-spending detection, and an assistant follow only after the core product and data pipeline are established. AWS deployment is out of scope.

See [architecture](docs/architecture.md) and [API examples](docs/api.md).

## Implementation verification

Verified on October 29, 2026 with Java 21 and Node 22:

- Backend: **14 tests passed** on both H2 and local PostgreSQL 15, including the actual Flyway migration; executable jar built successfully.
- Frontend: **3 unit tests passed**; TypeScript and optimized Vite build passed.
- Chromium smoke check: income/expense creation, edit, delete, opening balance updates, exact resulting balances, search, empty month, dark-mode persistence, mobile navigation and table scrolling, and API error/retry passed with no JavaScript runtime errors.
- Screenshots captured from the integrated application in light, dark, and mobile layouts.
- Frontend dependency audit: no reported vulnerabilities at verification time.

Docker was unavailable on the implementation machine, so Compose startup was not executed. The real PostgreSQL checks used an isolated local PostgreSQL 15 instance; CI is configured to repeat the suite on PostgreSQL 17. CI itself has not run remotely. Browser smoke tooling was temporary and is not a required project dependency; adding a maintained browser suite is a recommended next step.
