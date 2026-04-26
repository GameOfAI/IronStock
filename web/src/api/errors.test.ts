import { describe, expect, it } from 'vitest';
import { ApiError, ErrCode, isAccessTokenExpired, isUnrecoverableAuth } from './errors';

describe('ApiError', () => {
  it('captures status + code + message', () => {
    const err = new ApiError(401, { code: 'invalid_token', message: 'Token geçersiz.' });
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_token');
    expect(err.message).toBe('Token geçersiz.');
  });
});

describe('isAccessTokenExpired', () => {
  it('matches 401 + invalid_token', () => {
    const err = new ApiError(401, { code: ErrCode.InvalidToken, message: 'x' });
    expect(isAccessTokenExpired(err)).toBe(true);
  });

  it('matches 401 + unauthorized', () => {
    const err = new ApiError(401, { code: ErrCode.Unauthorized, message: 'x' });
    expect(isAccessTokenExpired(err)).toBe(true);
  });

  it('rejects 401 + invalid_credentials (login fail, not token rotation)', () => {
    const err = new ApiError(401, { code: ErrCode.InvalidCreds, message: 'x' });
    expect(isAccessTokenExpired(err)).toBe(false);
  });

  it('rejects non-ApiError', () => {
    expect(isAccessTokenExpired(new Error('x'))).toBe(false);
    expect(isAccessTokenExpired(null)).toBe(false);
  });
});

describe('isUnrecoverableAuth', () => {
  it('catches 401 generally', () => {
    expect(
      isUnrecoverableAuth(new ApiError(401, { code: ErrCode.InvalidCreds, message: 'x' })),
    ).toBe(true);
  });

  it('catches account_locked at any status', () => {
    expect(
      isUnrecoverableAuth(new ApiError(403, { code: ErrCode.AccountLocked, message: 'x' })),
    ).toBe(true);
  });

  it('lets 403 forbidden through (recoverable — needs role grant)', () => {
    expect(isUnrecoverableAuth(new ApiError(403, { code: 'forbidden', message: 'x' }))).toBe(false);
  });
});
