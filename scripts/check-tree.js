#!/usr/bin/env node
// Проверяет scripts/sales-tree.json: ID, тексты, переходы, считает по блокам.
const fs   = require('fs');
const path = require('path');

const treeFile = path.join(__dirname, 'sales-tree.json');
const mdFile   = path.join(__dirname, '..', 'docs', 'sales-tree.md');

const tree = JSON.parse(fs.readFileSync(treeFile, 'utf8'));
const md   = fs.readFileSync(mdFile, 'utf8');

const nodes   = tree.nodes;
const nodeIds = Object.keys(nodes);
let errors    = 0;

function fail(msg) { console.error('  ✗', msg); errors++; }
function ok(msg)   { console.log ('  ✓', msg); }

// ── 1. Все ID из markdown присутствуют в JSON ──────────────────────────────
console.log('\n[1] ID из markdown → JSON');
const mdIds = [...md.matchAll(/\*\*(\d+\.\d+(?:\.\d+)?)\s/g)].map(m => m[1]);
const mdIdSet = new Set(mdIds);
for (const id of mdIdSet) {
  if (!nodes[id]) fail(`${id} есть в markdown, нет в JSON`);
}
ok(`markdown содержит ${mdIdSet.size} уникальных ID`);

// ── 2. Все ID из JSON упомянуты в markdown ─────────────────────────────────
console.log('\n[2] ID из JSON → markdown');
for (const id of nodeIds) {
  if (!mdIdSet.has(id)) fail(`${id} есть в JSON, не упомянут в markdown`);
}
ok(`JSON содержит ${nodeIds.length} узлов`);

// ── 3. Нет текстов с «TODO» ────────────────────────────────────────────────
console.log('\n[3] Отсутствие TODO');
for (const id of nodeIds) {
  const n = nodes[id];
  const texts = [n.text];
  if (Array.isArray(n.variants)) n.variants.forEach(v => texts.push(v.text));
  for (const t of texts) {
    if (t && t.includes('TODO')) fail(`${id}: текст содержит TODO`);
  }
}
ok('TODO не найдено');

// ── 4. chat-узлы имеют непустой текст или варианты ────────────────────────
console.log('\n[4] Непустые тексты у chat-узлов');
for (const id of nodeIds) {
  const n = nodes[id];
  if (n.kind !== 'chat') continue;
  const hasText     = n.text && n.text.trim();
  const hasVariants = Array.isArray(n.variants) && n.variants.length > 0 &&
                      n.variants.every(v => v.text && v.text.trim());
  if (!hasText && !hasVariants) fail(`${id}: chat-узел без текста и вариантов`);
}
ok('все chat-узлы имеют текст или варианты');

// ── 5. Все answers[].next указывают на существующие ID или null ────────────
console.log('\n[5] Корректность переходов');
for (const id of nodeIds) {
  for (const ans of (nodes[id].answers || [])) {
    if (ans.next !== null && !nodes[ans.next]) {
      fail(`${id}: ответ «${ans.label}» ведёт в несуществующий ${ans.next}`);
    }
  }
}
ok('все переходы корректны');

// ── 6. Подсчёт по блокам ──────────────────────────────────────────────────
console.log('\n[6] Узлов по блокам');
const byBlock = {};
for (const id of nodeIds) {
  const b = nodes[id].block;
  byBlock[b] = (byBlock[b] || 0) + 1;
}
let total = 0;
for (const b of Object.keys(byBlock).sort((a,b) => +a - +b)) {
  const cnt = byBlock[b];
  total += cnt;
  console.log(`  Блок ${b}: ${cnt} узл${cnt===1?'':cnt<5?'а':'ов'}`);
}
console.log(`  Итого: ${total}`);

// ── Итог ───────────────────────────────────────────────────────────────────
console.log('');
if (errors === 0) {
  console.log('✅ Всё в порядке');
} else {
  console.error(`❌ Найдено ошибок: ${errors}`);
  process.exit(1);
}
