import { Request, Response, NextFunction } from 'express';
import * as nodeCrypto from 'crypto';
import { validateS2SKey, s2sKeyMatches, anyS2sKeyMatches } from './validateS2SKey';

/**
 * Security regression tests for the internal S2S key middleware.
 *
 * The S2S key gates internal endpoints that act on behalf of arbitrary users
 * (internalCanvas view routes, /api/internal/postAsUser and friends). The key
 * comparison must run through crypto.timingSafeEqual: JavaScript `!==` and
 * Array.prototype.includes short-circuit at the first differing byte, which
 * leaks a prefix-match timing side channel to any network caller. Once the
 * repository is public, that side channel is trivially weaponizable, so the
 * constant-time primitive is asserted directly: the 'crypto' module is mocked
 * with a spy wrapping the real timingSafeEqual, and the tests require that the
 * auth path (both accept and reject) goes through it.
 *
 * Node's builtin namespace is frozen, so jest.spyOn cannot be used; the
 * jest.mock factory below is the supported way to intercept the binding the
 * module under test resolves.
 */

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto') as typeof import('crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const TEST_KEY = 'unit-test-s2s-key-0123456789abcdef';
const WRONG_KEY_SAME_LENGTH = 'unit-test-s2s-key-ffffffffffffffff';

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
}

const makeRes = (): MockRes => {
  const res: MockRes = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
};

const makeReq = (headers: Record<string, unknown>): Request =>
  ({ headers }) as unknown as Request;

const call = (headers: Record<string, unknown>, next: jest.Mock) => {
  const res = makeRes();
  validateS2SKey(makeReq(headers), res as unknown as Response, next as unknown as NextFunction);
  return res;
};

const timingSafeEqualMock = jest.mocked(nodeCrypto.timingSafeEqual);

describe('validateS2SKey (security)', () => {
  beforeEach(() => {
    process.env['INTERNAL_S2S_KEY'] = TEST_KEY;
    timingSafeEqualMock.mockClear();
  });

  afterEach(() => {
    delete process.env['INTERNAL_S2S_KEY'];
  });

  it('rejects a wrong key with 401', () => {
    const next = jest.fn();
    const res = call({ 'x-s2s-key': 'totally-wrong-key' }, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or missing S2S key' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a same-length key differing mid-string (no prefix short-circuit)', () => {
    const next = jest.fn();
    const res = call({ 'x-s2s-key': WRONG_KEY_SAME_LENGTH }, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a prefix of the real key with 401', () => {
    const next = jest.fn();
    const res = call({ 'x-s2s-key': TEST_KEY.slice(0, 8) }, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts the correct key and calls next()', () => {
    const next = jest.fn();
    const res = call({ 'x-s2s-key': TEST_KEY }, next);
    expect(res.statusCode).toBe(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects when INTERNAL_S2S_KEY is unset (fail closed)', () => {
    delete process.env['INTERNAL_S2S_KEY'];
    const next = jest.fn();
    const res = call({ 'x-s2s-key': TEST_KEY }, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects array-form header values without crashing', () => {
    const next = jest.fn();
    const res = call({ 'x-s2s-key': ['a', 'b'] }, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('compares the supplied key via crypto.timingSafeEqual on the reject path (constant-time)', () => {
    const next = jest.fn();
    const res = call({ 'x-s2s-key': WRONG_KEY_SAME_LENGTH }, next);
    expect(res.statusCode).toBe(401);
    expect(timingSafeEqualMock).toHaveBeenCalled();
  });

  it('compares the supplied key via crypto.timingSafeEqual on the accept path (constant-time)', () => {
    const next = jest.fn();
    const res = call({ 'x-s2s-key': TEST_KEY }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(timingSafeEqualMock).toHaveBeenCalled();
  });
});

describe('s2sKeyMatches / anyS2sKeyMatches (constant-time helpers used by app.ts internal routes)', () => {
  const KEY_A = 'key-aaaaaaaaaaaaaaaaaaaaaaaa';
  const KEY_B = 'key-bbbbbbbbbbbbbbbbbbbbbbbb';

  beforeEach(() => {
    timingSafeEqualMock.mockClear();
  });

  it('s2sKeyMatches accepts only the exact key and routes through timingSafeEqual', () => {
    expect(s2sKeyMatches(KEY_A, KEY_A)).toBe(true);
    expect(s2sKeyMatches(KEY_A.slice(0, 10), KEY_A)).toBe(false);
    expect(s2sKeyMatches(WRONG_KEY_SAME_LENGTH, WRONG_KEY_SAME_LENGTH.replace('ffff', 'eeee'))).toBe(false);
    expect(timingSafeEqualMock).toHaveBeenCalled();
  });

  it('s2sKeyMatches guards length before timingSafeEqual (mismatched lengths never reach the primitive)', () => {
    expect(s2sKeyMatches('short', KEY_A)).toBe(false);
    expect(timingSafeEqualMock).not.toHaveBeenCalled();
  });

  it('anyS2sKeyMatches accepts either configured key and rejects everything else, constant-time', () => {
    expect(anyS2sKeyMatches(KEY_A, [KEY_A, KEY_B])).toBe(true);
    expect(anyS2sKeyMatches(KEY_B, [KEY_A, KEY_B])).toBe(true);
    expect(anyS2sKeyMatches('key-cccccccccccccccccccccc', [KEY_A, KEY_B])).toBe(false);
    expect(timingSafeEqualMock).toHaveBeenCalled();
  });

  it('anyS2sKeyMatches fails closed on unset/empty accepted keys', () => {
    expect(anyS2sKeyMatches(KEY_A, [undefined, ''])).toBe(false);
    expect(anyS2sKeyMatches(KEY_A, [])).toBe(false);
  });
});
