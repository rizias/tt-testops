import { networkError } from './http.js';

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

export class FetchPort implements TestOpsPort {
  async get(url: string, headers: Record<string, string>): Promise<PortResponse> {
    try {
      return await fetch(url, { headers });
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
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
      });
    } catch (cause) {
      throw networkError(url, cause);
    }
  }
}
