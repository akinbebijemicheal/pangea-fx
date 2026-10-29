import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/test-app.js';

describe('App (e2e)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the API and database as up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('serves the OpenAPI document at /docs-json', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('Pangea FX API');
    expect(res.body.paths).toHaveProperty('/health');
  });

  it('serves the Swagger UI at /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('returns 404 for unknown routes under the API prefix', async () => {
    await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
  });
});
