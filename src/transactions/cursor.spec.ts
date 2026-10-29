import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const cursor = {
  createdAt: '2026-10-29 13:02:01.644123+00',
  id: '3f1c2b9e-5d7a-4c1e-9b8a-2a6f0e4d1c3b',
};

describe('cursor', () => {
  it('round-trips and keeps microsecond precision', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is URL-safe', () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['garbage', 'not-a-cursor!!'],
    ['valid base64 of non-JSON', Buffer.from('hello').toString('base64url')],
    ['JSON null', Buffer.from('null').toString('base64url')],
    ['missing id', Buffer.from(JSON.stringify({ t: cursor.createdAt })).toString('base64url')],
    ['bad id', Buffer.from(JSON.stringify({ t: cursor.createdAt, i: '1' })).toString('base64url')],
    [
      'bad time',
      Buffer.from(JSON.stringify({ t: 'yesterday', i: cursor.id })).toString('base64url'),
    ],
  ])('rejects %s with a 400', (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(BadRequestException);
  });
});
