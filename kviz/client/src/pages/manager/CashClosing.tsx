import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';

interface Op {
  id: number; pay_ts: string; amount: number; is_refund: boolean; op_type: string;
  payment_type: string; pay_method: string; item_type: string; cashier: string; client: string;
}
interface TodayData {
  today: string;
  totals: { cash_in: number; card_in: number; cash_refund: number; card_refund: number; deposits: number; withdrawals: number };
  ops: Op[];
  opening_from_last: number | null;
  last_closing_date: string | null;
  today_closing: Record<string, unknown> | null;
  shift_start: string | null;
  shift_end: string | null;
  synced_at: string | null;
}
interface Expense { desc: string; amount: number }

const NOTES = [20000, 10000, 5000, 2000, 1000, 500];
const COINS = [200, 100, 50, 20, 10, 5, 2, 1];

function fmt(n: number) { return n.toLocaleString('ru', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtTs(iso: string) {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
}
function fmtSyncTime(iso: string | null) {
  if (!iso) return 'никогда';
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
}
function toLocalDatetime(iso: string | null): string {
  if (!iso) return '';
  // Convert to local datetime-local input value (YYYY-MM-DDTHH:MM) in Yekaterinburg
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}
function fromLocalDatetime(local: string): string {
  if (!local) return '';
  return new Date(local + ':00+05:00').toISOString();
}

interface Props { onClose: () => void }

export default function CashClosing({ onClose }: Props) {
  const [data, setData]       = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [actionError, setActionError] = useState('');

  const [openingCash, setOpeningCash]     = useState<number | ''>('');
  const [openingManual, setOpeningManual] = useState(false);
  const [deposits, setDeposits]           = useState(0);
  const [withdrawals, setWithdrawals]     = useState(0);
  const [expenses, setExpenses]           = useState<Expense[]>([{ desc: '', amount: 0 }]);
  const [billCounts, setBillCounts]       = useState<Record<number, number>>({});
  const [crmNote, setCrmNote]             = useState('');
  const [otherNote, setOtherNote]         = useState('');
  const [remarks, setRemarks]             = useState('');
  const [shiftStart, setShiftStart]       = useState('');
  const [shiftEnd, setShiftEnd]           = useState('');

  const printRef = useRef<HTMLIFrameElement>(null);

  async function loadData() {
    setLoading(true);
    try {
      const d: TodayData = await fetch('/kviz/api/cash/today', { credentials: 'include' }).then(r => r.json());
      setData(d);
      const rec = d.today_closing;
      if (rec) {
        setOpeningCash(Number(rec.opening_cash ?? 0));
        setDeposits(Number(rec.deposits ?? 0));
        setWithdrawals(Number(rec.withdrawals ?? 0));
        setExpenses((rec.expenses as Expense[]) || [{ desc: '', amount: 0 }]);
        setBillCounts((rec.cash_count as Record<number, number>) || {});
        setCrmNote(String(rec.crm_discrepancy_note ?? ''));
        setOtherNote(String(rec.other_discrepancy_note ?? ''));
        setRemarks(String(rec.remarks ?? ''));
        setShiftStart(toLocalDatetime(rec.shift_start as string || d.shift_start));
        setShiftEnd(toLocalDatetime(rec.shift_end as string || d.shift_end));
      } else {
        if (d.opening_from_last !== null) setOpeningCash(d.opening_from_last);
        else setOpeningManual(true);
        setDeposits(d.totals.deposits);
        setWithdrawals(d.totals.withdrawals);
        setShiftStart(toLocalDatetime(d.shift_start));
        setShiftEnd(toLocalDatetime(d.shift_end));
      }
    } catch { setData(null); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    (async () => { await loadData(); await sync(true); })();
  }, []);

  async function sync(silent = false) {
    setSyncing(true); if (!silent) setActionError('');
    try {
      const r = await fetch('/kviz/api/cash/sync', { method: 'POST', credentials: 'include' });
      const json = await r.json();
      if (!r.ok) { if (!silent) setActionError('Ошибка синхронизации: ' + (json.error || r.status)); return; }
      await loadData();
    } catch (e) { if (!silent) setActionError('Ошибка: ' + e); }
    finally { setSyncing(false); }
  }

  const t = data?.totals;
  const cashIn    = t?.cash_in    ?? 0;
  const cardIn    = t?.card_in    ?? 0;
  const cashRefund = t?.cash_refund ?? 0;
  const cardRefund = t?.card_refund ?? 0;

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const countedCash   = [...NOTES, ...COINS].reduce((s, d) => s + d * (billCounts[d] || 0), 0);
  const opening       = Number(openingCash) || 0;
  const expectedCash  = opening + cashIn + deposits - cashRefund - withdrawals - totalExpenses;
  const discrepancy   = countedCash > 0 ? countedCash - expectedCash : 0;

  function setBill(denom: number, val: string) {
    setBillCounts(prev => ({ ...prev, [denom]: Math.max(0, parseInt(val, 10) || 0) }));
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
        noncash_out: cardRefund,
        refunds: cashRefund + cardRefund, deposits, withdrawals,
        expenses, cash_count: billCounts,
        counted_cash: countedCash > 0 ? countedCash : null,
        expected_cash: expectedCash,
        discrepancy: countedCash > 0 ? discrepancy : null,
        crm_discrepancy_note: crmNote || null,
        other_discrepancy_note: otherNote || null,
        remarks: remarks || null,
        shift_start: shiftStart ? fromLocalDatetime(shiftStart) : null,
        shift_end:   shiftEnd   ? fromLocalDatetime(shiftEnd)   : null,
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
    } catch (e) { setActionError('Ошибка сохранения: ' + e); }
    finally { setSaving(false); }
  }

  async function downloadExcel() {
    if (!data) return;
    try {
      // Fetch template as ArrayBuffer
      const resp = await fetch('/kviz/api/cash/closing-template', { credentials: 'include' });
      if (!resp.ok) { setActionError('Шаблон Excel не найден на сервере'); return; }
      const ab = await resp.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });

      const sh1 = wb.Sheets[wb.SheetNames[0]];

      function setCell(addr: string, value: unknown) {
        const t = typeof value === 'number' ? 'n' : 's';
        sh1[addr] = { v: value, t };
      }

      // Find the closing_no from today_closing if saved, else leave blank
      const closingNo = data.today_closing ? (data.today_closing as Record<string, unknown>).closing_no : '';
      setCell('F2', closingNo ?? '');
      setCell('F5', shiftStart ? toLocalDatetime(fromLocalDatetime(shiftStart)) : '');
      setCell('F6', shiftEnd   ? toLocalDatetime(fromLocalDatetime(shiftEnd))   : '');
      setCell('H10', opening);
      setCell('I13', cashIn + deposits);
      setCell('L13', cashRefund + withdrawals + totalExpenses);
      setCell('O13', expectedCash);
      setCell('I18', cardIn);
      setCell('L18', cardRefund);

      // CRM discrepancy notes (split by line into B21-B24)
      const crmLines = crmNote.split('\n').slice(0, 4);
      ['B21','B22','B23','B24'].forEach((cell, i) => setCell(cell, crmLines[i] ?? ''));
      // Other discrepancy notes (B26-B29)
      const otherLines = otherNote.split('\n').slice(0, 4);
      ['B26','B27','B28','B29'].forEach((cell, i) => setCell(cell, otherLines[i] ?? ''));

      // Bill counts F31-F36 = 500,1000,2000,5000,10000,20000
      [500,1000,2000,5000,10000,20000].forEach((d, i) => setCell(`F${31+i}`, billCounts[d] || 0));
      // Coin counts K31-K38 = 200,100,50,20,10,5,2,1
      [200,100,50,20,10,5,2,1].forEach((d, i) => setCell(`K${31+i}`, billCounts[d] || 0));

      // H40: template formula — don't touch
      setCell('F42', countedCash > 0 ? countedCash : '');
      setCell('I42', data.today_closing ? String((data.today_closing as Record<string, unknown>).closed_by ?? '') : '');

      // Remarks B46-B49
      const remarkLines = remarks.split('\n').slice(0, 4);
      ['B46','B47','B48','B49'].forEach((cell, i) => setCell(cell, remarkLines[i] ?? ''));

      // Sheet 2 — operations of the day
      const sh2Name = wb.SheetNames[1] ?? 'Операции';
      let sh2 = wb.Sheets[sh2Name];
      if (!sh2) { sh2 = {}; wb.SheetNames.push(sh2Name); wb.Sheets[sh2Name] = sh2; }
      const headers = ['Время','Тип','Клиент','Кассир','Сумма','Способ оплаты','Товар'];
      headers.forEach((h, i) => { sh2[XLSX.utils.encode_cell({ r: 0, c: i })] = { v: h, t: 's' }; });
      data.ops.forEach((op, row) => {
        const vals = [
          fmtTs(op.pay_ts), op.op_type === 'refund' ? 'Возврат' : op.op_type,
          op.client, op.cashier, op.is_refund ? -op.amount : op.amount, op.pay_method, op.item_type,
        ];
        vals.forEach((v, col) => { sh2[XLSX.utils.encode_cell({ r: row + 1, c: col })] = { v, t: typeof v === 'number' ? 'n' : 's' }; });
      });
      sh2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.ops.length, c: 6 } });

      XLSX.writeFile(wb, `zakrytie-smeny-${data.today}.xlsx`);
    } catch (e) { setActionError('Ошибка Excel: ' + e); }
  }

  function print() {
    if (!printRef.current || !data) return;
    const html = buildPrintHtml(data, {
      opening, cashIn, cardIn, cashRefund, cardRefund, deposits, withdrawals,
      expenses, billCounts, countedCash, expectedCash, discrepancy,
      crmNote, otherNote, remarks, today: data.today,
      shiftStartLabel: shiftStart, shiftEndLabel: shiftEnd,
      closingNo: data.today_closing ? String((data.today_closing as Record<string, unknown>).closing_no ?? '') : '',
      closedBy: data.today_closing ? String((data.today_closing as Record<string, unknown>).closed_by ?? '') : '',
    });
    const ifrm = printRef.current;
    ifrm.srcdoc = html;
    ifrm.onload = () => { ifrm.contentWindow?.print(); ifrm.onload = null; };
  }

  if (loading) return (
    <div style={S.overlay}><div style={S.modal}><div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Загрузка данных…</div></div></div>
  );

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        {/* Test mode banner */}
        <div style={{ background: '#fef3c7', borderBottom: '1px solid #fcd34d', padding: '8px 18px', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8, borderRadius: '12px 12px 0 0' }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span><b>Тестовый режим</b> — в Fitbase ничего не отправляется</span>
        </div>

        {actionError && (
          <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', padding: '8px 18px', fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>{actionError}</span>
            <button onClick={() => setActionError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#ef4444', padding: 0 }}>✕</button>
          </div>
        )}

        <div style={S.header}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>Закрытие смены{data?.today ? ` — ${data.today}` : ''}</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={save} disabled={saving} style={S.btnPrimary}>{saving ? '…' : saved ? '✓ Сохранено' : 'Сохранить'}</button>
            <button onClick={print} style={S.btnSecondary}>Печать</button>
            <button onClick={downloadExcel} style={S.btnSecondary}>Excel</button>
            <button onClick={onClose} style={S.btnClose}>✕</button>
          </div>
        </div>

        <div style={S.body}>
          {/* Sync status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e6ea', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#6b7280', flex: 1, minWidth: 0 }}>
              Данные операций: обновлено в <b>{fmtSyncTime(data?.synced_at ?? null)}</b>
            </span>
            <button onClick={() => sync()} disabled={syncing} style={{ ...S.btnSecondary, fontSize: 12, padding: '4px 12px', flexShrink: 0 }}>
              {syncing ? '…' : '↺ Обновить'}
            </button>
          </div>

          {/* Shift times */}
          <Section title="Время смены">
            <Row label="Начало"><input style={S.input} type="datetime-local" value={shiftStart} onChange={e => setShiftStart(e.target.value)} /></Row>
            <Row label="Конец"><input style={S.input} type="datetime-local" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} /></Row>
          </Section>

          {/* Opening cash */}
          <Section title="Начало смены">
            {data?.last_closing_date && !openingManual
              ? <Row label={`Остаток на ${data.last_closing_date}`}><b>{fmt(opening)}</b> ₸ <button onClick={() => setOpeningManual(true)} style={S.linkBtn}>изменить</button></Row>
              : <Row label="Остаток наличными на начало"><input style={S.input} type="number" value={openingCash === '' ? '' : openingCash} onChange={e => setOpeningCash(e.target.value === '' ? '' : Number(e.target.value))} /></Row>
            }
          </Section>

          {/* Ops from Fitbase */}
          <Section title={`Операции из Fitbase — ${data?.ops.length ?? 0} шт.`}>
            <Row label="Продажи наличными"><b>{fmt(cashIn)}</b> ₸</Row>
            <Row label="Продажи по карте"><b>{fmt(cardIn)}</b> ₸</Row>
            <Row label="Возвраты наличными"><b>−{fmt(cashRefund)}</b> ₸</Row>
            <Row label="Возвраты по карте"><b>−{fmt(cardRefund)}</b> ₸</Row>
            {(t?.deposits ?? 0) > 0 && <Row label="Внесения (из Fitbase)"><b>{fmt(t!.deposits)}</b> ₸</Row>}
            {(t?.withdrawals ?? 0) > 0 && <Row label="Изъятия (из Fitbase)"><b>−{fmt(t!.withdrawals)}</b> ₸</Row>}
          </Section>

          {/* Manual deposits/withdrawals */}
          <Section title="Внесения / Изъятия">
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
                    value={billCounts[d] || ''} onChange={e => setBill(d, e.target.value)} />
                  {' × = '}<b>{fmt(d * (billCounts[d] || 0))}</b>
                </Row>
              ))}
              <div style={{ gridColumn: '1/-1', fontSize: 12, color: '#94a3b8', margin: '4px 0 2px' }}>Монеты</div>
              {COINS.map(d => (
                <Row key={d} label={`${d} ₸`}>
                  <input style={{ ...S.input, width: 60, textAlign: 'right' }} type="number" min={0}
                    value={billCounts[d] || ''} onChange={e => setBill(d, e.target.value)} />
                  {' × = '}<b>{fmt(d * (billCounts[d] || 0))}</b>
                </Row>
              ))}
            </div>
          </Section>

          {/* Summary */}
          <Section title="Итог">
            <Row label="Ожидаемый остаток (нал.)"><b>{fmt(expectedCash)}</b> ₸</Row>
            <Row label="Безнал приход"><b>{fmt(cardIn)}</b> ₸</Row>
            <Row label="Безнал расход"><b>−{fmt(cardRefund)}</b> ₸</Row>
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
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Прочие расхождения</div>
              <textarea style={S.textarea} value={otherNote} onChange={e => setOtherNote(e.target.value)} rows={2} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Замечания при пересменке</div>
              <textarea style={S.textarea} value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
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
  deposits: number; withdrawals: number; expenses: Expense[]; billCounts: Record<number, number>;
  countedCash: number; expectedCash: number; discrepancy: number;
  crmNote: string; otherNote: string; remarks: string; today: string;
  shiftStartLabel: string; shiftEndLabel: string; closingNo: string; closedBy: string;
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
    `<tr><td>${fmtTs(op.pay_ts)}</td><td>${op.is_refund ? 'Возврат' : op.op_type}</td><td>${op.client}</td><td>${op.cashier}</td><td>${op.is_refund ? '-' : ''}${fmt(op.amount)} ₸</td><td>${op.pay_method}</td></tr>`
  ).join('');

  // Totals by type for sheet 2
  const totByType: Record<string, number> = {};
  for (const op of data.ops) {
    totByType[op.op_type] = (totByType[op.op_type] || 0) + (op.is_refund ? -op.amount : op.amount);
  }
  const totRows = Object.entries(totByType).map(([t, s]) => `<tr><td>${t}</td><td>${fmt(s)} ₸</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:16px}
  h1{font-size:14px;text-align:center;margin-bottom:12px;font-weight:700}
  h2{font-size:12px;margin:12px 0 6px;font-weight:700}
  table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px}
  td,th{padding:3px 6px;border:1px solid #ccc}
  th{background:#f0f0f0;font-weight:600}
  .num{text-align:right}
  .bold{font-weight:700}
  .disc{color:${p.discrepancy !== 0 ? 'red' : 'green'};font-weight:700}
  .sign{display:flex;gap:40px;margin-top:24px;page-break-inside:avoid}
  .sign-block{min-width:160px}
  .sign-line{border-bottom:1px solid #000;margin-top:28px;margin-bottom:4px}
  @media print{body{padding:6px}}
  @page{size:A4;margin:12mm}
</style></head><body>
<h1>Закрытие смены — ${p.today}${p.closingNo ? ` № ${p.closingNo}` : ''}</h1>
<table>
  ${p.shiftStartLabel ? `<tr><td>Начало смены</td><td class="num">${p.shiftStartLabel.replace('T',' ')}</td></tr>` : ''}
  ${p.shiftEndLabel   ? `<tr><td>Конец смены</td><td class="num">${p.shiftEndLabel.replace('T',' ')}</td></tr>` : ''}
  <tr><td>Сумма на начало</td><td class="num bold">${fmt(p.opening)} ₸</td></tr>
  <tr><td>Приход наличными (продажи + внесения)</td><td class="num bold">${fmt(p.cashIn + p.deposits)} ₸</td></tr>
  <tr><td>Расход наличными (возвраты + изъятия + расходы)</td><td class="num">${fmt(p.cashRefund + p.withdrawals + totalExpenses)} ₸</td></tr>
  <tr><td><b>Остаток</b></td><td class="num bold">${fmt(p.expectedCash)} ₸</td></tr>
  <tr><td>Приход безнал</td><td class="num">${fmt(p.cardIn)} ₸</td></tr>
  <tr><td>Расход безнал</td><td class="num">${fmt(p.cardRefund)} ₸</td></tr>
  ${p.countedCash ? `<tr><td>Посчитано купюрами</td><td class="num bold">${fmt(p.countedCash)} ₸</td></tr>
  <tr><td>Расхождение</td><td class="num disc">${p.discrepancy >= 0 ? '+' : ''}${fmt(p.discrepancy)} ₸</td></tr>` : ''}
</table>
${expRows ? `<h2>Расходы</h2><table><tr><th>Назначение</th><th>Сумма</th></tr>${expRows}</table>` : ''}
${billRows ? `<h2>Купюры и монеты</h2><table><tr><th>Номинал</th><th>Кол-во</th><th>Сумма</th></tr>${billRows}</table>` : ''}
${p.crmNote   ? `<h2>Расхождения по операциям CRM</h2><p style="font-size:11px">${p.crmNote.replace(/\n/g,'<br>')}</p>` : ''}
${p.otherNote ? `<h2>Прочие расхождения</h2><p style="font-size:11px">${p.otherNote.replace(/\n/g,'<br>')}</p>` : ''}
${p.remarks   ? `<h2>Замечания при пересменке</h2><p style="font-size:11px">${p.remarks.replace(/\n/g,'<br>')}</p>` : ''}
<div class="sign">
  <div class="sign-block"><div class="sign-line"></div><div>Сдал${p.closedBy ? ': '+p.closedBy : ''}</div></div>
  <div class="sign-block"><div class="sign-line"></div><div>Принял</div></div>
</div>
<div style="margin-top:28px;page-break-before:always">
<h1>Операции за ${p.today}</h1>
<table><tr><th>Время</th><th>Тип</th><th>Клиент</th><th>Кассир</th><th>Сумма</th><th>Оплата</th></tr>
${opRows}
</table>
<h2>Итого по типам</h2>
<table><tr><th>Тип</th><th>Сумма</th></tr>${totRows}</table>
</div>
</body></html>`;
}

const S: Record<string, React.CSSProperties> = {
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '20px 0' },
  modal:     { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 700, margin: '0 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' },
  header:    { padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, position: 'sticky', top: 0, background: '#fff', zIndex: 1 },
  body:      { padding: '18px', overflowY: 'auto' },
  btnPrimary:{ background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnSecondary: { background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  btnClose:  { background: 'none', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 13, color: '#64748b' },
  linkBtn:   { background: 'none', border: 'none', color: '#263CD9', cursor: 'pointer', fontSize: 13, padding: 0 },
  input:     { padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', width: 120 },
  textarea:  { width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
};
