import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knex, { type Knex } from 'knex';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { KNEX } from './database.constants.js';
import { buildKnexConfig } from './knex-config.js';

@Global()
@Module({
  providers: [
    {
      provide: KNEX,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): Knex =>
        knex(buildKnexConfig(config.get('DATABASE_URL', { infer: true }))),
    },
  ],
  exports: [KNEX],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get('DB_MIGRATE_ON_BOOT', { infer: true })) return;
    const [, applied] = (await this.db.migrate.latest()) as [number, string[]];
    this.logger.log(
      applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Schema up to date',
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
