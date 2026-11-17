import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeTarget, delta } from './inbodyView';

test('beforeTarget(77.0, -26.6, 50.4) → строка есть', () => {
  assert.ok(beforeTarget(77.0, -26.6, 50.4) !== null);
});

test('beforeTarget(61.0, -7.3, 53.7) → строка есть', () => {
  assert.ok(beforeTarget(61.0, -7.3, 53.7) !== null);
});

test('beforeTarget(77.0, -26.6, 60.0) → null (арифметика не сходится)', () => {
  assert.equal(beforeTarget(77.0, -26.6, 60.0), null);
});

test('beforeTarget(null, -7.3, 53.7) → null', () => {
  assert.equal(beforeTarget(null, -7.3, 53.7), null);
});

test('delta(58.2, 58.6) → -0.4', () => {
  assert.equal(delta(58.2, 58.6), -0.4);
});

test('delta(null, 58.6) → null', () => {
  assert.equal(delta(null, 58.6), null);
});
