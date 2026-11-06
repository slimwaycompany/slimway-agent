export interface ParseResult {
  field: string;
  value: string;
  confidence: 'sure' | 'guess';
}

// Cyrillic-only word with capital first letter, 2-15 chars
const NAME_RE = /(?:^|\s)([А-ЯЁ][а-яё]{1,14})(?:\s|$|[,.])/;

// Number patterns
const NUM_RE = /\b(\d{2,3}(?:[.,]\d)?)\b/g;

// Goal keywords
const GOAL_RE = /похуде|сброс|фигур|живот|накача|тонус|здоровь|похудеу|арықта|денсаулы|тонус/i;

// Experience keywords
const EXP_RE = /нет опыта|первый раз|не занималась|занималась|хожу\b|ходила\b|\bзал\b|тренирова|жоқ тәжірибе|бірінші рет/i;

// Refusal reason keywords
const WHY_RE = /дорого|не подошло|далеко|не понравилось|результата нет|не смогла|закончила|қымбат|нәтиже жоқ/i;

function allNumbers(text: string): number[] {
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(text)) !== null) {
    nums.push(parseFloat(m[1].replace(',', '.')));
  }
  return nums;
}

export function parseClientReply(text: string): ParseResult[] {
  const results: ParseResult[] = [];
  const t = text.trim();

  // Name
  const nameM = NAME_RE.exec(t);
  if (nameM) {
    const name = nameM[1];
    if (/^[А-ЯЁ][а-яё]{1,14}$/.test(name)) {
      results.push({ field: 'Имя', value: name, confidence: 'sure' });
    }
  }

  // Age: number 15-80 with context word or standalone
  const ageCtx = /(?:мне|мне\s+есть|лет|год(?:а|ов)?)[:\s]*(\d{2})|(\d{2})\s*(?:лет|год(?:а|ов)?)/i.exec(t);
  if (ageCtx) {
    const v = Number(ageCtx[1] ?? ageCtx[2]);
    if (v >= 15 && v <= 80) results.push({ field: 'Возраст', value: String(v), confidence: 'sure' });
  } else {
    const nums = allNumbers(t).filter(n => n >= 15 && n <= 80);
    if (nums.length === 1) results.push({ field: 'Возраст', value: String(Math.round(nums[0])), confidence: 'guess' });
  }

  // Height: 140-210 with context or standalone
  const htCtx = /(?:рост|бой)[:\s]*(\d{3})|(\d{3})\s*см/i.exec(t);
  if (htCtx) {
    const v = Number(htCtx[1] ?? htCtx[2]);
    if (v >= 140 && v <= 210) results.push({ field: 'Рост', value: String(v), confidence: 'sure' });
  } else {
    const nums = allNumbers(t).filter(n => n >= 140 && n <= 210);
    if (nums.length >= 1) results.push({ field: 'Рост', value: String(Math.round(nums[0])), confidence: 'guess' });
  }

  // Weight: 40-200 with context or second large number
  const wtCtx = /(?:вес|салмақ)[:\s]*(\d{2,3})|(\d{2,3})\s*кг/i.exec(t);
  if (wtCtx) {
    const v = Number(wtCtx[1] ?? wtCtx[2]);
    if (v >= 40 && v <= 200) results.push({ field: 'Вес', value: String(v), confidence: 'sure' });
  } else {
    const nums = allNumbers(t).filter(n => n >= 40 && n <= 200);
    if (nums.length >= 2) results.push({ field: 'Вес', value: String(Math.round(nums[1])), confidence: 'guess' });
  }

  // Goal
  const goalM = GOAL_RE.exec(t);
  if (goalM) {
    const sentence = t.split(/[.!?]/).find(s => GOAL_RE.test(s)) ?? t.slice(0, 80);
    results.push({ field: 'Цель', value: sentence.trim().slice(0, 100), confidence: 'sure' });
  }

  // Experience
  const expM = EXP_RE.exec(t);
  if (expM) {
    const sentence = t.split(/[.!?]/).find(s => EXP_RE.test(s)) ?? t.slice(0, 80);
    results.push({ field: 'Опыт', value: sentence.trim().slice(0, 100), confidence: 'sure' });
  }

  // Refusal reason
  const whyM = WHY_RE.exec(t);
  if (whyM) {
    const sentence = t.split(/[.!?]/).find(s => WHY_RE.test(s)) ?? t.slice(0, 80);
    results.push({ field: 'Почему не подошло', value: sentence.trim().slice(0, 100), confidence: 'sure' });
  }

  return results;
}
