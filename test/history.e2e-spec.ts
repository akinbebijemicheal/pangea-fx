import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KNEX } from '../src/database/database.constants.js';
import { FxService } from '../src/fx/fx.service.js';
import { uniqueEmail } from './support/fixtures.js';
import { createTestApp } from './support/test-app.js';

interface Item {
  id: string;
  type: string;
  direction: string;
  sourceCurrency: string;
  destinationCurrency: string;
  createdAt: string;
}

describe('Transaction history (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Knex;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Knex>(KNEX);
    await app.get(FxService).refresh();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function newWallet(): Promise<string> {
    const res = await http().post('/api/v1/wallets').send({ email: uniqueEmail() }).expect(201);
    return res.body.id as string;
  }

  async function post(path: string, body: object): Promise<string> {
    const res = await http().post(path).set('Idempotency-Key', randomUUID()).send(body).expect(201);
    return res.body.id as string;
  }

  const list = (walletId: string, query: Record<string, string | number> = {}) =>
    http().get(`/api/v1/wallets/${walletId}/transactions`).query(query);

  /**
   * Wallet A, oldest to newest: deposit USDx (in), swap USDx->cNGN (self),
   * transfer USDx to B (out), transfer cGHS from B (in).
   */
  async function scenario() {
    const [a, b] = [await newWallet(), await newWallet()];
    await post(`/api/v1/wallets/${b}/deposits`, { currency: 'cGHS', amount: '50' });
    const deposit = await post(`/api/v1/wallets/${a}/deposits`, {
      currency: 'USDx',
      amount: '100',
    });
    const swap = await post(`/api/v1/wallets/${a}/swaps`, {
      fromCurrency: 'USDx',
      toCurrency: 'cNGN',
      amount: '10',
    });
    const sent = await post(`/api/v1/wallets/${a}/transfers`, {
      toWalletId: b,
      fromCurrency: 'USDx',
      amount: '20',
    });
    const received = await post(`/api/v1/wallets/${b}/transfers`, {
      toWalletId: a,
      fromCurrency: 'cGHS',
      amount: '5',
    });
    return { a, b, deposit, swap, sent, received };
  }

  describe('GET /api/v1/wallets/:walletId/transactions', () => {
    it('lists deposits, swaps and transfers sent and received, newest first, with direction', async () => {
      const s = await scenario();
      const res = await list(s.a).expect(200);
      const items = res.body.data as Item[];

      expect(items.map((t) => [t.id, t.type, t.direction])).toEqual([
        [s.received, 'transfer', 'in'],
        [s.sent, 'transfer', 'out'],
        [s.swap, 'swap', 'self'],
        [s.deposit, 'deposit', 'in'],
      ]);
      expect(res.body.nextCursor).toBeNull();
      const times = items.map((t) => Date.parse(t.createdAt));
      expect([...times].sort((x, y) => y - x)).toEqual(times);
    });

    it('shows the same transfer to the other party with the opposite direction', async () => {
      const s = await scenario();
      const items = (await list(s.b).expect(200)).body.data as Item[];
      expect(items.find((t) => t.id === s.sent)?.direction).toBe('in');
      expect(items.find((t) => t.id === s.received)?.direction).toBe('out');
    });

    it('lists a swap once even though the wallet is on both sides', async () => {
      const s = await scenario();
      const items = (await list(s.a, { type: 'swap' }).expect(200)).body.data as Item[];
      expect(items.map((t) => t.id)).toEqual([s.swap]);
    });

    it.each([
      [{ type: 'transfer' }, ['received', 'sent']],
      [{ type: 'deposit' }, ['deposit']],
      [{ currency: 'cNGN' }, ['swap']],
      [{ currency: 'USDx' }, ['sent', 'swap', 'deposit']],
      [{ currency: 'cGHS' }, ['received']],
      [{ type: 'transfer', currency: 'USDx' }, ['sent']],
      [{ type: 'swap', currency: 'cGHS' }, []],
      [{ currency: 'EURx' }, []],
    ])('filters by %j', async (query, expected) => {
      const s = await scenario();
      const ids = ((await list(s.a, query).expect(200)).body.data as Item[]).map((t) => t.id);
      expect(ids).toEqual(expected.map((k) => s[k as keyof typeof s]));
    });

    it('breaks ties on identical timestamps by id, with no row skipped or repeated', async () => {
      const w = await newWallet();
      // Concurrent requests rarely share a microsecond, so force exact ties directly.
      const rows = await db('transactions')
        .insert(
          Array.from({ length: 7 }, () => ({
            type: 'deposit',
            destination_wallet_id: w,
            source_currency: 'USDx',
            source_amount: '1',
            destination_currency: 'USDx',
            destination_amount: '1',
            rate: '1',
            idempotency_key: randomUUID(),
            created_at: db.raw("'2026-01-01 00:00:00.123456+00'::timestamptz"),
          })),
        )
        .returning<{ id: string }[]>('id');

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: Record<string, string | number> = { limit: 2 };
        if (cursor) query.cursor = cursor;
        const res = await list(w, query).expect(200);
        seen.push(...(res.body.data as Item[]).map((t) => t.id));
        cursor = res.body.nextCursor as string | null;
      } while (cursor);

      expect(seen).toEqual(
        rows
          .map((r) => r.id)
          .sort()
          .reverse(),
      );
    });

    it('pages through every transaction exactly once', async () => {
      const w = await newWallet();
      const created = await Promise.all(
        Array.from({ length: 25 }, () =>
          post(`/api/v1/wallets/${w}/deposits`, { currency: 'cXAF', amount: '1' }),
        ),
      );

      const seen: Item[] = [];
      const pageSizes: number[] = [];
      let cursor: string | null = null;
      do {
        const query: Record<string, string | number> = { limit: 10 };
        if (cursor) query.cursor = cursor;
        const res = await list(w, query).expect(200);
        const page = res.body.data as Item[];
        pageSizes.push(page.length);
        seen.push(...page);
        cursor = res.body.nextCursor as string | null;
      } while (cursor);

      expect(pageSizes).toEqual([10, 10, 5]);
      expect(seen.map((t) => t.id).sort()).toEqual([...created].sort());
      expect(new Set(seen.map((t) => t.id)).size).toBe(25);

      // Same order as the database's own (created_at desc, id desc).
      const expectedOrder = await db('transactions')
        .where({ destination_wallet_id: w })
        .orderBy([
          { column: 'created_at', order: 'desc' },
          { column: 'id', order: 'desc' },
        ])
        .pluck<string[]>('id');
      expect(seen.map((t) => t.id)).toEqual(expectedOrder);
    });

    it('returns no cursor when the last page is exactly full', async () => {
      const w = await newWallet();
      for (let i = 0; i < 3; i++) {
        await post(`/api/v1/wallets/${w}/deposits`, { currency: 'USDx', amount: '1' });
      }
      const res = await list(w, { limit: 3 }).expect(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.nextCursor).toBeNull();
    });

    it('keeps filters applied across pages', async () => {
      const w = await newWallet();
      for (const currency of ['USDx', 'EURx', 'USDx', 'EURx', 'USDx']) {
        await post(`/api/v1/wallets/${w}/deposits`, { currency, amount: '1' });
      }
      const first = await list(w, { currency: 'USDx', limit: 2 }).expect(200);
      const second = await list(w, {
        currency: 'USDx',
        limit: 2,
        cursor: first.body.nextCursor as string,
      }).expect(200);
      const all = [...first.body.data, ...second.body.data] as Item[];
      expect(all.map((t) => t.sourceCurrency)).toEqual(['USDx', 'USDx', 'USDx']);
      expect(second.body.nextCursor).toBeNull();
    });

    it('returns an empty page for a wallet with no transactions', async () => {
      const res = await list(await newWallet()).expect(200);
      expect(res.body).toMatchObject({
        data: [],
        nextCursor: null,
        pagination: { limit: 10, totalCount: 0, totalPages: 0, hasMore: false },
        summary: {
          transactionCount: 0,
          countByType: { deposit: 0, swap: 0, transfer: 0 },
          totalDebitUsd: '0.00000000',
          totalCreditUsd: '0.00000000',
          netUsd: '0.00000000',
        },
      });
    });

    it.each([
      [{ type: 'refund' }, 'type must be one of: deposit, swap, transfer'],
      [{ currency: 'BTC' }, 'currency must be one of'],
      [{ limit: 0 }, 'limit must be an integer between 1 and 1000'],
      [{ limit: 1001 }, 'limit must be an integer between 1 and 1000'],
      [{ limit: 'ten' }, 'limit must be an integer between 1 and 1000'],
      [{ cursor: 'garbage' }, 'cursor is invalid'],
      [{ page: 2 }, 'property page should not exist'],
    ])('rejects %j with 400', async (query, message) => {
      const res = await list(await newWallet(), query).expect(400);
      expect((res.body.message as string[]).join()).toContain(message);
    });

    it('returns 404 for an unknown wallet', async () => {
      await list(randomUUID()).expect(404);
    });

    it('returns 400 for a malformed wallet id', async () => {
      await list('nope').expect(400);
    });
  });

  describe('pagination and analytics', () => {
    type Line = { currency: string; amount: string };
    // Response bodies are untyped; narrow once here.
    const line = (items: unknown, currency: string) =>
      (items as Line[]).find((x) => x.currency === currency)?.amount;

    it('defaults to 10 per page and reports totals across all pages', async () => {
      const w = await newWallet();
      for (let i = 0; i < 12; i++) {
        await post(`/api/v1/wallets/${w}/deposits`, { currency: 'USDx', amount: '1' });
      }
      const first = await list(w).expect(200);
      expect(first.body.data).toHaveLength(10);
      expect(first.body.pagination).toEqual({
        limit: 10,
        totalCount: 12,
        totalPages: 2,
        hasMore: true,
      });

      const second = await list(w, { cursor: first.body.nextCursor as string }).expect(200);
      expect(second.body.data).toHaveLength(2);
      expect(second.body.pagination).toEqual({
        limit: 10,
        totalCount: 12,
        totalPages: 2,
        hasMore: false,
      });
      // The summary covers the whole filtered set, so it is identical on every page.
      expect(second.body.summary).toEqual(first.body.summary);
    });

    it('accepts any page size up to 1000', async () => {
      const w = await newWallet();
      for (let i = 0; i < 3; i++) {
        await post(`/api/v1/wallets/${w}/deposits`, { currency: 'USDx', amount: '1' });
      }
      const one = await list(w, { limit: 1 }).expect(200);
      expect(one.body.pagination).toMatchObject({ limit: 1, totalCount: 3, totalPages: 3 });
      const big = await list(w, { limit: 1000 }).expect(200);
      expect(big.body.data).toHaveLength(3);
      expect(big.body.pagination).toMatchObject({ limit: 1000, totalPages: 1, hasMore: false });
    });

    it('summarises counts and debit/credit totals per currency with USD values', async () => {
      // A: deposit 100 USDx (in), swap 10 USDx -> 15000 cNGN (self),
      //    send 20 USDx to B (out), receive 5 cGHS from B (in).
      const s = await scenario();
      const { summary } = (await list(s.a).expect(200)).body as {
        summary: {
          transactionCount: number;
          countByType: Record<string, number>;
          debits: { currency: string; amount: string; usdValue: string }[];
          credits: { currency: string; amount: string; usdValue: string }[];
          totalDebitUsd: string;
          totalCreditUsd: string;
          netUsd: string;
          valuation: { source: string; provider: string };
        };
      };

      expect(summary.transactionCount).toBe(4);
      expect(summary.countByType).toEqual({ deposit: 1, swap: 1, transfer: 2 });
      expect(summary.debits.map((d) => d.currency)).toEqual([
        'cNGN',
        'cGHS',
        'cXAF',
        'USDx',
        'EURx',
      ]);
      expect(line(summary.debits, 'USDx')).toBe('30.00000000');
      expect(line(summary.debits, 'cNGN')).toBe('0.00000000');
      expect(line(summary.credits, 'USDx')).toBe('100.00000000');
      expect(line(summary.credits, 'cNGN')).toBe('15000.00000000');
      expect(line(summary.credits, 'cGHS')).toBe('5.00000000');
      // 100 + 15000/1500 + 5/15 (rounded down) at the fake rates
      expect(summary.totalDebitUsd).toBe('30.00000000');
      expect(summary.totalCreditUsd).toBe('110.33333333');
      expect(summary.netUsd).toBe('80.33333333');
      expect(summary.valuation).toMatchObject({ source: 'live', provider: 'fake' });
    });

    it.each([
      [{ type: 'transfer' }, 2, { USDx: '20.00000000' }, { cGHS: '5.00000000' }],
      [{ currency: 'cNGN' }, 1, { USDx: '10.00000000' }, { cNGN: '15000.00000000' }],
      [
        { currency: 'USDx' },
        3,
        { USDx: '30.00000000' },
        { USDx: '100.00000000', cNGN: '15000.00000000' },
      ],
      [{ type: 'swap', currency: 'cGHS' }, 0, {}, {}],
    ])('applies the filters %j to the summary too', async (query, count, debits, credits) => {
      const s = await scenario();
      const res = await list(s.a, query).expect(200);
      expect(res.body.pagination.totalCount).toBe(count);
      expect(res.body.data).toHaveLength(count);
      const nonZero = (items: unknown) =>
        Object.fromEntries(
          (items as Line[])
            .filter((x) => x.amount !== '0.00000000')
            .map((x) => [x.currency, x.amount]),
        );
      expect(nonZero(res.body.summary.debits)).toEqual(debits);
      expect(nonZero(res.body.summary.credits)).toEqual(credits);
    });

    it('shows the other side of the same transfers from the receiver', async () => {
      const s = await scenario();
      const { summary } = (await list(s.b).expect(200)).body;
      // B: deposit 50 cGHS (in), receive 20 USDx (in), send 5 cGHS (out).
      expect(summary.countByType).toEqual({ deposit: 1, swap: 0, transfer: 2 });
      expect(line(summary.credits, 'USDx')).toBe('20.00000000');
      expect(line(summary.credits, 'cGHS')).toBe('50.00000000');
      expect(line(summary.debits, 'cGHS')).toBe('5.00000000');
    });

    it('reports a totalCount equal to the rows actually listed, for every filter', async () => {
      const s = await scenario();
      const queries: Record<string, string>[] = [
        {},
        { type: 'deposit' },
        { currency: 'USDx' },
        { type: 'transfer', currency: 'cGHS' },
      ];
      for (const query of queries) {
        const res = await list(s.a, { ...query, limit: 1000 }).expect(200);
        expect(res.body.pagination.totalCount, JSON.stringify(query)).toBe(res.body.data.length);
      }
    });
  });

  describe('GET /api/v1/transactions/:id', () => {
    it('returns the transaction exactly as it was created', async () => {
      const [a, b] = [await newWallet(), await newWallet()];
      await post(`/api/v1/wallets/${a}/deposits`, { currency: 'USDx', amount: '10' });
      const created = await http()
        .post(`/api/v1/wallets/${a}/transfers`)
        .set('Idempotency-Key', randomUUID())
        .send({ toWalletId: b, fromCurrency: 'USDx', toCurrency: 'EURx', amount: '10' })
        .expect(201);

      const res = await http().get(`/api/v1/transactions/${created.body.id}`).expect(200);
      expect(res.body).toEqual(created.body);
      expect(res.body).toMatchObject({
        sourceWalletId: a,
        destinationWalletId: b,
        sourceAmount: '10.00000000',
        destinationAmount: '8.00000000',
        rate: '0.8',
      });
    });

    it('returns 404 for an unknown id', async () => {
      await http().get(`/api/v1/transactions/${randomUUID()}`).expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await http().get('/api/v1/transactions/123').expect(400);
    });
  });
});
