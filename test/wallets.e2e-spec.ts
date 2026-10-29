import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRENCIES } from '../src/common/currency.js';
import { KNEX } from '../src/database/database.constants.js';
import { uniqueEmail, uniquePhone } from './support/fixtures.js';
import { createTestApp } from './support/test-app.js';

const ZERO_BALANCES = CURRENCIES.map((currency) => ({ currency, amount: '0.00000000' }));

describe('Wallets (e2e)', () => {
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

  describe('POST /api/v1/wallets', () => {
    it('creates a wallet by email with a zero balance per currency', async () => {
      const email = uniqueEmail();
      const res = await http().post('/api/v1/wallets').send({ email }).expect(201);

      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        email,
        phone: null,
        createdAt: expect.any(String),
        balances: ZERO_BALANCES,
      });
      expect(new Date(res.body.createdAt as string).toISOString()).toBe(res.body.createdAt);
    });

    it('creates a wallet by phone, normalising separators', async () => {
      const phone = uniquePhone();
      const spaced = `${phone.slice(0, 4)} ${phone.slice(4, 7)}-${phone.slice(7)}`;
      const res = await http().post('/api/v1/wallets').send({ phone: spaced }).expect(201);
      expect(res.body.phone).toBe(phone);
      expect(res.body.email).toBeNull();
    });

    it('creates a wallet with both email and phone', async () => {
      const body = { email: uniqueEmail(), phone: uniquePhone() };
      const res = await http().post('/api/v1/wallets').send(body).expect(201);
      expect(res.body).toMatchObject(body);
    });

    it('rejects a duplicate email case-insensitively with 409', async () => {
      const email = uniqueEmail();
      await http().post('/api/v1/wallets').send({ email }).expect(201);
      const res = await http()
        .post('/api/v1/wallets')
        .send({ email: `  ${email.toUpperCase()} ` })
        .expect(409);
      expect(res.body.message).toBe('A wallet already exists for this email');
    });

    it('rejects a duplicate phone written differently with 409', async () => {
      const phone = uniquePhone();
      await http().post('/api/v1/wallets').send({ phone }).expect(201);
      const res = await http()
        .post('/api/v1/wallets')
        .send({ phone: `${phone.slice(0, 4)} ${phone.slice(4)}` })
        .expect(409);
      expect(res.body.message).toBe('A wallet already exists for this phone number');
    });

    it('rejects a new email paired with a phone that already has a wallet', async () => {
      const phone = uniquePhone();
      await http().post('/api/v1/wallets').send({ phone }).expect(201);
      await http().post('/api/v1/wallets').send({ email: uniqueEmail(), phone }).expect(409);
    });

    it('creates exactly one wallet when the same email is submitted concurrently', async () => {
      const email = uniqueEmail();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => http().post('/api/v1/wallets').send({ email })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, ...Array<number>(9).fill(409)]);
      const rows = await db('wallets').where({ email });
      expect(rows).toHaveLength(1);
    });

    it('does not leave an orphan wallet when creation conflicts', async () => {
      const email = uniqueEmail();
      await http().post('/api/v1/wallets').send({ email }).expect(201);
      await http().post('/api/v1/wallets').send({ email }).expect(409);
      expect(await db('wallets').where({ email })).toHaveLength(1);
    });

    it.each([
      [{}, 'Provide an email or a phone number'],
      [{ email: null }, 'Provide an email or a phone number'],
      [{ email: 'not-an-email' }, 'email must be an email'],
      [{ email: 42 }, 'email must be a string'],
      [
        { phone: '08031234567' },
        'phone must be in international E.164 format, e.g. +2348031234567',
      ],
      [{ email: uniqueEmail(), role: 'admin' }, 'property role should not exist'],
    ])('rejects invalid body %j with a single clear 400 message', async (body, message) => {
      const res = await http().post('/api/v1/wallets').send(body).expect(400);
      expect(res.body.message).toEqual([message]);
    });
  });

  describe('GET /api/v1/wallets/:id', () => {
    it('returns the wallet with its balances', async () => {
      const email = uniqueEmail();
      const created = await http().post('/api/v1/wallets').send({ email }).expect(201);
      const res = await http().get(`/api/v1/wallets/${created.body.id}`).expect(200);
      expect(res.body).toEqual(created.body);
    });

    it('returns 404 for an unknown wallet', async () => {
      await http().get('/api/v1/wallets/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await http().get('/api/v1/wallets/not-a-uuid').expect(400);
    });
  });

  describe('GET /api/v1/wallets/:id/balances', () => {
    it('returns every currency in a stable order', async () => {
      const created = await http().post('/api/v1/wallets').send({ email: uniqueEmail() });
      const res = await http().get(`/api/v1/wallets/${created.body.id}/balances`).expect(200);
      expect(res.body).toEqual({ walletId: created.body.id, balances: ZERO_BALANCES });
    });

    it('returns 404 for an unknown wallet', async () => {
      await http().get('/api/v1/wallets/00000000-0000-4000-8000-000000000000/balances').expect(404);
    });
  });

  describe('database constraints (last line of defence)', () => {
    async function newWalletId(): Promise<string> {
      const res = await http().post('/api/v1/wallets').send({ email: uniqueEmail() });
      return res.body.id as string;
    }

    it('rejects a negative balance', async () => {
      const id = await newWalletId();
      await expect(
        db('balances').where({ wallet_id: id, currency: 'USDx' }).update({ amount: '-0.00000001' }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'balances_amount_non_negative' });
    });

    it('rejects an unsupported currency', async () => {
      const id = await newWalletId();
      await expect(
        db('balances').insert({ wallet_id: id, currency: 'BTC', amount: 0 }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'balances_currency_supported' });
    });

    it('rejects a wallet with neither email nor phone', async () => {
      await expect(db('wallets').insert({})).rejects.toMatchObject({
        code: '23514',
        constraint: 'wallets_contact_present',
      });
    });

    it('stores amounts with exactly 8 decimal places and no float drift', async () => {
      const id = await newWalletId();
      await db('balances')
        .where({ wallet_id: id, currency: 'cNGN' })
        .update({ amount: '123456789012345678901234567890.12345678' });
      const res = await http().get(`/api/v1/wallets/${id}/balances`).expect(200);
      expect(res.body.balances[0]).toEqual({
        currency: 'cNGN',
        amount: '123456789012345678901234567890.12345678',
      });
    });
  });
});
