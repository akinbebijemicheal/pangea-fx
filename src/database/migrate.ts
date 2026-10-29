import knex from 'knex';
import { buildKnexConfig } from './knex-config.js';

/**
 * Migration CLI: `yarn migrate` (latest) or `yarn migrate:rollback`.
 * The API also migrates on boot unless DB_MIGRATE_ON_BOOT=false.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = knex(buildKnexConfig(url));
  try {
    if (process.argv[2] === 'rollback') {
      const [batch, names] = (await db.migrate.rollback()) as [number, string[]];
      console.log(`Rolled back batch ${batch}: ${names.join(', ') || 'nothing to roll back'}`);
    } else {
      const [batch, names] = (await db.migrate.latest()) as [number, string[]];
      console.log(names.length ? `Batch ${batch} ran: ${names.join(', ')}` : 'Already up to date');
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
