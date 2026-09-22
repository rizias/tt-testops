import type { CaseCache } from '../cache.js';
import type { AppConfig } from '../config.js';
import { AuthError } from '../errors.js';
import type { StoredSession } from '../sessionStore.js';
import type { PortResponse, TestOpsPort } from './port.js';

function decodeExpMs(jwt: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function bearer(headers: Record<string, string>): string | null {
  const value = headers.Authorization;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : null;
}

export class TestOpsSession {
  private current: StoredSession | null = null;
  private pending: Promise<string> | null = null;
  private recovering: Promise<string> | null = null;
  readonly port: TestOpsPort;

  constructor(
    private readonly cfg: AppConfig,
    private readonly transport: TestOpsPort,
    private readonly cache: CaseCache | null,
    private readonly onWarn: (message: string) => void,
    private readonly now: () => number,
  ) {
    this.port = {
      get: (url, headers) => this.getWithRecovery(url, headers),
      postForm: (url, form, headers) => this.transport.postForm(url, form, headers),
    };
  }

  getJwt(): Promise<string> {
    if (this.usable(this.current)) return Promise.resolve(this.current.token);
    if (!this.pending) {
      this.pending = this.refresh().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  async headers(accept = 'application/json'): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getJwt()}`, Accept: accept };
  }

  private usable(session: StoredSession | null): session is StoredSession {
    return session !== null && session.expiresAt - this.now() >= 60_000;
  }

  private async getWithRecovery(
    url: string,
    headers: Record<string, string>,
  ): Promise<PortResponse> {
    const response = await this.transport.get(url, headers);
    if (response.status !== 401) return response;
    const rejected = bearer(headers);
    if (!rejected) return response;
    const token = await this.recover(rejected);
    return this.transport.get(url, { ...headers, Authorization: `Bearer ${token}` });
  }

  private recover(rejected: string): Promise<string> {
    if (this.usable(this.current) && this.current.token !== rejected) {
      return Promise.resolve(this.current.token);
    }
    if (!this.recovering) {
      this.recovering = this.refresh(rejected).finally(() => {
        this.recovering = null;
      });
    }
    return this.recovering;
  }

  private refresh(rejected?: string): Promise<string> {
    const update = async () => {
      const saved = this.cache?.getSession(this.cfg.baseUrl, this.cfg.token) ?? null;
      if (this.usable(saved) && saved.token !== rejected) {
        this.current = saved;
        return saved.token;
      }
      const fresh = await this.exchange();
      this.cache?.putSession(this.cfg.baseUrl, this.cfg.token, fresh);
      this.current = fresh;
      return fresh.token;
    };
    return this.cache
      ? this.cache.withSessionLock(update, () =>
          this.onWarn('ожидание чужого обмена токена: хранилище занято'),
        )
      : update();
  }

  private async exchange(): Promise<StoredSession> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/uaa/oauth/token`;
    let response: PortResponse;
    try {
      response = await this.transport.postForm(
        url,
        { grant_type: 'apitoken', scope: 'openid', token: this.cfg.token },
        { Accept: 'application/json' },
      );
    } catch (error) {
      throw new AuthError(`Запрос обмена JWT не выполнен: ${(error as Error).message}, ${url}`);
    }
    if (!response.ok) {
      throw new AuthError(`Обмен JWT завершился ошибкой: HTTP ${response.status}, ${url}`);
    }
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) throw new AuthError('Ответ обмена JWT не содержит access_token');
    return {
      token: data.access_token,
      expiresAt: decodeExpMs(data.access_token) ?? this.now() + 55 * 60_000,
    };
  }
}
