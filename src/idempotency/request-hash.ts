import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Fingerprint of a request: same method, path and body (in any key order) hash the same. */
export function hashRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(canonicalJson([method.toUpperCase(), path, body ?? null]))
    .digest('hex');
}
