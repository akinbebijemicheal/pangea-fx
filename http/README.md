# Sample requests

Runnable requests for every endpoint, including the error cases, as `.http` files.

## How to use

1. Start the stack from the repo root: `docker compose up`.
2. In VS Code, install the **REST Client** extension (`humao.rest-client`).
   JetBrains IDEs (built-in HTTP Client) and [httpyac](https://httpyac.github.io/) read the same files.
3. Open a file and click **Send Request** above a request. Run each file **top to bottom**: the first requests create the wallets that later ones use.

Each file is self-contained. It creates its own wallets and passes their ids along automatically (`{{wallet.response.body.$.id}}`), and uses `{{$timestamp}}` and `{{$guid}}` so you can run it again without clashing with an earlier run.

| File                                               | Covers                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| [00-health-and-docs.http](00-health-and-docs.http) | Health, OpenAPI JSON, supported currencies                         |
| [01-wallets.http](01-wallets.http)                 | Create by email/phone, duplicates, lookup, balances with USD total |
| [02-deposits.http](02-deposits.http)               | Deposits, idempotent replay, key reuse, exact decimals, validation |
| [03-swaps.http](03-swaps.http)                     | Swaps at the stored rate, insufficient funds, too-small amounts    |
| [04-transfers.http](04-transfers.http)             | Same-currency and cross-border transfers, 404, self-transfer       |
| [05-history.http](05-history.http)                 | History with direction, filters, cursor pagination, lookup by id   |
| [06-rates.http](06-rates.http)                     | All pairs, filters, rate sources, how to try the fallback          |

## Things to try

- **Idempotency**: in `02-deposits.http`, send request 3 twice. The second response is identical and carries `Idempotent-Replayed: true`; the balance moves once.
- **Exact money**: requests 6 and 7 in `02-deposits.http` leave EURx at exactly `0.30000000`.
- **Rate audit trail**: every swap and transfer response records the rate applied, its source and provider.
- **Both sides of a transfer**: in `05-history.http`, the same transfer is `out` for the sender and `in` for the receiver.

Swagger UI at http://localhost:3000/docs has the same endpoints with a "Try it out" button.
