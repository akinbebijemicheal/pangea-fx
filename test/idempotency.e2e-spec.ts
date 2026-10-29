import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  BadRequestException,
  Body,
  Controller,
  type INestApplication,
  InternalServerErrorException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnv } from '../src/config/env.validation.js';
import { KNEX } from '../src/database/database.constants.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { TransactionManager } from '../src/database/transaction-manager.js';
import { IdempotencyCleanupScheduler } from '../src/idempotency/idempotency-cleanup.scheduler.js';
import { IdempotencyModule } from '../src/idempotency/idempotency.module.js';
import { Idempotent } from '../src/idempotency/idempotent.decorator.js';
import { uniqueEmail } from './support/fixtures.js';

// Short duplicate wait so the 409 path is testable quickly. This file runs in
// its own worker, so the override does not leak into other test files.
const LOCK_TIMEOUT_MS = 300;
process.env.IDEMPOTENCY_LOCK_TIMEOUT_MS = String(LOCK_TIMEOUT_MS);

const PROBE_TABLE = 'idempotency_probe';

interface ProbeBody {
  /** What the handler should do after writing its probe row. */
  mode: 'ok' | 'bad-request' | 'client-error' | 'server-error';
  tag: string;
  delayMs?: number;
}

/** Counts attempts per tag in memory, so tests can tell whether the handler re-ran. */
const attempts = new Map<string, number>();

/**
 * A minimal controller that writes a row through TransactionManager and then
 * succeeds or fails on demand, to exercise the interceptor's edge cases
 * independently of any money logic.
 */
@Controller('probe')
class ProbeController {
  constructor(private readonly tm: TransactionManager) {}

  @Post()
  @Idempotent(200)
  async run(@Body() body: ProbeBody): Promise<{ tag: string; attempt: number }> {
    const attempt = (attempts.get(body.tag) ?? 0) + 1;
    attempts.set(body.tag, attempt);
    await this.tm.db(PROBE_TABLE).insert({ tag: body.tag });
    if (body.delayMs) await new Promise((r) => setTimeout(r, body.delayMs));
    if (body.mode === 'bad-request') throw new BadRequestException('malformed');
    if (body.mode === 'client-error') throw new UnprocessableEntityException('nope');
    if (body.mode === 'server-error' && attempt === 1) {
      throw new InternalServerErrorException('boom');
    }
    return { tag: body.tag, attempt };
  }
}

