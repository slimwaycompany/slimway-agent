import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from './phone';

test('+77767681579 → 77767681579', () => {
  assert.equal(normalizePhone('+77767681579'), '77767681579');
});

test('87767681579 → 77767681579', () => {
  assert.equal(normalizePhone('87767681579'), '77767681579');
});

test('77767681579 → 77767681579', () => {
  assert.equal(normalizePhone('77767681579'), '77767681579');
});

test('7767681579 (10 цифр без кода) → 77767681579', () => {
  assert.equal(normalizePhone('7767681579'), '77767681579');
});

test('12345 → null', () => {
  assert.equal(normalizePhone('12345'), null);
});
