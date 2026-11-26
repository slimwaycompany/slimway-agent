// Шаблон скопирован из templates/zakrytie-smeny.html — НЕ менять разметку вручную.
// При изменении Excel-шаблона перегенерировать HTML и обновить TEMPLATE ниже.
const TEMPLATE = `<!DOCTYPE html>
<!--
  Закрытие смены — HTML-копия templates/zakrytie-smeny.xlsx (лист TDSheet, A1:R56) один в один.
  Сгенерировано из xlsx: ширины 18 колонок, высоты 56 строк, объединения, рамки, шрифт Arial 12/11/8 pt —
  всё умножено на 0,6248 (масштаб Excel «вписать на 1 страницу», A4 книжная, поля 0.25"/0.75").
  НЕ МЕНЯТЬ разметку, классы, размеры. Только подставить значения вместо {{...}} (с HTML-экранированием).
  Плейсхолдеры:
    {{closing_no}} {{org}} {{address}} {{opened_at}} {{closed_at}}  — шапка
    {{opening_cash}} {{kassa_name}} {{cash_in}} {{cash_out}} {{cash_left}} — наличные
    {{card_in}} {{card_out}} — безналичные
    {{n500}} {{n1000}} {{n2000}} {{n5000}} {{n10000}} {{n20000}} — купюры, штук
    {{c200}} {{c100}} {{c50}} {{c20}} {{c10}} {{c5}} {{c2}} {{c1}} — монеты, штук
    {{counted_cash}} — «Сумма наличных в кассе»; {{handed_sum}} {{handed_fio}} — строка «сдал»
-->
<html lang="ru"><head><meta charset="utf-8"><title>Закрытие смены №{{closing_no}}</title>
<style>
@page{size:A4 portrait;margin:0.75in 0.25in 0.75in 0.25in}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
table.zs{border-collapse:collapse;table-layout:fixed;width:559.44pt}
table.zs td{padding:0 0.94pt;overflow:visible;white-space:nowrap;vertical-align:bottom;font-size:7.50pt;line-height:1.1}
td.clip{overflow:hidden}
td.b{font-weight:700} td.c{text-align:center} td.r{text-align:right}
td.f8{font-size:5.00pt} td.f11{font-size:6.87pt}
td.bL{border-left:1px solid #000} td.bR{border-right:1px solid #000} td.bT{border-top:1px solid #000} td.bB{border-bottom:1px solid #000}
@media screen{body{padding:20px;background:#eee} table.zs{background:#fff;outline:20px solid #fff}}
</style></head><body>
<table class="zs">
<colgroup><col style="width:29.98pt"><col style="width:19.68pt"><col style="width:35.61pt"><col style="width:19.68pt"><col style="width:38.89pt"><col style="width:29.52pt"><col style="width:44.99pt"><col style="width:64.67pt"><col style="width:19.68pt"><col style="width:25.77pt"><col style="width:34.20pt"><col style="width:19.68pt"><col style="width:26.70pt"><col style="width:39.36pt"><col style="width:29.98pt"><col style="width:39.82pt"><col style="width:19.68pt"><col style="width:21.55pt"></colgroup>
<tr style="height:9.93pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="4" class="b">Закрытие смены №:</td><td colspan="13">{{closing_no}}</td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="4" class="b">Организация:</td><td colspan="13">{{org}}</td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="4" class="b">Город, адрес магазина:</td><td colspan="13">{{address}}</td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="4" class="b">Начало смены:</td><td colspan="13">{{opened_at}}</td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="4" class="b">Окончание смены:</td><td colspan="13">{{closed_at}}</td></tr>
<tr style="height:38.43pt"><td class="f8"></td><td colspan="17" class="clip f8">Блок сдающего смену _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ </td></tr>
<tr style="height:13.59pt"><td class="f8"></td><td colspan="7" class="b">Касса</td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:7.03pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="2" class="b">Наличные:</td><td>Сумма на начало смены: </td><td></td><td></td><td></td><td class="r">{{opening_cash}}</td><td>₸</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="b c bB bL bR bT">№</td><td colspan="6" class="b c bB bL bR bT">Касса</td><td colspan="3" class="b c bB bL bR bT">Приход, ₸</td><td colspan="3" class="b c bB bL bR bT">Расход, ₸</td><td colspan="3" class="b c bB bL bR bT">Остаток, ₸</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="c bB bL bR bT">1</td><td colspan="6" class="c bB bL bR bT">{{kassa_name}}</td><td colspan="3" class="c bB bL bR bT">{{cash_in}}</td><td colspan="3" class="c bB bL bR bT">{{cash_out}}</td><td colspan="3" class="c bB bL bR bT">{{cash_left}}</td><td class="f8"></td></tr>
<tr style="height:23.90pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td colspan="3" class="f8 c bT"></td><td colspan="3" class="f8 c bT"></td><td colspan="3" class="f8 c bT"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="3" class="b">Безналичные:</td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="b c bB bL bR bT">№</td><td colspan="6" class="b c bB bL bR bT">Касса</td><td colspan="3" class="b c bB bL bR bT">Приход, ₸</td><td colspan="3" class="b c bB bL bR bT">Расход, ₸</td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="c bB bL bR bT">1</td><td colspan="6" class="c bB bL bR bT">{{kassa_name}}</td><td colspan="3" class="c bB bL bR bT">{{card_in}}</td><td colspan="3" class="c bB bL bR bT">{{card_out}}</td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:26.71pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td colspan="3" class="f8 c bT"></td><td colspan="3" class="f8 c bT"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="16" class="b">Расхождения, вследствие операций по CRM:</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:21.56pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="16" class="b">Прочие расхождения</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:14.53pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:16.87pt"><td class="f8"></td><td class="f8"></td><td colspan="5" class="f11 c">Купюры</td><td colspan="4" class="f11 c">Монеты</td><td class="f8"></td><td class="f8"></td><td colspan="3" class="f11 c"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c">500</td><td colspan="2" class="f11 c">{{n500}}</td><td colspan="3" class="f11 c">200</td><td class="f11">{{c200}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c">1000</td><td colspan="2" class="f11 c">{{n1000}}</td><td colspan="3" class="f11 c">100</td><td class="f11">{{c100}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c">2000</td><td colspan="2" class="f11 c">{{n2000}}</td><td colspan="3" class="f11 c">50</td><td class="f11">{{c50}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c">5000</td><td colspan="2" class="f11 c">{{n5000}}</td><td colspan="3" class="f11 c">20</td><td class="f11">{{c20}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c">10000</td><td colspan="2" class="f11 c">{{n10000}}</td><td colspan="3" class="f11 c">10</td><td class="f11">{{c10}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c">20000</td><td colspan="2" class="f11 c">{{n20000}}</td><td colspan="3" class="f11 c">5</td><td class="f11">{{c5}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="2" class="f11 c"></td><td class="f11"></td><td colspan="2" class="f11 c"></td><td colspan="3" class="f11 c">2</td><td class="f11">{{c2}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:8.62pt"><td class="f11"></td><td class="f11"></td><td colspan="2" class="f11 c"></td><td class="f11"></td><td colspan="2" class="f11 c"></td><td colspan="3" class="f11 c">1</td><td class="f11">{{c1}}</td><td class="f11"></td><td class="f11"></td><td colspan="3" class="f11 c"></td><td class="f11"></td><td class="f11"></td></tr>
<tr style="height:4.69pt"><td class="f8"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="f8"></td></tr>
<tr style="height:11.25pt"><td class="f8"></td><td></td><td colspan="5">Сумма наличных в кассе</td><td colspan="6">{{counted_cash}}</td><td></td><td></td><td></td><td></td><td class="f8"></td></tr>
<tr style="height:16.40pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="4" class="b">Денежные средства ₸</td><td colspan="2" class="b bB">{{handed_sum}}</td><td class="b">сдал</td><td colspan="6" class="c bB">{{handed_fio}}</td><td colspan="3" class="b bB">/</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td colspan="2" class="c bT">в сумме</td><td class="f8"></td><td colspan="6" class="c bT">ФИО</td><td colspan="3" class="c bT">подпись</td><td class="f8"></td></tr>
<tr style="height:34.21pt"><td class="f8"></td><td colspan="17" class="clip f8">Блок принимающего смену _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ </td></tr>
<tr style="height:15.00pt"><td class="f8"></td><td colspan="16" class="b">Замечания, выявленные в ходе пересменки: </td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="bB"></td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="16" class="b">Подтверждаю принятие денежных средств:</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="12" class="c bB"></td><td colspan="4" class="bB">/</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="12" class="c bT">ФИО</td><td colspan="4" class="c bT">подпись</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td colspan="4" class="b">Денежные средства ₸</td><td colspan="2" class="b bB"></td><td class="b">принял</td><td colspan="6" class="b c bB"></td><td colspan="3" class="b bB">/</td><td class="f8"></td></tr>
<tr style="height:9.93pt"><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td class="f8"></td><td colspan="2" class="c bT">в сумме</td><td class="f8"></td><td colspan="6" class="c bT">ФИО</td><td colspan="3" class="c bT">подпись</td><td class="f8"></td></tr>
</table>
</body></html>`;

