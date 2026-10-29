# Pangea FX

Stablecoin multi-currency wallet sandbox: wallets, deposits, FX swaps and cross-border transfers across cNGN, cGHS, cXAF, USDx and EURx.

Built with NestJS, PostgreSQL and Knex. See [DECISIONS.md](DECISIONS.md) for the design decisions.

> Work in progress. The full README (endpoint walkthrough, data model, money handling) lands with the docs step.

## Quick start

Requires Docker.

```bash
docker compose up --build
```

- API: http://localhost:3000/api/v1
- Health: http://localhost:3000/health
- Swagger UI: http://localhost:3000/docs (raw spec at `/docs-json`)

## Tests

Requires Node 24+, Yarn 1.x and a running Docker daemon (the e2e suite starts a throwaway Postgres container).

```bash
yarn install
yarn test        # unit + e2e
yarn test:unit   # unit only, no Docker needed
```

To run e2e tests against an existing database instead, set `TEST_DATABASE_URL`.

## Local development

```bash
docker compose up -d db
cp .env.example .env
yarn start:dev
```
