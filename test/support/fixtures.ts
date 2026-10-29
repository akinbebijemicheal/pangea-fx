import { randomUUID } from 'node:crypto';

/**
 * Unique contact details per test, so test files can share one database and
 * run in parallel without truncating each other's data.
 */
export function uniqueEmail(): string {
  return `user-${randomUUID()}@example.com`;
}

let phoneCounter = 0;

export function uniquePhone(): string {
  // +234 followed by 10 digits: 4 from the worker pid, 6 from a counter and time.
  const pid = String(process.pid % 10_000).padStart(4, '0');
  const seq = String((Date.now() + phoneCounter++) % 1_000_000).padStart(6, '0');
  return `+234${pid}${seq}`;
}
