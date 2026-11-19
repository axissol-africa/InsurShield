import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('orders object keys by Unicode code unit rather than the server locale', () => {
    expect(canonicalJson({ ä: 4, a: 3, Z: 2, A: 1 })).toBe('{"A":1,"Z":2,"a":3,"ä":4}');
  });
});
