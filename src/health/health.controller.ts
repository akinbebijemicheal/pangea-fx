import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Knex } from 'knex';
import { KNEX } from '../database/database.constants.js';

export interface HealthStatus {
  status: 'ok' | 'error';
  database: 'up' | 'down';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(KNEX) private readonly db: Knex) {}

  @Get()
  @ApiOkResponse({ description: 'API and database are reachable' })
  @ApiServiceUnavailableResponse({ description: 'Database is unreachable' })
  async check(): Promise<HealthStatus> {
    try {
      await this.db.raw('select 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}
