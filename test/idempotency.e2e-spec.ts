import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  Body,
  Controller,
  type INestApplication,
  InternalServerErrorException,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnv } from '../src/config/env.validation.js';
import { KNEX } from '../src/database/database.constants.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { TransactionManager } from '../src/database/transaction-manager.js';
import { Idempotent } from '../src/idempotency/idempotent.decorator.js';

const PROBE_TABLE = 'idempotency_probe';

interface ProbeBody {
  /** What the handler should do after writing its probe row. */
  mode: 'ok' | 'client-error' | 'server-error' | 'slow';
  tag: string;
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
    if (body.mode === 'client-error') throw new UnprocessableEntityException('nope');
    if (body.mode === 'server-error' && attempt === 1) {
      throw new InternalServerErrorException('boom');
    }
    if (body.mode === 'slow') await new Promise((r) => setTimeout(r, 400));
    return { tag: body.tag, attempt };
  }
}

describe('Idempotency interceptor (e2e)', () => {
  let app: INestApplication<Server>;
  let db: Knex;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), DatabaseModule],
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

  it('rolls back the handler writes on a 4xx but keeps the key with the stored error', async () => {
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
    const original = call({ mode: 'slow', tag }, key);
    await new Promise((r) => setTimeout(r, 100));
    const duplicate = call({ mode: 'slow', tag }, key);
    const [a, b] = await Promise.all([original, duplicate]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(attempts.get(tag)).toBe(1);
    expect(await probeRows(tag)).toBe(1);
  });
});