describe('Idempotency interceptor (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Knex;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        ScheduleModule.forRoot(),
        DatabaseModule,
        IdempotencyModule,
      ],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>({ logger: false });
    await app.init();
    db = app.get<Knex>(KNEX);
    await db.schema.createTableIfNotExists(PROBE_TABLE, (t) => {
      t.increments('id');
      t.text('tag').notNullable();
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (body: ProbeBody, key: string) =>
    request(app.getHttpServer()).post('/probe').set('Idempotency-Key', key).send(body);
  const probeRows = async (tag: string) => (await db(PROBE_TABLE).where({ tag })).length;
  const keyExists = async (key: string) =>
    (await db('idempotency_keys').where({ key })).length === 1;

  it('stores the success status from @Idempotent and replays it', async () => {
    const tag = randomUUID();
    const key = randomUUID();
    const first = await call({ mode: 'ok', tag }, key).expect(200);
    const second = await call({ mode: 'ok', tag }, key).expect(200);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(attempts.get(tag)).toBe(1);
  });

  it('does not store a 400: the key stays free for the corrected request', async () => {
    const tag = randomUUID();
    const key = randomUUID();
    await call({ mode: 'bad-request', tag }, key).expect(400);
    expect(await keyExists(key)).toBe(false);
    expect(await probeRows(tag)).toBe(0);

    const corrected = await call({ mode: 'ok', tag }, key).expect(200);
    expect(corrected.headers['idempotent-replayed']).toBeUndefined();
    expect(await probeRows(tag)).toBe(1);
  });

  it('rolls back the handler writes on another 4xx but keeps the key with the stored error', async () => {
    const tag = randomUUID();
    const key = randomUUID();
    await call({ mode: 'client-error', tag }, key).expect(422);
    expect(await probeRows(tag)).toBe(0);
    expect(await keyExists(key)).toBe(true);

    const replay = await call({ mode: 'client-error', tag }, key).expect(422);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(attempts.get(tag)).toBe(1);
  });

  it('releases the key on a 5xx so the same key can be retried', async () => {
    const tag = randomUUID();
    const key = randomUUID();
    await call({ mode: 'server-error', tag }, key).expect(500);
    expect(await probeRows(tag)).toBe(0);
    expect(await keyExists(key)).toBe(false);

    const retry = await call({ mode: 'server-error', tag }, key).expect(200);
    expect(retry.body).toEqual({ tag, attempt: 2 });
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(await probeRows(tag)).toBe(1);
  });

  it('makes a duplicate wait for the in-flight original, then replays it', async () => {
    const tag = randomUUID();
    const key = randomUUID();
    const body: ProbeBody = { mode: 'ok', tag, delayMs: LOCK_TIMEOUT_MS / 3 };
    const original = call(body, key);
    await new Promise((r) => setTimeout(r, 30));
    const [a, b] = await Promise.all([original, call(body, key)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body).toEqual(a.body);
    expect([a, b].filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(1);
    expect(attempts.get(tag)).toBe(1);
    expect(await probeRows(tag)).toBe(1);
  });

  it('answers 409 when the original is still running after the lock timeout', async () => {
    const tag = randomUUID();
    const key = randomUUID();
    const body: ProbeBody = { mode: 'ok', tag, delayMs: LOCK_TIMEOUT_MS * 4 };
    // Whichever request claims the key first runs; the other gives up after the timeout.
    const results = await Promise.all([call(body, key), call(body, key)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.body.message).toMatch(/still being processed/);
    expect(attempts.get(tag)).toBe(1);
  });

  describe('expiry', () => {
    it('deletes only keys older than the TTL and keeps their transactions', async () => {
      const oldKey = `old-${randomUUID()}`;
      const freshKey = `fresh-${randomUUID()}`;
      await db('idempotency_keys').insert([
        {
          key: oldKey,
          request_hash: 'a'.repeat(64),
          response_status: 201,
          response_body: '{}',
          created_at: db.raw("now() - interval '25 hours'"),
        },
        { key: freshKey, request_hash: 'b'.repeat(64), response_status: 201, response_body: '{}' },
      ]);
      const [wallet] = await db('wallets').insert({ email: uniqueEmail() }).returning('id');
      const [tx] = await db('transactions')
        .insert({
          type: 'deposit',
          destination_wallet_id: wallet.id,
          source_currency: 'USDx',
          source_amount: '1',
          destination_currency: 'USDx',
          destination_amount: '1',
          rate: '1',
          idempotency_key: oldKey,
        })
        .returning('id');

      const deleted = await app.get(IdempotencyCleanupScheduler).deleteExpired();

      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await keyExists(oldKey)).toBe(false);
      expect(await keyExists(freshKey)).toBe(true);
      expect(await db('transactions').where({ id: tx.id }).first()).toMatchObject({
        idempotency_key: oldKey,
      });
    });

    it('treats an expired key as new', async () => {
      const tag = randomUUID();
      const key = randomUUID();
      await call({ mode: 'ok', tag }, key).expect(200);
      await db('idempotency_keys')
        .where({ key })
        .update({ created_at: db.raw("now() - interval '25 hours'") });
      await app.get(IdempotencyCleanupScheduler).deleteExpired();

      const again = await call({ mode: 'ok', tag }, key).expect(200);
      expect(again.headers['idempotent-replayed']).toBeUndefined();
      expect(again.body).toEqual({ tag, attempt: 2 });
    });
  });
});
