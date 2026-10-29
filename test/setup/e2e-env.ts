import { inject } from 'vitest';

// Runs before any test file imports AppModule: ConfigModule.forRoot validates env at import time.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.NODE_ENV = 'test';
// global-setup.ts already migrated the shared test database.
process.env.DB_MIGRATE_ON_BOOT = 'false';
