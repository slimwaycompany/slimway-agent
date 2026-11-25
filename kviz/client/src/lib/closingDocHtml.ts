interface ClosingDoc {
  closing_no: number; shift_date: string;
  opened_at: string; closed_at: string;
  opened_by: string; closed_by: string;
  opening_cash: number;
  cash_sales: number; card_sales: number;
  cash_refunds: number; card_refunds?: number;
  mov_in: number; mov_out: number;
  expected_cash: number; counted_cash: number; difference: number;
  cash_count?: Record<string, number> | null;
  comment?: string | null;
}

function fmt(n: number) { return Number(n).toLocaleString('ru-RU') + ' ₸'; }
function fmtDT(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function closingDocHtml(d: ClosingDoc): string {
  const cashCount = d.cash_count ?? {};
  const noteRows = [20000, 10000, 5000, 2000, 1000, 500]
    .filter(n => cashCount[String(n)])
    .map(n => `<tr><td>${n.toLocaleString('ru-RU')} ₸</td><td>${cashCount[String(n)]}</td><td>${fmt(n * cashCount[String(n)])}</td></tr>`)
    .join('');
  const coinRows = [200, 100, 50, 20, 10, 5, 2, 1]
    .filter(n => cashCount[String(n)])
    .map(n => `<tr><td>${n} ₸</td><td>${cashCount[String(n)]}</td><td>${fmt(n * cashCount[String(n)])}</td></tr>`)
    .join('');
  const cashCountBlock = (noteRows || coinRows) ? `
    <h3>Покупюрная ведомость</h3>
    <table><thead><tr><th>Номинал</th><th>Кол-во</th><th>Сумма</th></tr></thead>
    <tbody>${noteRows}${coinRows}</tbody></table>` : '';

  const diff = Number(d.difference);
  const diffLabel = diff >= 0 ? 'Излишек' : 'Недостача';
  const diffSign  = diff >= 0 ? '+' : '−';

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Закрытие кассы №${d.closing_no}</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 12pt; color: #000; background: #fff; margin: 0; padding: 0; }
h2 { font-size: 14pt; margin: 0 0 8pt; }
h3 { font-size: 12pt; margin: 14pt 0 6pt; }
p  { margin: 0 0 6pt; font-size: 11pt; }
table { border-collapse: collapse; width: 100%; margin-bottom: 10pt; }
td, th { border: 1px solid #000; padding: 4pt 7pt; font-size: 11pt; }
th { font-weight: bold; background: #e8e8e8; text-align: left; }
.right { text-align: right; }
.total { font-weight: bold; }
.diff-pos { color: #000; }
.diff-neg { color: #000; }
.sig { margin-top: 20pt; display: flex; gap: 40pt; }
.sig div { flex: 1; border-top: 1px solid #000; padding-top: 4pt; font-size: 10pt; }
</style></head>
<body>
<h2>Закрытие кассы №${d.closing_no}</h2>
<p>Смена: <b>${d.shift_date}</b></p>
<p>Открыл: ${d.opened_by} · ${fmtDT(d.opened_at)}</p>
<p>Закрыл: ${d.closed_by} · ${fmtDT(d.closed_at)}</p>
<h3>Итоги смены</h3>
<table>
<thead><tr><th>Показатель</th><th class="right">Сумма, ₸</th></tr></thead>
<tbody>
<tr><td>Остаток на начало смены</td><td class="right">${fmt(d.opening_cash)}</td></tr>
<tr><td>Продажи — наличными</td><td class="right">${fmt(d.cash_sales)}</td></tr>
<tr><td>Продажи — картой</td><td class="right">${fmt(d.card_sales)}</td></tr>
<tr><td>Возвраты — наличными</td><td class="right">${fmt(d.cash_refunds)}</td></tr>
${d.card_refunds ? `<tr><td>Возвраты — картой</td><td class="right">${fmt(d.card_refunds)}</td></tr>` : ''}
<tr><td>Внесения</td><td class="right">${fmt(d.mov_in)}</td></tr>
<tr><td>Изъятия</td><td class="right">${fmt(d.mov_out)}</td></tr>
<tr class="total"><td><b>Ожидаемые наличные</b></td><td class="right"><b>${fmt(d.expected_cash)}</b></td></tr>
<tr class="total"><td><b>Фактически (пересчёт)</b></td><td class="right"><b>${fmt(d.counted_cash)}</b></td></tr>
<tr class="total"><td><b>${diffLabel}</b></td><td class="right"><b>${diffSign}${fmt(Math.abs(diff))}</b></td></tr>
</tbody></table>
${cashCountBlock}
${d.comment ? `<p><b>Комментарий:</b> ${d.comment}</p>` : ''}
<div class="sig">
  <div>Кассир: ${d.closed_by}</div>
  <div>Подпись / дата</div>
</div>
</body></html>`;
}
