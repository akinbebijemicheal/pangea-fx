import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'docs';

const API_DESCRIPTION = `Stablecoin wallet sandbox: multi-currency wallets (cNGN, cGHS, cXAF, USDx, EURx), deposits, FX swaps and cross-border transfers.

**Money.** Amounts are decimal strings with up to 8 decimal places (e.g. \`"1500.25"\`), never JSON numbers. Converted amounts are rounded down to 8 dp. Rates are decimal strings with up to 15 significant digits.

**Idempotency.** Deposits, swaps and transfers require an \`Idempotency-Key\` header (e.g. a UUID). Repeating a request with the same key returns the original response with \`Idempotent-Replayed: true\` and never moves money twice. The same key with a different request is a 422. A 400 does not use up the key. Keys are kept for 24 hours.

**FX rates.** Live from open.er-api.com (Rates By Exchange Rate API), refreshed daily and on demand, with a fallback to the last stored rates and then to fixed seed rates. Every rate and transaction says which source it came from.`;

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Pangea FX API')
    .setDescription(API_DESCRIPTION)
    .setVersion('1.0.0')
    .addTag('wallets', 'Create wallets, look them up, and read balances with a USD total')
    .addTag('deposits', 'Simulated deposits into a wallet')
    .addTag('swaps', 'Convert between stablecoins inside one wallet')
    .addTag('transfers', 'Send to another wallet, in the same or a different currency')
    .addTag('transactions', 'Transaction history and lookup')
    .addTag('rates', 'Current conversion rates and where they came from')
    .addTag('currencies', 'Supported stablecoins')
    .addTag('health', 'Liveness and database check')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * Applies global HTTP config. Shared by main.ts and the e2e tests so tests
 * exercise the same pipes, prefix and docs as production.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // One message per field: the first rule that fails, not every rule.
      stopAtFirstError: true,
    }),
  );
  app.enableShutdownHooks();
  SwaggerModule.setup(DOCS_PATH, app, buildOpenApiDocument(app), {
    jsonDocumentUrl: `${DOCS_PATH}-json`,
  });
  return app;
}
