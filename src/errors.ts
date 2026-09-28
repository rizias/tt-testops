export class TestOpsError extends Error {}

export class ConfigError extends TestOpsError {}

export class QueryError extends TestOpsError {}
export class UrlTooLongError extends QueryError {
  constructor() {
    super('Запрос не составить: адрес длиннее, чем принимает сервер TestOps. Сократите набор или разбейте его на части.');
  }
}
export class AuthError extends TestOpsError {}
export class StorageError extends TestOpsError {}

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

export function skippable(e: unknown): boolean {
  return e instanceof ApiError && e.kind === 'not_found';
}

export function serverOrNetwork(e: unknown): boolean {
  return e instanceof ApiError && (e.kind === 'server' || e.kind === 'network');
}

export function caseUnavailable(e: unknown): boolean {
  return serverOrNetwork(e) || (e instanceof ApiError && e.statusCode === 403);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
