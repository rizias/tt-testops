import { ApiError, type ApiErrorKind } from '../errors.js';
import type { TestOpsPort } from './port.js';

export interface HttpContext {
  port: TestOpsPort;
  url: (path: string) => string;
  authHeaders: (accept?: string) => Promise<Record<string, string>>;
}

export function kindFor(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  return 'server';
}
const REASON: Record<string, string> = {
  auth: 'нет доступа: токен не подошёл или прав не хватает',
  not_found: 'объект не найден',
  server: 'сервер не смог ответить',
};

export function apiError(status: number, url: string): ApiError {
  const kind = kindFor(status);
  return new ApiError(`${REASON[kind]} — HTTP ${status}, ${url}`, status, url, kind);
}

export function networkError(url: string, cause: unknown): ApiError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new ApiError(`до сервера не достучаться: ${detail} — ${url}`, null, url, 'network');
}
