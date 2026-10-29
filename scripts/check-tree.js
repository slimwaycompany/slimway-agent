#!/usr/bin/env node
// Проверяет scripts/sales-tree.json: ID, тексты, переходы, KZ, хабы.
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

// Бренды, которые допустимы в KZ-тексте латиницей
const BRAND_RE = /\b(InBody|VacuActiv|InfraShape|InfraStep|RollShape|SlimWay|WhatsApp|Fitbase|EasyChat|Kaspi|Qazyna)\b/gi;

function extractVars(text) {
  const m = text.match(/\{[^}]+\}/g);
  return m ? new Set(m) : new Set();
}

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

// ── 5. Все переходы ведут на существующие ID или null ─────────────────────
console.log('\n[5] Корректность переходов');
for (const id of nodeIds) {
  const n = nodes[id];
  for (const ans of (n.answers || [])) {
    if (ans.next !== null && !nodes[ans.next]) {
      fail(`${id}: ответ «${ans.label}» ведёт в несуществующий ${ans.next}`);
    }
  }
  if (n.next !== undefined && n.next !== null && !nodes[n.next]) {
    fail(`${id}: next ведёт в несуществующий ${n.next}`);
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

// ── 7. KZ-текст у каждого неpending chat/bot-узла ────────────────────────
console.log('\n[7] Наличие KZ-текста');
for (const id of nodeIds) {
  const n = nodes[id];
  if (n.pending) continue;
  if (n.kind !== 'chat' && n.kind !== 'bot') continue;
  if (Array.isArray(n.variants) && n.variants.length > 0) {
    for (const v of n.variants) {
      if (!v.text_kk || !v.text_kk.trim()) fail(`${id} вариант «${v.label}»: нет text_kk`);
    }
  } else {
    if (!n.text_kk || !n.text_kk.trim()) fail(`${id}: нет text_kk`);
  }
}
ok('KZ-тексты проверены');

// ── 8. Совпадение переменных в RU и KZ ───────────────────────────────────
console.log('\n[8] Совпадение переменных {…} в RU и KZ');
for (const id of nodeIds) {
  const n = nodes[id];
  if (n.pending) continue;
  if (n.kind !== 'chat' && n.kind !== 'bot') continue;
  const pairs = [];
  if (Array.isArray(n.variants) && n.variants.length > 0) {
    for (const v of n.variants) {
      if (v.text && v.text_kk) pairs.push([v.text, v.text_kk, `вариант «${v.label}»`]);
    }
  } else if (n.text && n.text_kk) {
    pairs.push([n.text, n.text_kk, 'text']);
  }
  for (const [ru, kk, label] of pairs) {
    const ruVars = extractVars(ru);
    const kkVars = extractVars(kk);
    for (const v of ruVars) if (!kkVars.has(v)) fail(`${id} ${label}: переменная ${v} есть в RU, нет в KZ`);
    for (const v of kkVars) if (!ruVars.has(v)) fail(`${id} ${label}: переменная ${v} есть в KZ, нет в RU`);
  }
}
ok('переменные в RU/KZ совпадают');

// ── 9. Нет Latin/Russian замен Казахских букв в KZ-текстах ───────────────
console.log('\n[9] Отсутствие латиницы вне брендов в KZ-текстах');
for (const id of nodeIds) {
  const n = nodes[id];
  if (n.pending) continue;
  const kkTexts = [];
  if (Array.isArray(n.variants)) n.variants.forEach(v => v.text_kk && kkTexts.push([v.text_kk, `вариант «${v.label}»`]));
  if (n.text_kk) kkTexts.push([n.text_kk, 'text']);
  for (const [kk, label] of kkTexts) {
    const stripped = kk
      .replace(BRAND_RE, '')
      .replace(/\{[^}]+\}/g, '');  // убираем {Переменные}
    if (/[a-zA-Z]/.test(stripped)) {
      fail(`${id} ${label}: латиница вне брендов — «${stripped.match(/[a-zA-Z]+/)[0]}»`);
    }
  }
}
ok('латиница в KZ-текстах только в именах брендов');

// ── 10. Ровно 3 узла с hub: true ─────────────────────────────────────────
console.log('\n[10] Хаб-узлы (hub: true)');
const hubs = nodeIds.filter(id => nodes[id].hub === true);
if (hubs.length !== 3) fail(`ожидается 3 хаб-узла, найдено ${hubs.length}: ${hubs.join(', ')}`);
else ok(`хаб-узлы: ${hubs.join(', ')}`);

// ── Итог ───────────────────────────────────────────────────────────────────
console.log('');
if (errors === 0) {
  console.log('✅ Всё в порядке');
} else {
  console.error(`❌ Найдено ошибок: ${errors}`);
  process.exit(1);
}
