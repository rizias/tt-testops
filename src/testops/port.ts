import { ApiError } from '../errors.js';
import { apiError, networkError } from './http.js';

export interface PortResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}

export interface TestOpsPort {
  get(url: string, headers: Record<string, string>): Promise<PortResponse>;
  postForm(
    url: string,
    form: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<PortResponse>;
}

interface ResilientPortOptions {
  retries: number;
  concurrency: number;
  sleep?: (ms: number) => Promise<void>;
  onWarn?: (message: string) => void;
  now?: () => number;
}

const MAX_PAUSE_MS = 30_000;

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function ownPause(attempt: number): number {
  return Math.min(400 * 3 ** attempt, MAX_PAUSE_MS);
}

function retryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return null;
  const delay = date - now;
  return delay > 0 ? delay : null;
}

function failureReason(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  return /timeout|timed out|abort/i.test(`${name} ${message}`)
    ? 'истекло ожидание ответа'
    : 'связь оборвалась';
}

async function buffered(response: PortResponse): Promise<PortResponse> {
  const bytes = response.arrayBuffer
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.text(), 'utf8');
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    json: async () => JSON.parse(bytes.toString('utf8')),
    text: async () => bytes.toString('utf8'),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

export class ResilientPort implements TestOpsPort {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onWarn: (message: string) => void;
  private readonly now: () => number;

  constructor(
    private readonly inner: TestOpsPort,
    private readonly options: ResilientPortOptions,
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onWarn = options.onWarn ?? (() => {});
    this.now = options.now ?? Date.now;
  }

  get(url: string, headers: Record<string, string>): Promise<PortResponse> {
    return this.run(url, () => this.inner.get(url, headers));
  }

  postForm(
    url: string,
    form: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<PortResponse> {
    return this.run(url, () => this.inner.postForm(url, form, headers));
  }

  private async run(url: string, request: () => Promise<PortResponse>): Promise<PortResponse> {
    await this.acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        const last = attempt >= this.options.retries;
        const response = await this.send(url, request, attempt, last);
        if (response === null) continue;
        const complete = await this.read(url, response, attempt, last);
        if (complete === null) continue;
        if (!retryableStatus(complete.status)) return complete;
        const requested = this.requestedPause(url, complete);
        if (last) return complete;
        await this.pause(url, `HTTP ${complete.status}`, requested ?? ownPause(attempt));
      }
    } finally {
      this.release();
    }
  }

  private async send(
    url: string,
    request: () => Promise<PortResponse>,
    attempt: number,
    last: boolean,
  ): Promise<PortResponse | null> {
    try {
      return await request();
    } catch (error) {
      const reason = failureReason(error);
      if (last) {
        const detail = error instanceof Error && error.message ? `: ${error.message}` : '';
        throw networkError(url, new Error(`${reason}${detail}`));
      }
      await this.pause(url, reason, ownPause(attempt));
      return null;
    }
  }

  private async read(
    url: string,
    response: PortResponse,
    attempt: number,
    last: boolean,
  ): Promise<PortResponse | null> {
    try {
      return await buffered(response);
    } catch {
      if (!response.ok && !retryableStatus(response.status)) throw apiError(response.status, url);
      const reason = 'связь оборвалась при чтении ответа';
      if (last) {
        if (!response.ok) throw apiError(response.status, url);
        throw networkError(url, new Error(reason));
      }
      await this.pause(url, reason, ownPause(attempt));
      return null;
    }
  }

  private requestedPause(url: string, complete: PortResponse): number | null {
    const requested = retryAfterMs(complete.headers?.get('retry-after') ?? null, this.now());
    if (requested !== null && requested > MAX_PAUSE_MS) {
      throw new ApiError(
        `сервер попросил ждать ${requested / 1000} секунд — ${url}`,
        complete.status,
        url,
        'server',
      );
    }
    return requested;
  }

  private async pause(url: string, reason: string, ms: number): Promise<void> {
    this.onWarn(`повтор запроса ${url}: ${reason}, пауза ${ms} мс`);
    await this.sleep(ms);
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}

export class FetchPort implements TestOpsPort {
  constructor(private readonly timeoutMs = 30000) {}

  async get(url: string, headers: Record<string, string>): Promise<PortResponse> {
    try {
      return await fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      throw networkError(url, cause);
    }
  }

  async postForm(
    url: string,
    form: Record<string, string>,
    headers: Record<string, string>,
  ): Promise<PortResponse> {
    try {
      return await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      });
    } catch (cause) {
      throw networkError(url, cause);
    }
  }
}
