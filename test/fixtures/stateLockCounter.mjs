import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { withLock } from '../../dist/stateLock.js';

const [, , dir, timesArg] = process.argv;
const times = Number(timesArg);
const file = join(dir, 'counter.json');

async function bump() {
  await withLock(dir, () => {
    const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).count : 0;
    writeFileSync(file, JSON.stringify({ count: current + 1 }));
  });
}

async function main() {
  for (let i = 0; i < times; i++) await bump();
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
