import { inject } from 'vitest';

// Runs before any test file imports AppModule: ConfigModule.forRoot validates env at import time.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.NODE_ENV = 'test';
// global-setup.ts already migrated the shared test database.
process.env.DB_MIGRATE_ON_BOOT = 'false';
// No background FX work: tests trigger refreshes through requests, deterministically.
process.env.FX_REFRESH_ON_BOOT = 'false';
process.env.FX_REFRESH_CRON = 'off';
