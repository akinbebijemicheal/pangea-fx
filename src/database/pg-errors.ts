/** Postgres SQLSTATE codes we react to. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';

interface PgError {
  code: string;
  constraint?: string;
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && typeof (err as PgError).code === 'string';
}

/** True when `err` is a unique violation, optionally on a specific constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return (
    isPgError(err) &&
    err.code === PG_UNIQUE_VIOLATION &&
    (constraint === undefined || err.constraint === constraint)
  );
}
