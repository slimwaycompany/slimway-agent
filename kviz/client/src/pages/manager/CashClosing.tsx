import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';

interface Op {
  id: number; pay_ts: string; amount: number; is_refund: boolean;
  payment_type: string; item_type: string; cashier: string; client: string;
}
interface TodayData {
  today: string;
  totals: { cash_in: number; card_in: number; cash_refund: number; card_refund: number };
  ops: Op[];
  opening_from_last: number | null;
  last_closing_date: string | null;
  today_closing: Record<string,unknown> | null;
}
interface Expense { desc: string; amount: number }

const NOTES  = [20000, 10000, 5000, 2000, 1000, 500];
const COINS  = [200, 100, 50, 20, 10, 5, 2, 1];

function fmt(n: number) { return n.toLocaleString('ru', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtTs(iso: string) {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
}

interface Props { onClose: () => void }

export default function CashClosing({ onClose }: Props) {
  const [data, setData]         = useState<TodayData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  // Form state
  const [openingCash, setOpeningCash]  = useState<number | ''>('');
  const [openingManual, setOpeningManual] = useState(false);
  const [deposits, setDeposits]        = useState(0);
  const [withdrawals, setWithdrawals]  = useState(0);
  const [expenses, setExpenses]        = useState<Expense[]>([{ desc: '', amount: 0 }]);
  const [billCounts, setBillCounts]    = useState<Record<number, number>>({});
  const [crmNote, setCrmNote]          = useState('');
  const [otherNote, setOtherNote]      = useState('');

  const printRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetch('/kviz/api/cash/today', { credentials: 'include' })
      .then(r => r.json())
      .then((d: TodayData) => {
        setData(d);
        const rec = d.today_closing;
        if (rec) {
          setOpeningCash(Number(rec.opening_cash ?? 0));
          setDeposits(Number(rec.deposits ?? 0));
          setWithdrawals(Number(rec.withdrawals ?? 0));
          setExpenses((rec.expenses as Expense[]) || [{ desc: '', amount: 0 }]);
          setBillCounts((rec.cash_count as Record<number,number>) || {});
          setCrmNote(String(rec.crm_discrepancy_note ?? ''));
          setOtherNote(String(rec.other_discrepancy_note ?? ''));
        } else if (d.opening_from_last !== null) {
          setOpeningCash(d.opening_from_last);
        } else {
          setOpeningManual(true);
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const t = data?.totals;
  const cashIn    = t?.cash_in    ?? 0;
  const cardIn    = t?.card_in    ?? 0;
  const cashRefund = t?.cash_refund ?? 0;
  const cardRefund = t?.card_refund ?? 0;

  const totalExpenses  = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const countedCash    = [...NOTES, ...COINS].reduce((s, d) => s + d * (billCounts[d] || 0), 0);
  const opening        = Number(openingCash) || 0;
  const expectedCash   = opening + cashIn - cashRefund + deposits - withdrawals - totalExpenses;
  const discrepancy    = countedCash > 0 ? countedCash - expectedCash : 0;

  function setBill(denom: number, val: string) {
    const n = Math.max(0, parseInt(val, 10) || 0);
    setBillCounts(prev => ({ ...prev, [denom]: n }));
  }

  function addExpense() { setExpenses(prev => [...prev, { desc: '', amount: 0 }]); }
  function removeExpense(i: number) { setExpenses(prev => prev.filter((_, j) => j !== i)); }
  function updateExpense(i: number, field: 'desc' | 'amount', val: string) {
    setExpenses(prev => prev.map((e, j) => j === i ? { ...e, [field]: field === 'amount' ? Number(val) || 0 : val } : e));
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const body = {
        opening_cash: opening, cash_in: cashIn, noncash_in: cardIn,
        refunds: cashRefund + cardRefund, deposits, withdrawals,
        expenses, cash_count: billCounts,
        counted_cash: countedCash > 0 ? countedCash : null,
        expected_cash: expectedCash,
        discrepancy: countedCash > 0 ? discrepancy : null,
        crm_discrepancy_note: crmNote || null,
        other_discrepancy_note: otherNote || null,
        fitbase_ops: data.ops,
      };
      const r = await fetch('/kviz/api/cash/closing', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert('Ошибка сохранения: ' + e); }
    finally { setSaving(false); }
  }

  function print() {
    if (!printRef.current || !data) return;
    const html = buildPrintHtml(data, { opening, cashIn, cardIn, cashRefund, cardRefund, deposits, withdrawals, expenses, billCounts, countedCash, expectedCash, discrepancy, crmNote, otherNote, today: data.today });
    const ifrm = printRef.current;
    ifrm.srcdoc = html;
    ifrm.onload = () => { ifrm.contentWindow?.print(); ifrm.onload = null; };
  }

  function downloadExcel() {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: summary
    const s1rows = [
      ['Закрытие смены', data.today],
      [],
      ['Начало смены (наличные)', opening],
      ['Продажи наличными', cashIn],
      ['Возвраты наличными', -cashRefund],
      ['Внесения', deposits],
      ['Изъятия', -withdrawals],
      ['Расходы', -totalExpenses],
      ['Ожидаемый остаток', expectedCash],
      ['Посчитано купюрами', countedCash],
      ['Расхождение', discrepancy],
      [],
      ['Продажи безналичными', cardIn],
      ['Возвраты безналичными', -cardRefund],
    ];
    if (crmNote)   s1rows.push(['Расхождения CRM', crmNote]);
    if (otherNote) s1rows.push(['Прочие расхождения', otherNote]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1rows), 'Закрытие смены');

    // Sheet 2: operations
    const headers = ['Время', 'Тип операции', 'Тип товара', 'Клиент', 'Кассир', 'Сумма', 'Способ оплаты'];
    const rows = data.ops.map(op => [
      fmtTs(op.pay_ts),
      op.is_refund ? 'Возврат' : 'Продажа',
      op.item_type,
      op.client,
      op.cashier,
      op.is_refund ? -op.amount : op.amount,
      op.payment_type,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Операции');

    XLSX.writeFile(wb, `zakrytie-smeny-${data.today}.xlsx`);
  }

  if (loading) return (
    <div style={S.overlay}><div style={S.modal}><div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Загрузка данных…</div></div></div>
  );

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.header}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>Закрытие смены{data?.today ? ` — ${data.today}` : ''}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={S.btnPrimary}>{saving ? '…' : saved ? '✓ Сохранено' : 'Сохранить'}</button>
            <button onClick={print} style={S.btnSecondary}>Печать</button>
            <button onClick={downloadExcel} style={S.btnSecondary}>Excel</button>
            <button onClick={onClose} style={S.btnClose}>✕</button>
          </div>
        </div>

        <div style={S.body}>
          {/* Opening cash */}
          <Section title="Начало смены">
            {data?.last_closing_date && !openingManual
              ? <Row label={`Остаток на ${data.last_closing_date}`}><b>{fmt(opening)}</b> ₸ <button onClick={() => setOpeningManual(true)} style={S.linkBtn}>изменить</button></Row>
              : <Row label="Остаток наличными на начало"><input style={S.input} type="number" value={openingCash === '' ? '' : openingCash} onChange={e => setOpeningCash(e.target.value === '' ? '' : Number(e.target.value))} /></Row>
            }
          </Section>

          {/* Fitbase */}
          <Section title="Данные из Fitbase (только чтение)">
            <Row label="Продажи наличными"><b>{fmt(cashIn)}</b> ₸</Row>
            <Row label="Продажи по карте"><b>{fmt(cardIn)}</b> ₸</Row>
            <Row label="Возвраты наличными"><b>−{fmt(cashRefund)}</b> ₸</Row>
            <Row label="Возвраты по карте"><b>−{fmt(cardRefund)}</b> ₸</Row>
            <Row label="Операций за день"><b>{data?.ops.length ?? 0}</b></Row>
          </Section>

          {/* Manual deposits/withdrawals */}
          <Section title="Внесения / Изъятия (ручной ввод — нет в Fitbase)">
            <Row label="Внесения ₸"><input style={S.input} type="number" value={deposits || ''} onChange={e => setDeposits(Number(e.target.value) || 0)} /></Row>
            <Row label="Изъятия ₸"><input style={S.input} type="number" value={withdrawals || ''} onChange={e => setWithdrawals(Number(e.target.value) || 0)} /></Row>
          </Section>

          {/* Expenses */}
          <Section title={`Расходы (итого: ${fmt(totalExpenses)} ₸)`}>
            {expenses.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <input style={{ ...S.input, flex: 2 }} placeholder="На что" value={e.desc} onChange={ev => updateExpense(i, 'desc', ev.target.value)} />
                <input style={{ ...S.input, flex: 1 }} type="number" placeholder="Сумма" value={e.amount || ''} onChange={ev => updateExpense(i, 'amount', ev.target.value)} />
                {expenses.length > 1 && <button onClick={() => removeExpense(i)} style={S.linkBtn}>✕</button>}
              </div>
            ))}
            <button onClick={addExpense} style={S.linkBtn}>+ добавить</button>
          </Section>

          {/* Bill counter */}
          <Section title={`Подсчёт купюр (итого: ${fmt(countedCash)} ₸)`}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              {NOTES.map(d => (
                <Row key={d} label={`${fmt(d)} ₸`}>
                  <input style={{ ...S.input, width: 60, textAlign: 'right' }} type="number" min={0}
                    value={billCounts[d] || ''}
                    onChange={e => setBill(d, e.target.value)}
                  /> × = <b>{fmt(d * (billCounts[d] || 0))}</b>
                </Row>
              ))}
              <div style={{ gridColumn: '1/-1', fontSize: 12, color: '#94a3b8', margin: '4px 0 2px' }}>Монеты</div>
              {COINS.map(d => (
                <Row key={d} label={`${d} ₸`}>
                  <input style={{ ...S.input, width: 60, textAlign: 'right' }} type="number" min={0}
                    value={billCounts[d] || ''}
                    onChange={e => setBill(d, e.target.value)}
                  /> × = <b>{fmt(d * (billCounts[d] || 0))}</b>
                </Row>
              ))}
            </div>
          </Section>

          {/* Summary */}
          <Section title="Итог">
            <Row label="Ожидаемый остаток (нал.)"><b>{fmt(expectedCash)}</b> ₸</Row>
            <Row label="Посчитано купюрами"><b>{fmt(countedCash)}</b> ₸ {countedCash === 0 && <span style={{ color: '#94a3b8', fontSize: 12 }}>(не заполнено)</span>}</Row>
            {countedCash > 0 && (
              <Row label="Расхождение">
                <b style={{ color: discrepancy === 0 ? '#22c55e' : '#ef4444' }}>
                  {discrepancy >= 0 ? '+' : ''}{fmt(discrepancy)} ₸
                </b>
              </Row>
            )}
          </Section>

          {/* Notes */}
          <Section title="Комментарии">
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Расхождения по операциям CRM</div>
              <textarea style={S.textarea} value={crmNote} onChange={e => setCrmNote(e.target.value)} rows={2} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Прочие расхождения</div>
              <textarea style={S.textarea} value={otherNote} onChange={e => setOtherNote(e.target.value)} rows={2} />
            </div>
          </Section>
        </div>

        <iframe ref={printRef} style={{ display: 'none' }} title="print" />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#475569', borderBottom: '1px solid #e2e8f0', paddingBottom: 4, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, fontSize: 14 }}>
      <span style={{ color: '#64748b', minWidth: 180 }}>{label}</span>
      {children}
    </div>
  );
}

interface PrintData {
  opening: number; cashIn: number; cardIn: number; cashRefund: number; cardRefund: number;
  deposits: number; withdrawals: number; expenses: Expense[]; billCounts: Record<number,number>;
  countedCash: number; expectedCash: number; discrepancy: number; crmNote: string; otherNote: string; today: string;
}

function buildPrintHtml(data: TodayData, p: PrintData): string {
  const totalExpenses = p.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const expRows = p.expenses.filter(e => e.amount).map(e =>
    `<tr><td>${e.desc || '—'}</td><td>${fmt(e.amount)} ₸</td></tr>`).join('');
  const billRows = [...NOTES, ...COINS]
    .filter(d => (p.billCounts[d] || 0) > 0)
    .map(d => `<tr><td>${fmt(d)} ₸</td><td>${p.billCounts[d]}</td><td>${fmt(d * p.billCounts[d])} ₸</td></tr>`)
    .join('');
  const opRows = data.ops.map(op =>
    `<tr><td>${fmtTs(op.pay_ts)}</td><td>${op.is_refund ? 'Возврат' : 'Продажа'}</td><td>${op.client}</td><td>${op.cashier}</td><td>${op.is_refund ? '-' : ''}${fmt(op.amount)} ₸</td><td>${op.payment_type}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:20px}
  h1{font-size:15px;text-align:center;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  td,th{padding:4px 8px;border:1px solid #ccc;font-size:11px}
  th{background:#f0f0f0;font-weight:600}
  .sum{font-weight:700}
  .disc{color:${p.discrepancy !== 0 ? 'red' : 'green'};font-weight:700}
  .sign{display:flex;gap:40px;margin-top:24px}
  .sign-line{border-bottom:1px solid #000;width:160px;margin-top:32px}
  @media print{body{padding:8px}.no-print{display:none} }
  @page{size:A4;margin:15mm}
</style></head><body>
<h1>Закрытие смены — ${p.today}</h1>
<table>
  <tr><td>Остаток на начало</td><td class="sum">${fmt(p.opening)} ₸</td></tr>
  <tr><td>Продажи наличными</td><td class="sum">${fmt(p.cashIn)} ₸</td></tr>
  <tr><td>Продажи по карте</td><td class="sum">${fmt(p.cardIn)} ₸</td></tr>
  <tr><td>Возвраты наличными</td><td>−${fmt(p.cashRefund)} ₸</td></tr>
  <tr><td>Возвраты по карте</td><td>−${fmt(p.cardRefund)} ₸</td></tr>
  ${p.deposits ? `<tr><td>Внесения</td><td>${fmt(p.deposits)} ₸</td></tr>` : ''}
  ${p.withdrawals ? `<tr><td>Изъятия</td><td>−${fmt(p.withdrawals)} ₸</td></tr>` : ''}
  ${totalExpenses ? `<tr><td>Расходы</td><td>−${fmt(totalExpenses)} ₸</td></tr>` : ''}
  <tr><td><b>Ожидаемый остаток</b></td><td class="sum">${fmt(p.expectedCash)} ₸</td></tr>
  ${p.countedCash ? `<tr><td>Посчитано</td><td class="sum">${fmt(p.countedCash)} ₸</td></tr>
  <tr><td>Расхождение</td><td class="disc">${p.discrepancy >= 0 ? '+' : ''}${fmt(p.discrepancy)} ₸</td></tr>` : ''}
</table>
${expRows ? `<p><b>Расходы:</b></p><table><tr><th>Назначение</th><th>Сумма</th></tr>${expRows}</table>` : ''}
${billRows ? `<p><b>Купюры:</b></p><table><tr><th>Номинал</th><th>Кол-во</th><th>Сумма</th></tr>${billRows}</table>` : ''}
${p.crmNote ? `<p><b>Расхождения CRM:</b> ${p.crmNote}</p>` : ''}
${p.otherNote ? `<p><b>Прочие расхождения:</b> ${p.otherNote}</p>` : ''}
<div class="sign"><div><div class="sign-line"></div><div>Сдал</div></div><div><div class="sign-line"></div><div>Принял</div></div></div>
<div style="margin-top:30px;page-break-before:always">
<h1>Операции за ${p.today}</h1>
<table><tr><th>Время</th><th>Тип</th><th>Клиент</th><th>Кассир</th><th>Сумма</th><th>Оплата</th></tr>
${opRows}
</table></div>
</body></html>`;
}

const S: Record<string, React.CSSProperties> = {
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '20px 0' },
  modal:     { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 700, margin: '0 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' },
  header:    { padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#fff', zIndex: 1, borderRadius: '12px 12px 0 0' },
  body:      { padding: '18px', overflowY: 'auto' },
  btnPrimary:{ background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnSecondary: { background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  btnClose:  { background: 'none', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 13, color: '#64748b' },
  linkBtn:   { background: 'none', border: 'none', color: '#263CD9', cursor: 'pointer', fontSize: 13, padding: 0 },
  input:     { padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', width: 120 },
  textarea:  { width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
};
