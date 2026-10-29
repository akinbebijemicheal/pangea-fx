import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

/** Boots the full AppModule against the test database, configured exactly like main.ts. */
export async function createTestApp(): Promise<INestApplication<Server>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(
    moduleRef.createNestApplication<INestApplication<Server>>({ logger: false }),
  );
  await app.init();
  return app;
}
