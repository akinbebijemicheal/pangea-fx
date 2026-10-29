import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

/**
 * Gives the e2e suite a real Postgres. Uses TEST_DATABASE_URL when set
 * (CI, or a running compose stack); otherwise starts a throwaway container
 * so `yarn test` needs nothing but Docker.
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
  project.provide('databaseUrl', databaseUrl);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
