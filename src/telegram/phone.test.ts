import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneTail } from './phone';

test('+77023255969 и 87023255969 совпадают', () => {
  assert.equal(phoneTail('+77023255969'), phoneTail('87023255969'));
  assert.equal(phoneTail('+77023255969'), '7023255969');
});

test('77023255969 и 8 (702) 325-59-69 совпадают', () => {
  assert.equal(phoneTail('77023255969'), phoneTail('8 (702) 325-59-69'));
});

test('+7702325596 (не хватает цифры) не совпадает с +77023255969', () => {
  assert.notEqual(phoneTail('+7702325596'), phoneTail('+77023255969'));
});

test('77023255960 (отличается последняя цифра) не совпадает', () => {
  assert.notEqual(phoneTail('77023255960'), phoneTail('77023255969'));
});

test('123 → null', () => {
  assert.equal(phoneTail('123'), null);
});
