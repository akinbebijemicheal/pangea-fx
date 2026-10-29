import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'docs';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Pangea FX API')
    .setDescription(
      'Stablecoin wallet sandbox: multi-currency wallets, deposits, FX swaps and cross-border transfers.',
    )
    .setVersion('0.1.0')
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
