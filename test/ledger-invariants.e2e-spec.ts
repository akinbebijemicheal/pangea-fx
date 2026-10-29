import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRENCIES, type Currency } from '../src/common/currency.js';
import { Money } from '../src/common/money.js';
import { KNEX } from '../src/database/database.constants.js';
import { FxService } from '../src/fx/fx.service.js';
import { findDiscrepancies, findStatsDiscrepancies } from '../src/ledger/reconciliation.js';
import { uniqueEmail } from './support/fixtures.js';
import { createTestApp } from './support/test-app.js';

/** Units per USD, matching FakeFxProvider. */
const PER_USD: Record<Currency, string> = {
  cNGN: '1500',
  cGHS: '15',
  cXAF: '600',
  USDx: '1',
  EURx: '0.8',
};

/** Small seeded PRNG (mulberry32) so a failing run can be replayed with LEDGER_SEED. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Op {
  path: string;
  body: Record<string, string>;
  key: string;
  /** Repeats an earlier op's key and body: must replay, never execute. */
  replayOf?: Op;
}

describe('Ledger invariants under a randomised concurrent burst (e2e)', () => {
  const seed = Number(process.env.LEDGER_SEED ?? Math.floor(Math.random() * 2 ** 31));
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const context = `LEDGER_SEED=${seed}`;

  let app: INestApplication<Server>;
  let db: Knex;
  const wallets: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Knex>(KNEX);
    await app.get(FxService).refresh();
    for (let i = 0; i < 6; i++) {
      const res = await http().post('/api/v1/wallets').send({ email: uniqueEmail() }).expect(201);
      wallets.push(res.body.id as string);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** A random amount worth roughly $0.01 to $60 in `currency`, with 0 to 8 decimal places. */
  function amountIn(currency: Currency): string {
    const usd = 0.01 + random() * 60;
    const dp = Math.floor(random() * 9);
    const amount = new Money(usd).times(PER_USD[currency]).toFixed(dp, Money.ROUND_DOWN);
    // Rounding to few decimals can reach 0, which the API rightly rejects as invalid input.
    return new Money(amount).isZero() ? '1' : amount;
  }

  function randomOp(previous: Op[]): Op {
    const roll = random();
    if (roll < 0.1 && previous.length > 0) {
      const original = pick(previous);
      return { ...original, replayOf: original };
    }
    const wallet = pick(wallets);
    const key = randomUUID();
    if (roll < 0.3) {
      const currency = pick(CURRENCIES);
      return {
        path: `/api/v1/wallets/${wallet}/deposits`,
        body: { currency, amount: amountIn(currency) },
        key,
      };
    }
    const from = pick(CURRENCIES);
    if (roll < 0.65) {
      const to = pick(CURRENCIES.filter((c) => c !== from));
      return {
        path: `/api/v1/wallets/${wallet}/swaps`,
        body: { fromCurrency: from, toCurrency: to, amount: amountIn(from) },
        key,
      };
    }
    const toWalletId = pick(wallets.filter((w) => w !== wallet));
    return {
      path: `/api/v1/wallets/${wallet}/transfers`,
      body: {
        toWalletId,
        fromCurrency: from,
        toCurrency: pick(CURRENCIES),
        amount: amountIn(from),
      },
      key,
    };
  }

  const usdValue = (amount: Decimal.Value, currency: Currency) =>
    new Money(amount).div(PER_USD[currency]);

  it('reconciles exactly, never goes negative, records each success once and never creates value', async () => {
    // Opening deposits so most swaps and transfers have funds to work with.
    let depositedUsd = new Money(0);
    for (const wallet of wallets) {
      for (const currency of CURRENCIES) {
        const amount = new Money(500).times(PER_USD[currency]).toFixed();
        await http()
          .post(`/api/v1/wallets/${wallet}/deposits`)
          .set('Idempotency-Key', randomUUID())
          .send({ currency, amount })
          .expect(201);
        depositedUsd = depositedUsd.plus(usdValue(amount, currency));
      }
    }

    const done: Op[] = [];
    const executed = new Map<string, string>(); // key -> transaction id
    let conversions = 0;
    const statusCounts: Record<number, number> = {};

    for (let batch = 0; batch < 12; batch++) {
      const ops = Array.from({ length: 25 }, () => randomOp(done));
      const responses = await Promise.all(
        ops.map((op) => http().post(op.path).set('Idempotency-Key', op.key).send(op.body)),
      );

      responses.forEach((res, i) => {
        const op = ops[i]!;
        statusCounts[res.status] = (statusCounts[res.status] ?? 0) + 1;
        // Only success or a business rejection (insufficient funds, too small) is acceptable.
        expect(
          [201, 422],
          `${context} ${op.path} ${JSON.stringify(op.body)} -> ${JSON.stringify(res.body)}`,
        ).toContain(res.status);
        if (res.status !== 201) return;
        const id = res.body.id as string;
        if (op.replayOf || executed.has(op.key)) {
          // Either a replay of an earlier batch, or the twin of an op in this batch.
          if (executed.has(op.key)) expect(id, context).toBe(executed.get(op.key));
        } else {
          executed.set(op.key, id);
          done.push(op);
          if (op.path.endsWith('/deposits')) {
            depositedUsd = depositedUsd.plus(
              usdValue(op.body.amount!, op.body.currency as Currency),
            );
          } else if (res.body.sourceCurrency !== res.body.destinationCurrency) {
            conversions++;
          }
        }
      });
    }

    // 1. Every balance equals the sum of its transactions.
    expect(await findDiscrepancies(db, wallets), context).toEqual([]);

    // 1b. History summaries (the trigger-maintained aggregates) match the log exactly,
    // and every wallet's totalCount equals a direct count of its transactions.
    expect(await findStatsDiscrepancies(db, wallets), context).toEqual([]);
    for (const w of wallets) {
      const res = await http().get(`/api/v1/wallets/${w}/transactions`).expect(200);
      const direct = await db('transactions')
        .whereRaw('source_wallet_id = ? or destination_wallet_id = ?', [w, w])
        .count<{ count: string }[]>('* as count');
      expect(res.body.pagination.totalCount, context).toBe(Number(direct[0]!.count));
    }

    // 2. No balance is negative.
    const negative = await db('balances').whereIn('wallet_id', wallets).where('amount', '<', 0);
    expect(negative, context).toEqual([]);

    // 3. Each executed request produced exactly one transaction; replays produced none.
    const ids = await db('transactions')
      .whereRaw('source_wallet_id = any(?::uuid[]) or destination_wallet_id = any(?::uuid[])', [
        wallets,
        wallets,
      ])
      .pluck<string[]>('id');
    const openingDeposits = wallets.length * CURRENCIES.length;
    expect(ids.length - openingDeposits, context).toBe(executed.size);
    expect(new Set(executed.values()).size, context).toBe(executed.size);

    // 4. Rounding only ever loses value, and only a negligible amount.
    const balances = await db('balances')
      .whereIn('wallet_id', wallets)
      .select<{ currency: Currency; amount: string }[]>('currency', 'amount');
    const heldUsd = balances.reduce(
      (sum, b) => sum.plus(usdValue(b.amount, b.currency)),
      new Money(0),
    );
    const lost = depositedUsd.minus(heldUsd);
    expect(lost.gte(0), `${context} value created: ${lost.neg().toFixed()} USD`).toBe(true);
    // Each conversion rounds down by < 1e-8 of the destination currency (< 1.25e-8 USD).
    expect(
      lost.lte(new Money('1.25e-8').times(conversions)),
      `${context} lost ${lost.toFixed()} USD`,
    ).toBe(true);

    // The burst must actually exercise both outcomes to mean anything.
    expect(statusCounts[201] ?? 0, context).toBeGreaterThan(100);
    expect(executed.size, context).toBeGreaterThan(100);
  });

  it('detects a balance changed outside a transaction', async () => {
    const res = await http().post('/api/v1/wallets').send({ email: uniqueEmail() }).expect(201);
    const wallet = res.body.id as string;
    await http()
      .post(`/api/v1/wallets/${wallet}/deposits`)
      .set('Idempotency-Key', randomUUID())
      .send({ currency: 'EURx', amount: '10' })
      .expect(201);
    expect(await findDiscrepancies(db, [wallet])).toEqual([]);

    await db('balances')
      .where({ wallet_id: wallet, currency: 'EURx' })
      .update({ amount: '10.00000001' });

    expect(await findDiscrepancies(db, [wallet])).toEqual([
      { walletId: wallet, currency: 'EURx', balance: '10.00000001', expected: '10.00000000' },
    ]);
  });
});
