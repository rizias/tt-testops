export class TestOpsError extends Error {}

export class ConfigError extends TestOpsError {}

export class QueryError extends TestOpsError {}
export class AuthError extends TestOpsError {}
export class CacheError extends TestOpsError {}

export type ApiErrorKind = 'auth' | 'not_found' | 'server' | 'network';

export class ApiError extends TestOpsError {
  constructor(
    message: string,
    readonly statusCode: number | null,
    readonly url: string,
    readonly kind: ApiErrorKind,
  ) {
    super(message);
  }
}
