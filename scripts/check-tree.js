#!/usr/bin/env node
// Проверяет scripts/sales-tree-v2.json.
// Запуск: npm run check-tree
const fs   = require('fs');
const path = require('path');

const v2File = path.join(__dirname, 'sales-tree-v2.json');
const tree   = JSON.parse(fs.readFileSync(v2File, 'utf8'));

let errors = 0;
function fail(msg) { console.error('  ✗', msg); errors++; }
function ok(msg)   { console.log ('  ✓', msg); }

const BRAND_RE = /\b(InBody|VacuActiv|InfraShape|InfraStep|RollShape|SlimWay|WhatsApp|Fitbase|EasyChat|Kaspi|Qazyna|LRT|PDF)\b/gi;

function extractVars(text) {
  const m = text.match(/\{[^}]+\}/g);
  return m ? new Set(m) : new Set();
}

// ── 1. Все 7 этапов присутствуют ──────────────────────────────────────────
console.log('\n[1] Все 7 этапов присутствуют');
const stages = tree.stages;
if (!Array.isArray(stages)) { fail('stages не массив'); }
else {
  const ids = stages.map(s => s.id);
  for (let i = 1; i <= 7; i++) {
    if (!ids.includes(i)) fail(`Этап ${i} отсутствует`);
  }
  if (ids.length !== 7) fail(`Ожидается 7 этапов, найдено ${ids.length}`);
  else ok(`7 этапов: ${ids.join(', ')}`);
}

// ── 2. Нет пустых text у непендинговых шагов ──────────────────────────────
console.log('\n[2] Непустые тексты у непендинговых шагов');
let stepCount = 0;
for (const stage of (stages || [])) {
  for (const step of (stage.steps || [])) {
    if (step.pending) continue;
    if (step.reminders) continue; // дожим — массив напоминаний
    stepCount++;
    if (!step.text || !step.text.trim()) fail(`${step.id}: пустой text`);
  }
}
ok(`Проверено ${stepCount} шагов`);

// ── 3. text_kk присутствует у всех непендинговых шагов ────────────────────
console.log('\n[3] Наличие text_kk у этапных шагов');
for (const stage of (stages || [])) {
  for (const step of (stage.steps || [])) {
    if (step.pending) continue;
    if (step.reminders) {
      for (const r of step.reminders) {
        if (!r.text_kk || !r.text_kk.trim()) fail(`${step.id} напоминание ${r.kind}: нет text_kk`);
      }
      continue;
    }
    if (!step.text_kk || !step.text_kk.trim()) fail(`${step.id}: нет text_kk`);
  }
}
ok('text_kk проверены у этапных шагов');

// ── 4. text_kk в справочниках ──────────────────────────────────────────────
console.log('\n[4] Наличие text_kk в справочниках');
const refs = tree.refs || {};
for (const [refName, items] of Object.entries(refs)) {
  for (const item of (items || [])) {
    if (!item.text_kk || !item.text_kk.trim()) fail(`${refName}/${item.id}: нет text_kk`);
  }
}
ok('text_kk проверены в справочниках');

// ── 5. Переменные {…} в RU и KZ совпадают ─────────────────────────────────
console.log('\n[5] Совпадение переменных {…} в RU и KZ');

function checkVarParity(id, text, text_kk) {
  if (!text || !text_kk) return;
  const ruVars = extractVars(text);
  const kkVars = extractVars(text_kk);
  for (const v of ruVars) if (!kkVars.has(v)) fail(`${id}: переменная ${v} есть в RU, нет в KZ`);
  for (const v of kkVars) if (!ruVars.has(v)) fail(`${id}: переменная ${v} есть в KZ, нет в RU`);
}

for (const stage of (stages || [])) {
  for (const step of (stage.steps || [])) {
    if (step.pending || step.reminders) continue;
    checkVarParity(step.id, step.text, step.text_kk);
    if (step.clarify_fields) {
      const rw = step.refuse_height_weight;
      if (rw) checkVarParity(step.id + '.refuse', rw.text, rw.text_kk);
    }
  }
}
for (const [refName, items] of Object.entries(refs)) {
  for (const item of (items || [])) {
    checkVarParity(`${refName}/${item.id}`, item.text, item.text_kk);
    if (item.reminders) for (const r of item.reminders) checkVarParity(`${item.id}/${r.kind}`, r.text, r.text_kk);
  }
}
ok('переменные в RU/KZ проверены');

// ── 6. Нет латиницы вне брендов в KZ-текстах ──────────────────────────────
console.log('\n[6] Латиница вне брендов в KZ-текстах');

function checkKZLatin(id, text_kk) {
  if (!text_kk) return;
  const stripped = text_kk
    .replace(BRAND_RE, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/https?:\/\/\S+/g, '');
  if (/[a-zA-Z]/.test(stripped)) {
    const m = stripped.match(/[a-zA-Z]+/)?.[0] || '?';
    fail(`${id}: латиница в KZ — «${m}»`);
  }
}

for (const stage of (stages || [])) {
  for (const step of (stage.steps || [])) {
    checkKZLatin(step.id, step.text_kk);
    if (step.reminders) for (const r of step.reminders) checkKZLatin(`${step.id}/${r.kind}`, r.text_kk);
  }
}
for (const [refName, items] of Object.entries(refs)) {
  for (const item of (items || [])) {
    checkKZLatin(`${refName}/${item.id}`, item.text_kk);
  }
}
// bridge_map
for (const b of (tree.bridge_map || [])) {
  checkKZLatin(`bridge/${b.reason}`, b.text_kk);
}
ok('латиница в KZ-текстах только в именах брендов');

// ── 7. Все 3 справочника непустые ──────────────────────────────────────────
console.log('\n[7] Справочники непустые');
const REQ_REFS = ['objections', 'questions', 'silent'];
for (const r of REQ_REFS) {
  const items = refs[r];
  if (!Array.isArray(items) || items.length === 0) fail(`Справочник «${r}» пустой или отсутствует`);
  else ok(`${r}: ${items.length} элементов`);
}

// ── 8. bridge_map покрывает все причины ───────────────────────────────────
console.log('\n[8] bridge_map');
const REASONS = ['нет времени','тяжело, суставы','нет результата','скучно одной','дорого','не занималась'];
const bridgeReasons = new Set((tree.bridge_map || []).map(b => b.reason));
for (const r of REASONS) {
  if (!bridgeReasons.has(r)) fail(`bridge_map: нет причины «${r}»`);
}
ok(`bridge_map покрывает ${bridgeReasons.size} причин`);

// ── 9. imt_hints: 3 записи с max ──────────────────────────────────────────
console.log('\n[9] imt_hints');
const hints = tree.imt_hints || [];
if (hints.length !== 3) fail(`Ожидается 3 подсказки ИМТ, найдено ${hints.length}`);
else ok('3 подсказки ИМТ');

// ── Итог ───────────────────────────────────────────────────────────────────
console.log('');
if (errors === 0) {
  console.log('✅ Всё в порядке');
} else {
  console.error(`❌ Найдено ошибок: ${errors}`);
  process.exit(1);
}
