import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/app.setup.js';
import { createTestApp } from './support/test-app.js';

describe('Committed OpenAPI spec (e2e)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const committed = async (): Promise<unknown> =>
    JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8'));

  it('matches what the code generates (run `yarn openapi:export` if this fails)', async () => {
    const generated: unknown = JSON.parse(JSON.stringify(buildOpenApiDocument(app)));
    expect(generated).toEqual(await committed());
  });

  it('is the same document the running API serves at /docs-json', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body).toEqual(await committed());
  });

  it('documents every endpoint the brief asks for', async () => {
    const paths = Object.keys(((await committed()) as { paths: object }).paths).sort();
    expect(paths).toEqual([
      '/api/v1/currencies',
      '/api/v1/rates',
      '/api/v1/transactions/{id}',
      '/api/v1/wallets',
      '/api/v1/wallets/lookup',
      '/api/v1/wallets/{id}',
      '/api/v1/wallets/{id}/balances',
      '/api/v1/wallets/{walletId}/deposits',
      '/api/v1/wallets/{walletId}/swaps',
      '/api/v1/wallets/{walletId}/transactions',
      '/api/v1/wallets/{walletId}/transfers',
      '/health',
    ]);
  });
});
