import type { ApiErrorResponse } from './types.ts';

/**
 * ApiError — typed exception thrown by the fetch wrapper on non-2xx
 * responses. Carries the server `code` (machine-readable, stable) and
 * the user-facing Turkish message.
 *
 * Code list mirrors server/internal/httpapi/error.go ErrCode constants.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorResponse) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

/** Server-stable error code constants. Mirror of httpapi/error.go. */
export const ErrCode = {
  BadRequest: 'bad_request',
  Unauthorized: 'unauthorized',
  InvalidCreds: 'invalid_credentials',
  InvalidMFA: 'invalid_mfa',
  InvalidCode: 'invalid_code',
  InvalidToken: 'invalid_token',
  AccountLocked: 'account_locked',
  AccountPendingMFA: 'account_pending_totp',
  RateLimited: 'rate_limited',
  Conflict: 'conflict',
  Internal: 'internal_error',
  Forbidden: 'forbidden',
  ReuseDetected: 'reuse_detected', // hypothetical — not yet emitted
} as const;

/** True for codes that mean "user must re-login from scratch". */
export function isUnrecoverableAuth(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 401 || err.code === ErrCode.AccountLocked;
}

/** True for codes that should re-attempt after refresh rotation. */
export function isAccessTokenExpired(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 401 &&
    (err.code === ErrCode.InvalidToken || err.code === ErrCode.Unauthorized)
  );
}
