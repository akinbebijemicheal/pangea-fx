import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRENCIES } from '../src/common/currency.js';
import { KNEX } from '../src/database/database.constants.js';
import { createTestApp } from './support/test-app.js';

describe('Currencies (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Knex;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get<Knex>(KNEX);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/currencies lists every supported stablecoin from the database', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/currencies').expect(200);
    expect(res.body).toEqual([
      { code: 'cNGN', name: 'Nigerian Naira Coin', fiatCode: 'NGN' },
      { code: 'cGHS', name: 'Ghanaian Cedi Coin', fiatCode: 'GHS' },
      { code: 'cXAF', name: 'Central African CFA Franc Coin', fiatCode: 'XAF' },
      { code: 'USDx', name: 'US Dollar Coin', fiatCode: 'USD' },
      { code: 'EURx', name: 'Euro Coin', fiatCode: 'EUR' },
    ]);
  });

  it('matches the compile-time CURRENCIES list in order', async () => {
    const codes = await db('currencies').orderBy('sort_order').pluck<string[]>('code');
    expect(codes).toEqual([...CURRENCIES]);
  });

  it('cannot delete a currency that balances reference', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/wallets')
      .send({ email: `cur-${Date.now()}@example.com` })
      .expect(201);
    await expect(db('currencies').where({ code: 'cNGN' }).delete()).rejects.toMatchObject({
      code: '23503',
    });
  });
});
