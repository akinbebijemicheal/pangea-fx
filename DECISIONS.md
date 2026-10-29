# Pangea FX: Design Decisions

**Pangea FX** is named after Pangaea, the single supercontinent with no borders, which fits _Operation Borderless_. It is a sandbox API for multi-currency stablecoin wallets, FX swaps and cross-border transfers (cNGN, cGHS, cXAF, USDx, EURx).

This file records the main technical decisions and the reasons for them. The README summarises them for reviewers.

## Stack

| Area          | Choice                                                                                                                        | Why                                                                                                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework     | **NestJS 12** (ESM) + TypeScript 6 (strict mode)                                                                              | A familiar, structured layout (modules, dependency injection, guards, interceptors) that many Node teams use. Swagger docs are generated from the code, so they can't drift. It costs a few hours of setup over Express, which fits in 48h.                                                            |
| Database      | **PostgreSQL 16**                                                                                                             | A ledger needs ACID transactions, row locks (`SELECT … FOR UPDATE`), an exact `NUMERIC` type, plus `UNIQUE` and `CHECK` constraints. Postgres has all of them built in, which is why it wins over MongoDB.                                                                                             |
| Data access   | **Knex** for migrations and queries, wrapped in a Nest provider                                                               | Keeps locks and transaction boundaries explicit and easy to read. TypeORM and Prisma hide them or make `FOR UPDATE` awkward.                                                                                                                                                                           |
| Validation    | **class-validator** + **class-transformer** DTOs with a global `ValidationPipe`                                               | The standard Nest approach. The same DTOs drive the Swagger schemas.                                                                                                                                                                                                                                   |
| Money         | `NUMERIC(38,8)` in the DB, **decimal.js** in code, amounts sent as **strings** in JSON, never JS floats                       | Exact arithmetic with a defined rounding rule: round **down** on conversion, so the platform never creates value.                                                                                                                                                                                      |
| FX rates      | Live rates from **open.er-api.com** (free, no key), stored as **one quote per currency against USD** in `fx_rates` with a TTL | Every pair is derived from two USD quotes at read time, so cross rates can never contradict each other (no triangular arbitrage). If the live call fails, use the last stored live rates, then the fixed seed rates from the migration. XAF is pegged to EUR at 655.957, which makes a sound fallback. |
| Cache / queue | **None**                                                                                                                      | Doesn't earn its place: Postgres handles idempotency, locking and rate caching. Documented as a known trade-off.                                                                                                                                                                                       |
| Tests         | **Vitest** + **Supertest** against a real Postgres 16 started by **Testcontainers** (`TEST_DATABASE_URL` overrides it)        | Unit tests for money and FX logic. API tests for every endpoint, including concurrency and idempotency. Mocking the DB would hide exactly the bugs that matter.                                                                                                                                        |
| API docs      | **Swagger (OpenAPI 3)** via `@nestjs/swagger`, served at `/docs` and exported to a committed `openapi.json`                   | The spec comes from the DTOs and controllers, so it matches the code. The committed file meets the "spec in the repo" deliverable.                                                                                                                                                                     |
| Tooling       | Yarn, ESLint, Prettier                                                                                                        | Required by the brief.                                                                                                                                                                                                                                                                                 |
| Runtime       | Dockerfile + `docker compose up` (API + Postgres, migrations and seed run on start)                                           | One command to run everything.                                                                                                                                                                                                                                                                         |

## Correctness guarantees

### Money precision

- All amounts are stored as `NUMERIC(38,8)` and handled with `decimal.js`. No `number` type touches money.
- Amounts go in and out of the API as decimal strings (for example `"1500.25"`). Input must be positive and have at most 8 decimal places.
- Converted amounts are rounded **down** to 8 dp. The rate used is stored on the transaction so every conversion can be checked later.

### Idempotency

- An `Idempotency-Key` header is **required** on deposits, swaps and transfers (400 if missing or malformed).
- The key is claimed and the money movement is committed in **one database transaction**. The first request inserts the key (its primary key is the lock), runs the handler in a savepoint and stores the response before committing.
- A duplicate that arrives while the original is in flight blocks on that insert until the original commits, then replays its response. If it waits longer than `IDEMPOTENCY_LOCK_TIMEOUT_MS` (default 5s) it gets **409**.
- A completed key replays the stored status and body with `Idempotent-Replayed: true`. The handler does not run again.
- Reusing a key for a different method, path or body (hashed as canonical JSON) returns **422**.
- A **400** (malformed request, failed validation) is not stored: nothing ran, so the key stays free for the corrected request. This matches Stripe.
- Any other 4xx (404, 422 such as insufficient funds) rolls back the handler's writes to the savepoint and is stored, so a retry gets the same answer. A 5xx or crash rolls back everything including the key, so the client can safely retry.
- Because key and movement commit together, there is no "processing" state a crash could leave stuck.
- Keys are honoured for at least `IDEMPOTENCY_KEY_TTL_HOURS` (default 24h, like Stripe), then deleted by an hourly job (`IDEMPOTENCY_CLEANUP_CRON`). After that the same key counts as a new request. Each transaction keeps its key for audit, without a foreign key, so cleanup never touches the ledger.

