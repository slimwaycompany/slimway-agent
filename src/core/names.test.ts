import assert from 'assert';
import { shortName } from './names';

// Returns true when string has no lone (unpaired) surrogates
function isWellFormed(s: string): boolean {
  return !/[\uD800-\uDFFF]/.test(s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''));
}

const cases: [Parameters<typeof shortName>, string, string][] = [
  [[{ name: 'инст 07.10' }],                                          'инст',         '"инст 07.10" → первое слово'],
  [[{ name: 'тт заявка 06.10' }],                                     'тт заявка',    '"тт заявка 06.10" → два слова до даты'],
  [[{ name: '77015999399' }, { name: 'Жанель', surname: 'Абенова' }], 'Жанель А.',    'телефон в name, клиент с именем+фамилией'],
  [[{ name: 'Асель мимо проходила' }],                                 'Асель М.',     '3 слова без цифр → «Имя Ф.»'],
  [[{ id: 507, name: '77015999399' }],                                 'Клиент #507',  'только телефон, нет клиента → запасной вариант'],
  [[{ id: 100 }],                                                      'Клиент #100',  'нет name/title/client → запасной вариант'],
  [[{ name: 'Жанель' }, { name: 'Жанель', surname: 'Абенова' }],      'Жанель А.',    'клиент с фамилией всегда первый источник'],
  [[{ name: 'Асель' }],                                                'Асель',        'одно слово → без изменений'],
  // Emoji — surrogate pairs must not be split → result must be well-formed
  [[{ name: '🌷🌸' }],                                                 '🌷🌸',         'два эмодзи без пробела → одно слово, без изменений'],
  [[{ name: 'salta 🦋' }],                                             'salta 🦋',     'слово + эмодзи: эмодзи = 1 символ Unicode → не сокращается'],
  [[{ name: '🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋' }],                   '🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋🦋', '14 эмодзи → одно слово, без изменений'],
];

let passed = 0;
let failed = 0;

for (const [args, expected, desc] of cases) {
  const actual = shortName(...args);
  const wf     = isWellFormed(actual);
  if (actual === expected && wf) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ ${desc}`);
    if (actual !== expected) {
      console.error(`    ожидалось:  "${expected}"`);
      console.error(`    получилось: "${actual}"`);
    }
    if (!wf) console.error(`    НЕПАРНЫЙ СУРРОГАТ в результате`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
