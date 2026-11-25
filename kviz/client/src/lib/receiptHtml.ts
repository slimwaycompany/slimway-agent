interface ReceiptItem {
  label: string;
  amount: number;
}
interface ReceiptPayment {
  methodName: string;
  amount: number;
}
export interface ReceiptData {
  number: number;
  date: string;        // ISO string
  cashier: string;
  manager?: string | null;
  items: ReceiptItem[];
  payments: ReceiptPayment[];
  total: number;
}

function fmt(n: number) { return Number(n).toLocaleString('ru-RU') + ' ₸'; }

export function receiptHtml(d: ReceiptData): string {
  const dt = new Date(d.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const itemRows = d.items.map(it =>
    `<tr><td>${it.label}</td><td class="r">${fmt(it.amount)}</td></tr>`
  ).join('');
  const payRows = d.payments.map(p =>
    `<tr><td>${p.methodName}</td><td class="r">${fmt(p.amount)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Квитанция №${d.number}</title>
<style>
@page { size: 80mm auto; margin: 4mm; }
* { box-sizing: border-box; }
body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: #fff; margin: 0; width: 72mm; }
h3 { font-size: 11pt; text-align: center; margin: 0 0 4pt; }
p  { text-align: center; font-size: 9pt; margin: 0 0 4pt; color: #333; }
hr { border: none; border-top: 1px dashed #000; margin: 6pt 0; }
table { width: 100%; border-collapse: collapse; }
td { font-size: 9.5pt; padding: 2pt 0; vertical-align: top; }
td.r { text-align: right; white-space: nowrap; padding-left: 4pt; }
.total td { font-size: 11pt; font-weight: bold; border-top: 1px solid #000; padding-top: 3pt; }
.thanks { text-align: center; font-size: 9pt; margin-top: 8pt; color: #333; }
</style></head>
<body>
<h3>SlimWay</h3>
<p>Квитанция №${d.number}</p>
<p>${dt}</p>
<p>Кассир: ${d.cashier}${d.manager && d.manager !== d.cashier ? ` · Менеджер: ${d.manager}` : ''}</p>
<hr>
<table><tbody>${itemRows}</tbody></table>
<hr>
<table>
  <tbody>${payRows}</tbody>
  <tbody class="total"><tr><td>ИТОГО</td><td class="r">${fmt(d.total)}</td></tr></tbody>
</table>
<p class="thanks">Спасибо за покупку!</p>
</body></html>`;
}