### Concurrency

- Each money operation runs in **one DB transaction**.
- Credits are a single atomic `UPDATE balances SET amount = amount + x`, so concurrent deposits cannot lose updates.
- Balance rows are locked with `SELECT … FOR UPDATE` in a **fixed order** (by wallet id, then currency), so two transfers can never deadlock against each other.
- A `CHECK (amount >= 0)` constraint on balances is the last line of defence against negative balances.
- **Every query inside a request uses the request's own connection** (via `TransactionManager`). A request that holds a transaction and then asks the pool for a second connection can starve the pool: 10 concurrent swaps against a pool of 10 hung forever before this rule. The one exception is the shared FX rate write, which runs detached from any request on purpose. Knex's acquire timeout is 10s, so any regression fails loudly instead of hanging.
- Swaps and transfers share one code path (`LedgerService.move`): stored rate, lock both rows, check funds, debit, credit, record. Wallet ids are lower-cased first, so an upper-case UUID in a path or body is the same wallet (Postgres returns UUIDs in lower case).

### FX rate failures

- Fresh live quotes (younger than `FX_CACHE_TTL_SECONDS`) → refresh from the provider → on failure, the last stored live quotes (`cache`) → the fixed seed quotes (`fallback`). A swap or transfer is never blocked because the provider is down.
- Refreshes happen three ways, all single-flight (concurrent callers share one provider call): a daily cron at 00:10 UTC (`FX_REFRESH_CRON`), just after open.er-api.com publishes; a background refresh at boot (`FX_REFRESH_ON_BOOT`); and lazily on read when stored rates outlive the TTL, which covers a missed cron run.
- Sources are always visible: `/rates` names the provider, its URL, update frequency and the attribution its terms require, and every rate carries `provider` and `providerUpdatedAt` (when the provider published it). open.er-api.com publishes once a day, so "live" means its latest daily rate.
- After a failure the provider is not called again for `FX_RETRY_BACKOFF_SECONDS`, so an outage costs one timeout, not one per request.
- A malformed or partial provider response counts as a failure; nothing is stored.
- Responses show each rate's `source` (`live` / `cache` / `fallback`) and `refreshedAt`. A pair reports its weaker leg and older refresh time.
- Applied rates are rounded to 15 significant digits; converted amounts are rounded **down** to 8 dp.

## Data model (initial)

