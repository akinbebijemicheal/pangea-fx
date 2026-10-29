import { BadRequestException } from '@nestjs/common';

/**
 * Position in a newest-first listing: the last row's created_at and id.
 * `createdAt` is Postgres's own text rendering of the timestamp, so it keeps
 * microseconds; a JS Date would round to milliseconds and could skip or
 * repeat rows that share a millisecond.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque to clients: base64url JSON. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt, i: cursor.id })).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const { t, i } = (parsed ?? {}) as { t?: unknown; i?: unknown };
  if (
    typeof t !== 'string' ||
    Number.isNaN(Date.parse(t)) ||
    typeof i !== 'string' ||
    !UUID.test(i)
  ) {
    throw invalid();
  }
  return { createdAt: t, id: i };
}

function invalid(): BadRequestException {
  return new BadRequestException([
    'cursor is invalid; use the nextCursor value from a previous page',
  ]);
}
