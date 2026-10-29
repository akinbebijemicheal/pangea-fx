import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knex, { type Knex } from 'knex';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { KNEX } from './database.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: KNEX,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): Knex =>
        knex({
          client: 'pg',
          connection: config.get('DATABASE_URL', { infer: true }),
          pool: { min: 0, max: 10 },
        }),
    },
  ],
  exports: [KNEX],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
