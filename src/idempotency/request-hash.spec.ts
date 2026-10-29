import { describe, expect, it } from 'vitest';
import { canonicalJson, hashRequest } from './request-hash.js';

describe('canonicalJson', () => {
  it('sorts keys at every level and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe('hashRequest', () => {
  const path = '/api/v1/wallets/abc/deposits';

  it('is a 64-char hex sha256', () => {
    expect(hashRequest('POST', path, {})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores body key order and method case', () => {
    expect(hashRequest('post', path, { amount: '1', currency: 'USDx' })).toBe(
      hashRequest('POST', path, { currency: 'USDx', amount: '1' }),
    );
  });

  it.each([
    ['body', hashRequest('POST', path, { amount: '2', currency: 'USDx' })],
    [
      'path',
      hashRequest('POST', '/api/v1/wallets/xyz/deposits', { amount: '1', currency: 'USDx' }),
    ],
    ['method', hashRequest('PUT', path, { amount: '1', currency: 'USDx' })],
  ])('changes when the %s changes', (_label, other) => {
    expect(other).not.toBe(hashRequest('POST', path, { amount: '1', currency: 'USDx' }));
  });

  it('treats a missing body as null', () => {
    expect(hashRequest('POST', path, undefined)).toBe(hashRequest('POST', path, null));
  });
});
