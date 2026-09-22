import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Flags } from './args.js';
import { exportReport } from './report.js';

export interface CommandResult {
  out: string;
  htmlName: string | null;
}

export function freeName(path: string): string {
  if (!existsSync(path)) return path;
  const dot = path.lastIndexOf('.');
  const head = dot === -1 ? path : path.slice(0, dot);
  const tail = dot === -1 ? '' : path.slice(dot);
  for (let n = 2; ; n++) {
    const next = `${head}-${n}${tail}`;
    if (!existsSync(next)) return next;
  }
}

export function finish(
  out: string,
  f: Flags,
  htmlName: string | null,
  startedAt: number,
  code = 0,
): number {
  const target = f.out ?? htmlName;
  if (!target) {
    process.stdout.write(`${out}\n`);
    return code;
  }
  const finalPath = f.out ? target : freeName(target);
  writeFileSync(finalPath, out);
  const report = exportReport(
    resolve(finalPath),
    Buffer.byteLength(out, 'utf8'),
    Date.now() - startedAt,
  );
  process.stderr.write(`${report}\n`);
  return code;
}
