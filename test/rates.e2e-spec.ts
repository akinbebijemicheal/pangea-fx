import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KNEX } from '../src/database/database.constants.js';
import { uniqueEmail } from './support/fixtures.js';
import { createTestApp } from './support/test-app.js';

interface RateBody {
  from: string;
  to: string;
  rate: string;
  source: string;
  refreshedAt: string;
}

describe('Rates (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Knex;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Knex>(KNEX);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('GET /api/v1/rates', () => {
    it('names the rate provider with its attribution and update frequency', async () => {
      const res = await http().get('/api/v1/rates').expect(200);
      expect(res.body.provider).toEqual({
        name: 'fake',
        url: 'https://fx.test',
        updateFrequency: 'daily',
        attribution: 'Rates by Fake FX',
      });
    });

    it('returns all 20 pairs from live rates with refresh times', async () => {
      const res = await http().get('/api/v1/rates').expect(200);
      const rates = res.body.rates as RateBody[];
      expect(rates).toHaveLength(20);
      for (const r of rates) {
        expect(r.source).toBe('live');
        expect(new Date(r.refreshedAt).toISOString()).toBe(r.refreshedAt);
        expect(r.rate).toMatch(/^\d+(\.\d+)?$/);
      }
    });

    it.each([
      ['USDx', 'cNGN', '1500'],
      ['cNGN', 'USDx', '0.000666666666666667'],
      ['cNGN', 'cGHS', '0.01'],
      ['cGHS', 'cXAF', '40'],
      ['EURx', 'USDx', '1.25'],
      ['cXAF', 'EURx', '0.00133333333333333'],
    ])('derives %s -> %s = %s', async (from, to, rate) => {
      const res = await http().get('/api/v1/rates').query({ from, to }).expect(200);
      expect(res.body.rates).toEqual([
        {
          from,
          to,
          rate,
          source: 'live',
          provider: 'fake',
          providerUpdatedAt: '2026-10-29T00:00:00.000Z',
          refreshedAt: expect.any(String),
        },
      ]);
    });

    it('filters by from only', async () => {
      const res = await http().get('/api/v1/rates').query({ from: 'cGHS' }).expect(200);
      const rates = res.body.rates as RateBody[];
      expect(rates.map((r) => r.to)).toEqual(['cNGN', 'cXAF', 'USDx', 'EURx']);
    });

    it('filters by to only', async () => {
      const res = await http().get('/api/v1/rates').query({ to: 'USDx' }).expect(200);
      expect((res.body.rates as RateBody[]).map((r) => r.from)).toEqual([
        'cNGN',
        'cGHS',
        'cXAF',
        'EURx',
      ]);
    });

    it('returns rate 1 for the same currency', async () => {
      const res = await http().get('/api/v1/rates').query({ from: 'EURx', to: 'EURx' });
      expect(res.body.rates[0].rate).toBe('1');
    });

    it.each([{ from: 'BTC' }, { to: 'usdx' }, { base: 'USDx' }])(
      'rejects query %j with 400',
      async (query) => {
        await http().get('/api/v1/rates').query(query).expect(400);
      },
    );
  });

  describe('GET /api/v1/wallets/:id/balances valuation', () => {
    async function walletWith(amounts: Record<string, string>): Promise<string> {
      const res = await http().post('/api/v1/wallets').send({ email: uniqueEmail() }).expect(201);
      const id = res.body.id as string;
      for (const [currency, amount] of Object.entries(amounts)) {
        await db('balances').where({ wallet_id: id, currency }).update({ amount });
      }
      return id;
    }

    it('values each balance in USD and totals the rounded lines', async () => {
      const id = await walletWith({
        cNGN: '150000',
        cGHS: '1',
        cXAF: '1000',
        USDx: '10.5',
        EURx: '20',
      });
      const res = await http().get(`/api/v1/wallets/${id}/balances`).expect(200);
      expect(res.body).toEqual({
        walletId: id,
        balances: [
          { currency: 'cNGN', amount: '150000.00000000', usdValue: '100.00000000' },
          // 1 / 15 = 0.0666... rounded down
          { currency: 'cGHS', amount: '1.00000000', usdValue: '0.06666666' },
          // 1000 x 0.00166666666666667 (15 sig. digits) rounded down
          { currency: 'cXAF', amount: '1000.00000000', usdValue: '1.66666666' },
          { currency: 'USDx', amount: '10.50000000', usdValue: '10.50000000' },
          { currency: 'EURx', amount: '20.00000000', usdValue: '25.00000000' },
        ],
        totalUsd: '137.23333332',
        valuation: { source: 'live', ratesAsOf: expect.any(String), provider: 'fake' },
      });
    });

    it('values an empty wallet at zero', async () => {
      const id = await walletWith({});
      const res = await http().get(`/api/v1/wallets/${id}/balances`).expect(200);
      expect(res.body.totalUsd).toBe('0.00000000');
      for (const b of res.body.balances as { usdValue: string }[]) {
        expect(b.usdValue).toBe('0.00000000');
      }
    });
  });
});

describe('Rates (e2e) with the provider down', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp({
      fxProvider: {
        name: 'down',
        info: { name: 'down', url: 'https://fx.test', updateFrequency: 'daily', attribution: null },
        fetchUsdQuotes: () => Promise.reject(new Error('down')),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('still serves every rate from stored quotes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/rates').expect(200);
    const rates = res.body.rates as RateBody[];
    expect(rates).toHaveLength(20);
    // The shared table holds either seed rows or live rows another file stored.
    for (const r of rates) expect(['live', 'cache', 'fallback']).toContain(r.source);
  });
});
