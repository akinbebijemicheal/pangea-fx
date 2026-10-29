import 'reflect-metadata';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * `yarn openapi:export`: writes the OpenAPI document generated from the
 * controllers and DTOs to openapi.json at the repo root. No database is
 * needed: the app is created but never initialised or started, so no
 * connection is opened and no migration or cron job runs.
 * test/openapi.e2e-spec.ts fails if the committed file drifts from the code.
 */
async function main(): Promise<void> {
  // ConfigModule validates env when AppModule is imported, so set it first.
  process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/unused';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module.js');
  const { buildOpenApiDocument, configureApp } = await import('../app.setup.js');

  const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
  const document = buildOpenApiDocument(app);
  const target = resolve(process.cwd(), 'openapi.json');
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`Wrote ${target} (${Object.keys(document.paths).length} paths)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
