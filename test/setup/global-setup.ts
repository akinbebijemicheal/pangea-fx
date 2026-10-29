import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import knex from 'knex';
import type { TestProject } from 'vitest/node';
import { buildKnexConfig } from '../../src/database/knex-config.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Gives the e2e suite a real, migrated Postgres. Uses TEST_DATABASE_URL when
 * set (CI, or a running compose stack); otherwise starts a throwaway container
 * so `yarn test` needs nothing but Docker.
 *
 * Migrations run once here rather than on each app boot, because test files
 * run in parallel and would contend for the Knex migration lock.
 */
export async function setup(project: TestProject): Promise<void> {
  let databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('pangea_fx_test')
      .withUsername('pangea')
      .withPassword('pangea')
      .start();
    databaseUrl = container.getConnectionUri();
  }

  const db = knex(buildKnexConfig(databaseUrl));
  try {
    await db.migrate.latest();
  } finally {
    await db.destroy();
  }

  project.provide('databaseUrl', databaseUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
