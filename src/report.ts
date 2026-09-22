import { humanSize } from './cache.js';

export function stampFor(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const date = [now.getFullYear(), two(now.getMonth() + 1), two(now.getDate())].join('-');
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${date}-${time}`;
}

export function exportReport(fullPath: string, bytes: number, spentMs: number): string {
  return `Записан файл: ${fullPath} — ${humanSize(bytes)}, ${(spentMs / 1000).toFixed(1)} с`;
}

export function lostReport(count: number): string | null {
  return count > 1 ? `не скачалось вложений: ${count}` : null;
}
