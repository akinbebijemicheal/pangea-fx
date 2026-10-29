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
- A duplicate that arrives while the original is in flight blocks on that insert until the original commits, then replays its response. If it waits longer than 5s it gets **409**.
- A completed key replays the stored status and body with `Idempotent-Replayed: true`. The handler does not run again.
- Reusing a key for a different method, path or body (hashed as canonical JSON) returns **422**.
- A 4xx from the handler rolls back its writes to the savepoint and is stored, so a retry gets the same answer. A 5xx or crash rolls back everything including the key, so the client can safely retry.
- Because key and movement commit together, there is no "processing" state a crash could leave stuck, and no movement without its key (`transactions.idempotency_key` is a unique foreign key).

### Concurrency

- Each money operation runs in **one DB transaction**.
- Credits are a single atomic `UPDATE balances SET amount = amount + x`, so concurrent deposits cannot lose updates.
- Balance rows are locked with `SELECT … FOR UPDATE` in a **fixed order** (by wallet id, then currency), so two transfers can never deadlock against each other.
- A `CHECK (amount >= 0)` constraint on balances is the last line of defence against negative balances.

### FX rate failures

- Fresh live quotes (younger than `FX_CACHE_TTL_SECONDS`) → refresh from the provider → on failure, the last stored live quotes (`cache`) → the fixed seed quotes (`fallback`). A swap or transfer is never blocked because the provider is down.
- Refreshes happen three ways, all single-flight (concurrent callers share one provider call): a daily cron at 00:10 UTC (`FX_REFRESH_CRON`), just after open.er-api.com publishes; a background refresh at boot (`FX_REFRESH_ON_BOOT`); and lazily on read when stored rates outlive the TTL, which covers a missed cron run.
- Sources are always visible: `/rates` names the provider, its URL, update frequency and the attribution its terms require, and every rate carries `provider` and `providerUpdatedAt` (when the provider published it). open.er-api.com publishes once a day, so "live" means its latest daily rate.
- After a failure the provider is not called again for `FX_RETRY_BACKOFF_SECONDS`, so an outage costs one timeout, not one per request.
- A malformed or partial provider response counts as a failure; nothing is stored.
- Responses show each rate's `source` (`live` / `cache` / `fallback`) and `refreshedAt`. A pair reports its weaker leg and older refresh time.
- Applied rates are rounded to 15 significant digits; converted amounts are rounded **down** to 8 dp.

## Data model (initial)

| Table              | Key columns                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `currencies`       | `code` (primary key, e.g. cNGN), `name`, `fiat_code` (ISO 4217 peg, used for FX), `sort_order`. Source of truth for supported stablecoins; the app refuses to boot if it disagrees with the code list.                                                                                                                                                                                                 |
| `wallets`          | `id` (uuid), `email` (unique, nullable), `phone` (unique, nullable), `created_at`. At least one of email or phone is required.                                                                                                                                                                                                                                                                         |
| `balances`         | `wallet_id`, `currency` (FK to `currencies`), `amount NUMERIC(38,8) CHECK (amount >= 0)`, primary key (`wallet_id`, `currency`). One row per currency is created with the wallet.                                                                                                                                                                                                                      |
| `transactions`     | `id`, `type` (deposit / swap / transfer), `source_wallet_id` (null for deposits), `destination_wallet_id`, `source_currency`, `source_amount`, `destination_currency`, `destination_amount`, `rate NUMERIC(38,18)`, `rate_source`, `rate_provider`, `rate_refreshed_at`, `idempotency_key` (unique FK), `created_at`. A CHECK enforces the shape of each type. Indexed by wallet and time for history. |
| `idempotency_keys` | `key` (primary key), `request_hash` (sha256), `response_status`, `response_body` (jsonb), `created_at`                                                                                                                                                                                                                                                                                                 |
| `fx_rates`         | `currency` (primary key, FK to `currencies`), `units_per_usd NUMERIC(38,18) CHECK (> 0)`, `source` (live / fallback), `provider` (required for live rows), `provider_updated_at`, `refreshed_at`. Seeded with fallback quotes by the migration.                                                                                                                                                        |

## Build order (one conventional commit per step)

1. `chore:` scaffold NestJS (TS strict, ESLint, Prettier, Vitest, Dockerfile, compose with Postgres)
2. `feat:` DB migrations and wallets module
3. `feat:` FX service with live → cache → fallback, and the rates endpoint
4. `feat:` deposits with idempotency
5. `feat:` swaps
6. `feat:` transfers
7. `feat:` transaction history (pagination, type and currency filters) and fetch by id
8. `test:` concurrency and idempotency suites
9. `docs:` export the Swagger spec and write the full README
