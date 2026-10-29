import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, DOCS_PATH } from './app.setup.js';
import type { EnvironmentVariables } from './config/env.validation.js';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  const port = app.get(ConfigService<EnvironmentVariables, true>).get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  Logger.log(`Pangea FX listening on :${port} (docs at /${DOCS_PATH})`, 'Bootstrap');
}

void bootstrap();
