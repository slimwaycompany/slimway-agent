import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLosses } from './measure';

const m = (measure_no: number, total_cm: number, measured_at: string) =>
  ({ measure_no, total_cm, measured_at });
const ib = (tested_at: string, weight: number | null, bfm: number | null) =>
  ({ tested_at, weight, bfm });

test('no data → all zeros', () => {
  const r = calcLosses([], []);
  assert.equal(r.cmLost, 0);
  assert.equal(r.kgLost, 0);
  assert.equal(r.fatKgLost, null);
});

test('cm lost', () => {
  const r = calcLosses([m(1, 300, '2026-01-01'), m(2, 285, '2026-06-01')], []);
  assert.equal(r.cmLost, 15);
});

test('cm gained → 0', () => {
  const r = calcLosses([m(1, 280, '2026-01-01'), m(2, 290, '2026-06-01')], []);
  assert.equal(r.cmLost, 0);
});

test('single measurement → cmLost 0', () => {
  const r = calcLosses([m(1, 300, '2026-01-01')], []);
  assert.equal(r.cmLost, 0);
});

test('weight lost', () => {
  const r = calcLosses([m(1, 300, '2026-01-01')], [
    ib('2026-01-05T10:00:00Z', 80, 30),
    ib('2026-06-05T10:00:00Z', 72, 25),
  ]);
  assert.equal(r.kgLost, 8);
  assert.equal(r.fatKgLost, 5);
});

test('weight gained → kgLost 0', () => {
  const r = calcLosses([m(1, 300, '2026-01-01')], [
    ib('2026-01-05T10:00:00Z', 72, 25),
    ib('2026-06-05T10:00:00Z', 80, 28),
  ]);
  assert.equal(r.kgLost, 0);
  assert.equal(r.fatKgLost, 0);
});

test('single InBody test → kgLost 0, fatKgLost null', () => {
  const r = calcLosses([m(1, 300, '2026-01-01')], [
    ib('2026-06-05T10:00:00Z', 75, 28),
  ]);
  assert.equal(r.kgLost, 0);
  assert.equal(r.fatKgLost, null);
});
