import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { FX_RATE_PROVIDER, type FxRateProvider } from '../../src/fx/fx.types.js';
import { FakeFxProvider } from './fake-fx-provider.js';

export interface TestAppOptions {
  /** Replaces the live FX provider; defaults to a deterministic fake so tests never hit the network. */
  fxProvider?: FxRateProvider;
}

/** Boots the full AppModule against the test database, configured exactly like main.ts. */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<INestApplication<Server>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FX_RATE_PROVIDER)
    .useValue(options.fxProvider ?? new FakeFxProvider())
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<INestApplication<Server>>({ logger: false }),
  );
  // Listen once on an ephemeral port: given an idle server, supertest calls
  // listen() per request, which piles up listeners under concurrent requests.
  await app.listen(0, '127.0.0.1');
  return app;
}
