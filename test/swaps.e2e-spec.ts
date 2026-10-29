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

describe('Swaps (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Knex;
  const provider = new FakeFxProvider();

  beforeAll(async () => {
    app = await createTestApp({ fxProvider: provider });
    db = app.get<Knex>(KNEX);
    // Swaps only read stored rates, so make sure live ones are stored.
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

  function swap(walletId: string, body: object, key = randomUUID()) {
    return http().post(`/api/v1/wallets/${walletId}/swaps`).set('Idempotency-Key', key).send(body);
  }

  async function balances(walletId: string): Promise<Record<string, string>> {
    const rows = await db('balances')
      .where({ wallet_id: walletId })
      .select<{ currency: string; amount: string }[]>('currency', 'amount');
    return Object.fromEntries(rows.map((r) => [r.currency, r.amount]));
  }

  const swapCount = async (walletId: string) =>
    (await db('transactions').where({ source_wallet_id: walletId, type: 'swap' })).length;

  describe('happy path', () => {
    it('converts at the stored rate, moves both balances and records the rate', async () => {
      const id = await walletWith({ USDx: '250' });
      const key = randomUUID();
      const res = await swap(
        id,
        { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '100' },
        key,
      ).expect(201);

      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        type: 'swap',
        sourceWalletId: id,
        destinationWalletId: id,
        sourceCurrency: 'USDx',
        sourceAmount: '100.00000000',
        destinationCurrency: 'cNGN',
        destinationAmount: '150000.00000000',
        rate: '1500',
        rateSource: 'live',
        rateProvider: 'fake',
        rateRefreshedAt: expect.any(String),
        idempotencyKey: key,
        createdAt: expect.any(String),
      });
      expect(await balances(id)).toMatchObject({
        USDx: '150.00000000',
        cNGN: '150000.00000000',
      });
    });

    it('rounds the credited amount down for non-terminating rates', async () => {
      // cGHS -> EURx = 0.8 / 15 = 0.0533333333333333 (15 significant digits)
      const id = await walletWith({ cGHS: '1000' });
      const res = await swap(id, { fromCurrency: 'cGHS', toCurrency: 'EURx', amount: '1000' });
      expect(res.body.rate).toBe('0.0533333333333333');
      expect(res.body.destinationAmount).toBe('53.33333333');
      expect(await balances(id)).toMatchObject({ cGHS: '0.00000000', EURx: '53.33333333' });
    });

    it('lets a wallet swap its entire balance', async () => {
      const id = await walletWith({ EURx: '8' });
      await swap(id, { fromCurrency: 'EURx', toCurrency: 'USDx', amount: '8' }).expect(201);
      expect(await balances(id)).toMatchObject({ EURx: '0.00000000', USDx: '10.00000000' });
    });

    it('never calls the FX provider during a swap', async () => {
      const id = await walletWith({ USDx: '10' });
      const before = provider.calls;
      await swap(id, { fromCurrency: 'USDx', toCurrency: 'cXAF', amount: '1' }).expect(201);
      expect(provider.calls).toBe(before);
    });
  });

  describe('rejections', () => {
    it('rejects a swap that would make the balance negative with 422 and changes nothing', async () => {
      const id = await walletWith({ USDx: '50' });
      const res = await swap(id, {
        fromCurrency: 'USDx',
        toCurrency: 'cGHS',
        amount: '50.00000001',
      }).expect(422);
      expect(res.body.message).toBe(
        'Insufficient USDx balance: available 50.00000000, requested 50.00000001',
      );
      expect(await balances(id)).toMatchObject({ USDx: '50.00000000', cGHS: '0.00000000' });
      expect(await swapCount(id)).toBe(0);
    });

    it('rejects an amount that converts to zero', async () => {
      const id = await walletWith({ cNGN: '1' });
      const res = await swap(id, {
        fromCurrency: 'cNGN',
        toCurrency: 'USDx',
        amount: '0.00000001',
      }).expect(422);
      expect(res.body.message).toMatch(/too small/);
      expect(await balances(id)).toMatchObject({ cNGN: '1.00000000' });
    });

    it.each([
      [
        { fromCurrency: 'USDx', toCurrency: 'USDx', amount: '1' },
        'toCurrency must differ from fromCurrency',
      ],
      [
        { fromCurrency: 'BTC', toCurrency: 'USDx', amount: '1' },
        'fromCurrency must be one of: cNGN, cGHS, cXAF, USDx, EURx',
      ],
      [
        { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: 1 },
        'amount must be a positive decimal string',
      ],
      [
        { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '1', rate: '9999' },
        'property rate should not exist',
      ],
    ])('rejects %j with 400', async (body, message) => {
      const id = await walletWith();
      const res = await swap(id, body).expect(400);
      expect((res.body.message as string[]).join()).toContain(message);
    });

    it('returns 404 for an unknown wallet', async () => {
      await swap(randomUUID(), { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '1' }).expect(
        404,
      );
    });

    it('returns 400 for a malformed wallet id', async () => {
      await swap('nope', { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '1' }).expect(400);
    });
  });

  describe('idempotency', () => {
    it('replays a repeated swap without converting twice', async () => {
      const id = await walletWith({ USDx: '100' });
      const key = randomUUID();
      const body = { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '40' };
      const first = await swap(id, body, key).expect(201);
      const second = await swap(id, body, key).expect(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(await balances(id)).toMatchObject({ USDx: '60.00000000', EURx: '32.00000000' });
      expect(await swapCount(id)).toBe(1);
    });

    it('replays an insufficient-funds rejection for the same key', async () => {
      const id = await walletWith({ USDx: '1' });
      const key = randomUUID();
      const body = { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '2' };
      await swap(id, body, key).expect(422);
      await walletWith(); // unrelated activity in between
      const replay = await swap(id, body, key).expect(422);
      expect(replay.headers['idempotent-replayed']).toBe('true');
    });
  });

  describe('concurrency', () => {
    it('never overspends: 10 concurrent swaps of 15 against 100 -> 6 succeed, 4 rejected', async () => {
      const id = await walletWith({ USDx: '100' });
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          swap(id, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '15' }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 201, 201, 201, 422, 422, 422, 422]);
      expect(await balances(id)).toMatchObject({
        USDx: '10.00000000',
        cNGN: '135000.00000000',
      });
      expect(await swapCount(id)).toBe(6);
    });

    it('does not deadlock on concurrent swaps in opposite directions', async () => {
      const id = await walletWith({ USDx: '1000', cNGN: '1500000' });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          i % 2 === 0
            ? swap(id, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '10' })
            : swap(id, { fromCurrency: 'cNGN', toCurrency: 'USDx', amount: '15000' }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));
      // 10 x (+10 USDx) and 10 x (-10 USDx) cancel out exactly at these rates.
      expect(await balances(id)).toMatchObject({
        USDx: '1000.00000000',
        cNGN: '1500000.00000000',
      });
    });
  });

  describe('database rules', () => {
    it('rejects a swap record between the same currency', async () => {
      const id = await walletWith();
      await expect(
        db('transactions').insert({
          type: 'swap',
          source_wallet_id: id,
          destination_wallet_id: id,
          source_currency: 'USDx',
          source_amount: '1',
          destination_currency: 'USDx',
          destination_amount: '1',
          rate: '1',
          idempotency_key: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'transactions_shape_valid' });
    });
  });
});