| Table              | Key columns                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currencies`       | `code` (primary key, e.g. cNGN), `name`, `fiat_code` (ISO 4217 peg, used for FX), `sort_order`. Source of truth for supported stablecoins; the app refuses to boot if it disagrees with the code list.                                                                                                                                                                                                               |
| `wallets`          | `id` (uuid), `email` (unique, nullable), `phone` (unique, nullable), `created_at`. At least one of email or phone is required.                                                                                                                                                                                                                                                                                       |
| `balances`         | `wallet_id`, `currency` (FK to `currencies`), `amount NUMERIC(38,8) CHECK (amount >= 0)`, primary key (`wallet_id`, `currency`). One row per currency is created with the wallet.                                                                                                                                                                                                                                    |
| `transactions`     | `id`, `type` (deposit / swap / transfer), `source_wallet_id` (null for deposits), `destination_wallet_id`, `source_currency`, `source_amount`, `destination_currency`, `destination_amount`, `rate NUMERIC(38,18)`, `rate_source`, `rate_provider`, `rate_refreshed_at`, `idempotency_key` (indexed, kept for audit), `created_at`. A CHECK enforces the shape of each type. Indexed by wallet and time for history. |
| `idempotency_keys` | `key` (primary key), `request_hash` (sha256), `response_status`, `response_body` (jsonb), `created_at`                                                                                                                                                                                                                                                                                                               |
| `fx_rates`         | `currency` (primary key, FK to `currencies`), `units_per_usd NUMERIC(38,18) CHECK (> 0)`, `source` (live / fallback), `provider` (required for live rows), `provider_updated_at`, `refreshed_at`. Seeded with fallback quotes by the migration.                                                                                                                                                                      |

## Decisions for the remaining steps

- **Money operations do not call the FX provider.** Swaps and transfers read the stored quotes only, inside their transaction, so a slow or failing provider can never hold locks or delay a payment. The daily cron, the boot refresh and lazy refreshes on `/rates` and balance reads keep those quotes current. The applied rate's `source`, `provider` and refresh time are recorded on the transaction.
- **Debits lock before they check.** A swap or transfer locks every balance row it touches with one `SELECT … FOR UPDATE … ORDER BY wallet_id, currency`, checks funds, then writes. The fixed order means two transfers in opposite directions cannot deadlock. Insufficient funds is a **422**.
- **Amounts are in the source currency.** A swap or transfer request says how much leaves the source balance; the credited amount is `amount × rate`, rounded down to 8 dp.
- **One row per movement.** A transfer is one `transactions` row visible to both wallets; history adds a `direction` (`in` / `out` / `self`) relative to the wallet being viewed.
- **History uses keyset pagination** on `(created_at, id)`, newest first. It is stable while new transactions arrive, unlike offset pagination. Filters: `type` and `currency` (matches either side of the movement).
  - The query is a `UNION ALL` of two index scans (wallet as sender, wallet as receiver excluding its own swaps), which Postgres runs as a Merge Append of two `LIMIT`ed index scans: a page costs O(page size) regardless of history length, with no sort.
  - The opaque cursor carries Postgres's own text form of `created_at`, keeping microseconds. A JS `Date` would round to milliseconds and could skip or repeat rows. Exact timestamp ties are broken by `id`.
  - Known limitation: `created_at` is the transaction's start time, so a transaction that starts earlier but commits later than one already paged past can be missed by a client mid-way through paging. A commit-ordered sequence column would close this.
- **The committed OpenAPI file is checked by a test**, which fails if `openapi.json` no longer matches what the code generates.

## Brief coverage

| Requirement (from the brief)                                                          | Status                                                                                        |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Node.js LTS + TypeScript strict                                                       | Done. Node 22.22+ or 24 (Docker uses 24), `strict` plus extra checks.                         |
| Express or NestJS                                                                     | Done. NestJS 12.                                                                              |
| SQL or MongoDB, justified                                                             | Done. PostgreSQL 16; reasoning above, README to repeat it.                                    |
| Cache/queue only where it earns its place                                             | Done. None used; cron jobs run in-process.                                                    |
| Jest/Vitest + Supertest                                                               | Done. Vitest + Supertest against real Postgres.                                               |
| Yarn, ESLint, Prettier                                                                | Done, plus a pre-commit hook.                                                                 |
| `docker compose up` starts API and dependencies; migrations automatic or one command  | Done. Migrations and seed rates run on boot; `yarn migrate` also exists.                      |
| Create wallet by email or mobile; no duplicates                                       | Done. Normalised, unique in the DB, race-safe.                                                |
| A balance per supported stablecoin                                                    | Done. Currencies table, one balance row each.                                                 |
| All balances plus total in USD                                                        | Done. `GET /wallets/:id/balances`.                                                            |
| Deposit: balance updates immediately, transaction recorded                            | Done. Idempotent.                                                                             |
| Swap within a wallet using FX rates                                                   | Done. `POST /wallets/:id/swaps`.                                                              |
| Live FX preferred, fallback when the provider fails                                   | Done. Live, cache, fallback; daily cron.                                                      |
| Reject swaps that would go negative; never process the same request twice             | Done. Locked funds check (422) and idempotency.                                               |
| Transfer between wallets, same or different currency, auto-convert                    | Done. `POST /wallets/:id/transfers`; `toCurrency` defaults to `fromCurrency`.                 |
| Record sender, receiver, both amounts and currencies, rate, timestamp                 | Done. One `transactions` row per movement, plus the rate's source, provider and refresh time. |
| List a wallet's transactions newest first, paginated, filter by type and currency     | Done. `GET /wallets/:id/transactions` with `direction`, cursor pagination.                    |
| Fetch a transaction by id                                                             | Done. `GET /transactions/:id`.                                                                |
| Current rates between all stablecoins with refresh time                               | Done. `GET /rates`.                                                                           |
| Conventional commit history                                                           | Done.                                                                                         |
| `yarn test` runs the full suite and passes                                            | Done. Needs Docker (or `TEST_DATABASE_URL`); a clear error explains this if missing.          |
| OpenAPI spec committed                                                                | Done. `openapi.json`, checked against the code by a test.                                     |
| README: name, stack, DB choice, setup, tests, walkthrough, data model, money handling | Done. Examples are real captured responses.                                                   |
| Assumptions, known limitations, what's next                                           | Done, in the README.                                                                          |

## Build order (one conventional commit per step)

1. `chore:` scaffold NestJS (TS strict, ESLint, Prettier, Vitest, Dockerfile, compose with Postgres)
2. `feat:` DB migrations and wallets module
3. `feat:` FX service with live → cache → fallback, and the rates endpoint
4. `feat:` deposits with idempotency
5. `feat:` swaps
6. `feat:` transfers
7. `feat:` transaction history (pagination, type and currency filters) and fetch by id
8. `test:` ledger reconciliation (every balance equals the sum of its transactions) and cross-cutting checks
9. `docs:` export the Swagger spec and write the full README
