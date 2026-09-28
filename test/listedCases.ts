import type { Gateway } from '../src/gateway.js';
import type { Source } from '../src/sources.js';

const HEADER = /^# \*\*(.*)\*\* \(ID: (\d+)\)$/gm;

async function headers(gw: Gateway, sources: Source[], limit?: number): Promise<RegExpMatchArray[]> {
  return [...(await gw.getTestCasesList(sources, limit)).matchAll(HEADER)];
}

export async function listedIds(gw: Gateway, sources: Source[], limit?: number): Promise<string[]> {
  return (await headers(gw, sources, limit)).map((m) => m[2] ?? '');
}

export async function listedTitles(gw: Gateway, sources: Source[], limit?: number): Promise<string[]> {
  return (await headers(gw, sources, limit)).map((m) => m[1] ?? '');
}
