import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KNEX } from '../src/database/database.constants.js';
import { uniqueEmail } from './support/fixtures.js';
import { createTestApp } from './support/test-app.js';

describe('Deposits (e2e)', () => {
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

  async function newWallet(): Promise<string> {
    const res = await http().post('/api/v1/wallets').send({ email: uniqueEmail() }).expect(201);
    return res.body.id as string;
  }

  function deposit(walletId: string, body: object, key: string | null = randomUUID()) {
    const req = http().post(`/api/v1/wallets/${walletId}/deposits`);
    if (key !== null) void req.set('Idempotency-Key', key);
    return req.send(body);
  }

  async function balance(walletId: string, currency: string): Promise<string> {
    const row = await db('balances')
      .where({ wallet_id: walletId, currency })
      .first<{ amount: string }>();
    return row.amount;
  }

  const transactionCount = async (walletId: string) =>
    (await db('transactions').where({ destination_wallet_id: walletId })).length;

  describe('happy path', () => {
    it('credits the balance and returns the deposit transaction', async () => {
      const id = await newWallet();
      const key = randomUUID();
      const res = await deposit(id, { currency: 'cNGN', amount: '150000.5' }, key).expect(201);

      expect(res.headers['idempotent-replayed']).toBeUndefined();
      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        type: 'deposit',
        sourceWalletId: null,
        destinationWalletId: id,
        sourceCurrency: 'cNGN',
        sourceAmount: '150000.50000000',
        destinationCurrency: 'cNGN',
        destinationAmount: '150000.50000000',
        rate: '1',
        rateSource: null,
        rateProvider: null,
        rateRefreshedAt: null,
        idempotencyKey: key,
        createdAt: expect.any(String),
      });
      expect(await balance(id, 'cNGN')).toBe('150000.50000000');
      expect(await balance(id, 'USDx')).toBe('0.00000000');
    });

    it('accumulates exactly, with no float drift', async () => {
      const id = await newWallet();
      await deposit(id, { currency: 'USDx', amount: '0.1' }).expect(201);
      await deposit(id, { currency: 'USDx', amount: '0.2' }).expect(201);
      expect(await balance(id, 'USDx')).toBe('0.30000000');
    });

    it('shows up in balances with its USD value', async () => {
      const id = await newWallet();
      await deposit(id, { currency: 'cNGN', amount: '1500' }).expect(201);
      const res = await http().get(`/api/v1/wallets/${id}/balances`).expect(200);
      expect(res.body.balances[0]).toEqual({
        currency: 'cNGN',
        amount: '1500.00000000',
        usdValue: '1.00000000',
      });
      expect(res.body.totalUsd).toBe('1.00000000');
    });

    it('applies 20 concurrent deposits without losing any', async () => {
      const id = await newWallet();
      const results = await Promise.all(
        Array.from({ length: 20 }, () => deposit(id, { currency: 'cGHS', amount: '1.25' })),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await balance(id, 'cGHS')).toBe('25.00000000');
      expect(await transactionCount(id)).toBe(20);
    });
  });

  describe('idempotency', () => {
    it('requires an Idempotency-Key header', async () => {
      const id = await newWallet();
      const res = await deposit(id, { currency: 'USDx', amount: '1' }, null).expect(400);
      expect(res.body.message).toBe('Idempotency-Key header is required');
      expect(await balance(id, 'USDx')).toBe('0.00000000');
    });

    it.each(['has space', 'x'.repeat(256), 'naïve'])(
      'rejects the malformed key %j',
      async (key) => {
        const id = await newWallet();
        await deposit(id, { currency: 'USDx', amount: '1' }, key).expect(400);
      },
    );

    it('replays the original response for a repeated request and credits once', async () => {
      const id = await newWallet();
      const key = randomUUID();
      const first = await deposit(id, { currency: 'EURx', amount: '10' }, key).expect(201);
      const second = await deposit(id, { amount: '10', currency: 'EURx' }, key).expect(201);

      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect(await balance(id, 'EURx')).toBe('10.00000000');
      expect(await transactionCount(id)).toBe(1);
    });

    it('processes 10 concurrent identical requests exactly once', async () => {
      const id = await newWallet();
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 10 }, () => deposit(id, { currency: 'cXAF', amount: '500' }, key)),
      );

      expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
      const ids = new Set(results.map((r) => r.body.id as string));
      expect(ids.size).toBe(1);
      expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
      expect(await balance(id, 'cXAF')).toBe('500.00000000');
      expect(await transactionCount(id)).toBe(1);
    });

    it('rejects the same key with a different body with 422 and moves no money', async () => {
      const id = await newWallet();
      const key = randomUUID();
      await deposit(id, { currency: 'USDx', amount: '5' }, key).expect(201);
      const res = await deposit(id, { currency: 'USDx', amount: '6' }, key).expect(422);
      expect(res.body.message).toBe(
        'Idempotency-Key has already been used for a different request',
      );
      expect(await balance(id, 'USDx')).toBe('5.00000000');
    });

    it('rejects the same key on a different wallet with 422', async () => {
      const [a, b] = [await newWallet(), await newWallet()];
      const key = randomUUID();
      await deposit(a, { currency: 'USDx', amount: '5' }, key).expect(201);
      await deposit(b, { currency: 'USDx', amount: '5' }, key).expect(422);
      expect(await balance(b, 'USDx')).toBe('0.00000000');
    });

    it('replays a client error for the same key instead of re-running it', async () => {
      const missing = randomUUID();
      const key = randomUUID();
      const first = await deposit(missing, { currency: 'USDx', amount: '5' }, key).expect(404);
      const second = await deposit(missing, { currency: 'USDx', amount: '5' }, key).expect(404);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
    });
  });

  describe('validation', () => {
    it.each([
      [{ currency: 'USDx', amount: 10 }, 'amount must be a positive decimal string'],
      [{ currency: 'USDx', amount: '-1' }, 'amount must be a positive decimal string'],
      [{ currency: 'USDx', amount: '0' }, 'amount must be a positive decimal string'],
      [{ currency: 'USDx', amount: '1.123456789' }, 'amount must be a positive decimal string'],
      [{ currency: 'BTC', amount: '1' }, 'currency must be one of: cNGN, cGHS, cXAF, USDx, EURx'],
      [{ currency: 'USDx', amount: '1', note: 'x' }, 'property note should not exist'],
    ])('rejects %j with 400', async (body, message) => {
      const id = await newWallet();
      const res = await deposit(id, body).expect(400);
      expect((res.body.message as string[]).join()).toContain(message);
      expect(await transactionCount(id)).toBe(0);
    });

    it('returns 404 for an unknown wallet', async () => {
      const res = await deposit(randomUUID(), { currency: 'USDx', amount: '1' }).expect(404);
      expect(res.body.message).toMatch(/not found/);
    });

    it('returns 400 for a malformed wallet id', async () => {
      await deposit('nope', { currency: 'USDx', amount: '1' }).expect(400);
    });

    it('refuses a deposit that would overflow the balance and leaves it unchanged', async () => {
      const id = await newWallet();
      const max = '999999999999999999999999999999.99999999';
      await deposit(id, { currency: 'USDx', amount: max }).expect(201);
      const res = await deposit(id, { currency: 'USDx', amount: '0.00000001' }).expect(422);
      expect(res.body.message).toMatch(/maximum/);
      expect(await balance(id, 'USDx')).toBe(max);
      expect(await transactionCount(id)).toBe(1);
    });
  });

  describe('database rules', () => {
    it('rejects a deposit record whose amounts or currencies differ', async () => {
      const id = await newWallet();
      const key = `shape-${randomUUID()}`;
      await db('idempotency_keys').insert({ key, request_hash: 'x'.repeat(64) });
      await expect(
        db('transactions').insert({
          type: 'deposit',
          destination_wallet_id: id,
          source_currency: 'USDx',
          source_amount: '1',
          destination_currency: 'EURx',
          destination_amount: '1',
          rate: '1',
          idempotency_key: key,
        }),
      ).rejects.toMatchObject({ code: '23514', constraint: 'transactions_shape_valid' });
    });
  });
});
