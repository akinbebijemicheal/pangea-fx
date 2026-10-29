import { inject } from 'vitest';

// Runs before any test file imports AppModule: ConfigModule.forRoot validates env at import time.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.NODE_ENV = 'test';
