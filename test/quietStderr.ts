import { afterAll, beforeAll } from 'vitest';

const original = process.stderr.write.bind(process.stderr);

beforeAll(() => {
  process.stderr.write = (() => true) as typeof process.stderr.write;
});

afterAll(() => {
  process.stderr.write = original;
});
