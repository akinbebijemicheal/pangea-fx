import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KNEX } from '../src/database/database.constants.js';
import { FxService } from '../src/fx/fx.service.js';
import { FakeFxProvider } from './support/fake-fx-provider.js';
import { uniqueEmail } from './support/fixtures.js';
import { createTestApp } from './support/test-app.js';

// Fake rates (units per USD): NGN 1500, GHS 15, XAF 600, USD 1, EUR 0.8.

describe('Transfers (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Knex;
  const provider = new FakeFxProvider();

  beforeAll(async () => {
    app = await createTestApp({ fxProvider: provider });
    db = app.get<Knex>(KNEX);
    await app.get(FxService).refresh();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function walletWith(funds: Record<string, string> = {}): Promise<string> {
    const res = await http().post('/api/v1/wallets').send({ email: uniqueEmail() }).expect(201);
    const id = res.body.id as string;
    for (const [currency, amount] of Object.entries(funds)) {
      await http()
        .post(`/api/v1/wallets/${id}/deposits`)
        .set('Idempotency-Key', randomUUID())
        .send({ currency, amount })
        .expect(201);
    }
    return id;
  }

  function transfer(fromWalletId: string, body: object, key = randomUUID()) {
    return http()
      .post(`/api/v1/wallets/${fromWalletId}/transfers`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  async function balance(walletId: string, currency: string): Promise<string> {
    const row = await db('balances')
      .where({ wallet_id: walletId, currency })
      .first<{ amount: string }>();
    return row.amount;
  }

  const transfersFrom = async (walletId: string) =>
    (await db('transactions').where({ source_wallet_id: walletId, type: 'transfer' })).length;

  describe('happy path', () => {
    it('moves funds in the same currency at rate 1 with no FX source', async () => {
      const [a, b] = [await walletWith({ USDx: '100' }), await walletWith()];
      const key = randomUUID();
      const res = await transfer(
        a,
        { toWalletId: b, fromCurrency: 'USDx', toCurrency: 'USDx', amount: '30.5' },
        key,
      ).expect(201);

      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        type: 'transfer',
        sourceWalletId: a,
        destinationWalletId: b,
        sourceCurrency: 'USDx',
        sourceAmount: '30.50000000',
        destinationCurrency: 'USDx',
        destinationAmount: '30.50000000',
        rate: '1',
        rateSource: null,
        rateProvider: null,
        rateRefreshedAt: null,
        idempotencyKey: key,
        createdAt: expect.any(String),
      });
      expect(await balance(a, 'USDx')).toBe('69.50000000');
      expect(await balance(b, 'USDx')).toBe('30.50000000');
    });

    it('defaults toCurrency to fromCurrency', async () => {
      const [a, b] = [await walletWith({ cGHS: '10' }), await walletWith()];
      const res = await transfer(a, { toWalletId: b, fromCurrency: 'cGHS', amount: '4' }).expect(
        201,
      );
      expect(res.body.destinationCurrency).toBe('cGHS');
      expect(await balance(b, 'cGHS')).toBe('4.00000000');
    });

    it('converts across currencies and records sender, receiver, amounts, rate and time', async () => {
      const [a, b] = [await walletWith({ USDx: '100' }), await walletWith()];
      const res = await transfer(a, {
        toWalletId: b,
        fromCurrency: 'USDx',
        toCurrency: 'cNGN',
        amount: '20',
      }).expect(201);

      expect(res.body).toMatchObject({
        sourceWalletId: a,
        destinationWalletId: b,
        sourceCurrency: 'USDx',
        sourceAmount: '20.00000000',
        destinationCurrency: 'cNGN',
        destinationAmount: '30000.00000000',
        rate: '1500',
        rateSource: 'live',
        rateProvider: 'fake',
      });
      expect(new Date(res.body.createdAt as string).getTime()).not.toBeNaN();
      expect(await balance(a, 'USDx')).toBe('80.00000000');
      expect(await balance(b, 'cNGN')).toBe('30000.00000000');
      expect(await balance(b, 'USDx')).toBe('0.00000000');
    });

    it('rounds the received amount down', async () => {
      // cNGN -> EURx = 0.8 / 1500 = 0.000533333333333333
      const [a, b] = [await walletWith({ cNGN: '1000.00000001' }), await walletWith()];
      const res = await transfer(a, {
        toWalletId: b,
        fromCurrency: 'cNGN',
        toCurrency: 'EURx',
        amount: '1000.00000001',
      }).expect(201);
      expect(res.body.rate).toBe('0.000533333333333333');
      expect(res.body.destinationAmount).toBe('0.53333333');
    });

    it('records one transaction visible to both wallets', async () => {
      const [a, b] = [await walletWith({ EURx: '5' }), await walletWith()];
      const res = await transfer(a, { toWalletId: b, fromCurrency: 'EURx', amount: '5' }).expect(
        201,
      );
      const rows = await db('transactions').where({ id: res.body.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source_wallet_id: a, destination_wallet_id: b });
    });

    it('accepts an upper-case sender id in the path', async () => {
      const [a, b] = [await walletWith({ USDx: '1' }), await walletWith()];
      const res = await transfer(a.toUpperCase(), {
        toWalletId: b,
        fromCurrency: 'USDx',
        amount: '1',
      }).expect(201);
      expect(res.body.sourceWalletId).toBe(a);
    });

    it('accepts an upper-case receiver id', async () => {
      const [a, b] = [await walletWith({ USDx: '1' }), await walletWith()];
      const res = await transfer(a, {
        toWalletId: b.toUpperCase(),
        fromCurrency: 'USDx',
        amount: '1',
      }).expect(201);
      expect(res.body.destinationWalletId).toBe(b);
    });
  });

  describe('rejections', () => {
    it('rejects insufficient funds with 422 and moves nothing', async () => {
      const [a, b] = [await walletWith({ USDx: '10' }), await walletWith()];
      const res = await transfer(a, {
        toWalletId: b,
        fromCurrency: 'USDx',
        amount: '10.01',
      }).expect(422);
      expect(res.body.message).toBe(
        'Insufficient USDx balance: available 10.00000000, requested 10.01000000',
      );
      expect(await balance(a, 'USDx')).toBe('10.00000000');
      expect(await balance(b, 'USDx')).toBe('0.00000000');
    });

    it('returns 404 for an unknown receiver and leaves the sender untouched', async () => {
      const a = await walletWith({ USDx: '10' });
      const ghost = randomUUID();
      const res = await transfer(a, {
        toWalletId: ghost,
        fromCurrency: 'USDx',
        amount: '1',
      }).expect(404);
      expect(res.body.message).toBe(`Destination wallet ${ghost} not found`);
      expect(await balance(a, 'USDx')).toBe('10.00000000');
    });

    it('returns 404 for an unknown sender', async () => {
      const b = await walletWith();
      await transfer(randomUUID(), { toWalletId: b, fromCurrency: 'USDx', amount: '1' }).expect(
        404,
      );
    });

    it.each([
      ['same wallet', 'self', 'toWalletId must be a different wallet'],
      ['same wallet, upper case', 'SELF', 'toWalletId must be a different wallet'],
    ])('rejects a transfer to the %s with 400', async (_label, target, message) => {
      const a = await walletWith({ USDx: '1' });
      const toWalletId = target === 'self' ? a : a.toUpperCase();
      const res = await transfer(a, { toWalletId, fromCurrency: 'USDx', amount: '1' }).expect(400);
      expect((res.body.message as string[]).join()).toContain(message);
    });

    it.each([
      [{ toWalletId: 'abc', fromCurrency: 'USDx', amount: '1' }, 'toWalletId must be a wallet id'],
      [{ fromCurrency: 'USDx', amount: '1' }, 'toWalletId must be a wallet id'],
      [
        { toWalletId: '00000000-0000-4000-8000-000000000000', fromCurrency: 'XYZ', amount: '1' },
        'fromCurrency must be one of',
      ],
      [
        {
          toWalletId: '00000000-0000-4000-8000-000000000000',
          fromCurrency: 'USDx',
          toCurrency: 'XYZ',
          amount: '1',
        },
        'toCurrency must be one of',
      ],
      [
        { toWalletId: '00000000-0000-4000-8000-000000000000', fromCurrency: 'USDx', amount: '-5' },
        'amount must be a positive decimal string',
      ],
    ])('rejects %j with 400', async (body, message) => {
      const a = await walletWith();
      const res = await transfer(a, body).expect(400);
      expect((res.body.message as string[]).join()).toContain(message);
    });
  });

  describe('idempotency', () => {
    it('replays a repeated transfer without sending twice', async () => {
      const [a, b] = [await walletWith({ USDx: '50' }), await walletWith()];
      const key = randomUUID();
      const body = { toWalletId: b, fromCurrency: 'USDx', amount: '20' };
      const first = await transfer(a, body, key).expect(201);
      const second = await transfer(a, body, key).expect(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(await balance(a, 'USDx')).toBe('30.00000000');
      expect(await balance(b, 'USDx')).toBe('20.00000000');
    });

    it('rejects reusing a key for a different receiver with 422', async () => {
      const [a, b, c] = [await walletWith({ USDx: '50' }), await walletWith(), await walletWith()];
      const key = randomUUID();
      await transfer(a, { toWalletId: b, fromCurrency: 'USDx', amount: '1' }, key).expect(201);
      await transfer(a, { toWalletId: c, fromCurrency: 'USDx', amount: '1' }, key).expect(422);
      expect(await balance(c, 'USDx')).toBe('0.00000000');
    });

    it('does not use up the key on a self-transfer 400', async () => {
      const [a, b] = [await walletWith({ USDx: '5' }), await walletWith()];
      const key = randomUUID();
      await transfer(a, { toWalletId: a, fromCurrency: 'USDx', amount: '1' }, key).expect(400);
      await transfer(a, { toWalletId: b, fromCurrency: 'USDx', amount: '1' }, key).expect(201);
    });
  });

  describe('concurrency', () => {
    it('never overspends: 10 concurrent transfers of 15 from 100 -> 6 succeed', async () => {
      const [a, b] = [await walletWith({ USDx: '100' }), await walletWith()];
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          transfer(a, { toWalletId: b, fromCurrency: 'USDx', amount: '15' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([
        201, 201, 201, 201, 201, 201, 422, 422, 422, 422,
      ]);
      expect(await balance(a, 'USDx')).toBe('10.00000000');
      expect(await balance(b, 'USDx')).toBe('90.00000000');
      expect(await transfersFrom(a)).toBe(6);
    });

    it('does not deadlock on concurrent transfers in opposite directions', async () => {
      const [a, b] = [
        await walletWith({ USDx: '1000', cNGN: '1500000' }),
        await walletWith({ USDx: '1000', cNGN: '1500000' }),
      ];
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => {
          // A->B and B->A, across both currencies, so lock sets overlap in every order.
          const [from, to] = i % 2 === 0 ? [a, b] : [b, a];
          return i % 3 === 0
            ? transfer(from, {
                toWalletId: to,
                fromCurrency: 'USDx',
                toCurrency: 'cNGN',
                amount: '1',
              })
            : transfer(from, {
                toWalletId: to,
                fromCurrency: 'cNGN',
                toCurrency: 'USDx',
                amount: '1500',
              });
        }),
      );
      expect(results.filter((r) => r.status !== 201).map((r) => r.body as unknown)).toEqual([]);

      const sum = async (currency: string) =>
        (
          await db('balances')
            .whereIn('wallet_id', [a, b])
            .where({ currency })
            .sum<{ sum: string }[]>('amount')
        )[0]!.sum;
      // 10 legs of 1 USDx -> 1500 cNGN and 20 legs of 1500 cNGN -> 1 USDx, in any order.
      const [usdx, cngn] = [await sum('USDx'), await sum('cNGN')];
      expect(usdx).toBe('2010.00000000');
      expect(cngn).toBe('2985000.00000000');
      // Value is conserved at these exact rates: still 4000 USD across both wallets.
      expect(Number(usdx) + Number(cngn) / 1500).toBe(4000);
    });

    it('applies concurrent transfers from many senders into one wallet', async () => {
      const receiver = await walletWith();
      const senders = await Promise.all(
        Array.from({ length: 10 }, () => walletWith({ cGHS: '3' })),
      );
      const results = await Promise.all(
        senders.map((s) =>
          transfer(s, { toWalletId: receiver, fromCurrency: 'cGHS', amount: '3' }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await balance(receiver, 'cGHS')).toBe('30.00000000');
    });
  });
});