export interface ClosingDoc {
  closing_no: number;
  shift_date?: string;
  opened_at: string;
  closed_at: string;
  opened_by?: string;
  closed_by: string;
  opening_cash: number;
  cash_sales: number;
  card_sales: number;
  cash_refunds: number;
  card_refunds?: number;
  mov_in: number;
  mov_out: number;
  expected_cash?: number;
  counted_cash: number;
  difference?: number;
  cash_count?: Record<string, number> | null;
  comment?: string | null;
  // Branch info (added since task 108 — absent in older closing_doc snapshots)
  legal_name?: string | null;
  bin?: string | null;
  city?: string | null;
  address?: string | null;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '0';
  return Math.round(Number(n)).toLocaleString("ru-RU").replace(/[  ]/g, " ");
}

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Asia/Yekaterinburg',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => p.find(x => x.type === t)?.value ?? '';
    return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
  } catch { return iso; }
}

export function closingDocHtml(d: ClosingDoc): string {
  const cc = d.cash_count ?? {};
  const cnt = (key: number) => esc(cc[String(key)] ?? 0);

  const cashIn  = Number(d.cash_sales)   + Number(d.mov_in);
  const cashOut = Number(d.cash_refunds) + Number(d.mov_out);
  const cashLeft = Number(d.opening_cash) + cashIn - cashOut;

  const addressParts = [d.city, d.address].filter(Boolean).join(', ');
  const org = (d.legal_name && d.bin) ? `ТОО "${d.legal_name}" БИН:${d.bin}` : '';
  const kassaName = 'Касса 1  ' + addressParts;

  const vals: Record<string, string> = {
    closing_no:   esc(d.closing_no),
    org:          esc(org),
    address:      esc(addressParts),
    opened_at:    esc(fmtDT(d.opened_at)),
    closed_at:    esc(fmtDT(d.closed_at)),
    opening_cash: esc(fmtMoney(d.opening_cash)),
    kassa_name:   esc(kassaName),
    cash_in:      esc(fmtMoney(cashIn)),
    cash_out:     esc(fmtMoney(cashOut)),
    cash_left:    esc(fmtMoney(cashLeft)),
    card_in:      esc(fmtMoney(d.card_sales)),
    card_out:     esc(fmtMoney(d.card_refunds)),
    n500:  cnt(500),  n1000: cnt(1000), n2000:  cnt(2000),
    n5000: cnt(5000), n10000: cnt(10000), n20000: cnt(20000),
    c200: cnt(200), c100: cnt(100), c50: cnt(50), c20: cnt(20),
    c10:  cnt(10),  c5:   cnt(5),  c2:  cnt(2),  c1:  cnt(1),
    counted_cash: esc(fmtMoney(d.counted_cash)),
    handed_sum:   esc(fmtMoney(d.counted_cash)),
    handed_fio:   esc(d.closed_by),
  };

  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, key) => vals[key] ?? '');
}
