import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import MetricsPage from '../MetricsPage';
import OccupancySection from './OccupancySection';
import { parseLookinBodyCSV } from '../../utils/parseLookinBodyCSV';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShiftRecord {
  id: string; user_id: string; user_name: string; shift_date: string;
  started_at: string; ended_at: string | null; status: string;
  replacing: string | null; comment: string | null;
  sheet_synced_start: boolean; sheet_synced_end: boolean;
}
interface TaskDone {
  id: string; template_id: string; task_date: string; done_by: string;
  done_by_name: string; done_at: string;
  manager_task_templates: { title: string; slot_time: string; category: string };
}
interface SalesOp {
  id: number; pay_ts: string; amount: number; is_refund: boolean;
  payment_type: string; item_type: string; cashier: string; manager: string; client: string; op_type: string;
}
interface SalesData {
  from: string; to: string;
  totals: { cash_sale: number; card_sale: number; cash_refund: number; card_refund: number };
  by_manager: { name: string; amount: number }[];
  by_cashier: { name: string; amount: number }[];
  ops: SalesOp[];
}

type Section = 'shifts' | 'tasks' | 'studio' | 'sales' | 'funnel' | 'occupancy' | 'settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toYekLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return d.toISOString().slice(0, 16);
}
function fromYekLocal(val: string): string {
  if (!val) return '';
  return new Date(new Date(val + ':00Z').getTime() - 5 * 3600_000).toISOString();
}
function fmtHHMM(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
function fmtDate(iso: string) { return iso.split('-').reverse().join('.'); }
function calcHoursNum(s: ShiftRecord): number {
  if (!s.started_at || !s.ended_at) return 0;
  return (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000;
}
function calcHours(s: ShiftRecord): string {
  if (!s.started_at || !s.ended_at) return '—';
  return calcHoursNum(s).toFixed(1);
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
}
function downloadCSV(rows: (string | number)[][], filename: string) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 7) + '-01';
const SHIFT_STATUS: Record<string, string> = { open: 'открыта', closed: 'закрыта', auto_closed: 'авто' };

// ── Board definition ──────────────────────────────────────────────────────────

const BOARD_SECTIONS: { id: Section; icon: string; label: string; desc: string; adminOnly: boolean }[] = [
  { id: 'shifts',    icon: '📅', label: 'Смены',           desc: 'Отметки, часы, сотрудники',        adminOnly: false },
  { id: 'tasks',     icon: '✅', label: 'Личные задачи',   desc: 'Выполнение задач по периоду',       adminOnly: false },
  { id: 'funnel',    icon: '📈', label: 'Воронки',         desc: 'Лиды, конверсия, источники',        adminOnly: true  },
  { id: 'sales',     icon: '💰', label: 'Продажи',         desc: 'Операции Fitbase, разбивка',        adminOnly: true  },
  { id: 'occupancy', icon: '🗓️', label: 'Занятия',         desc: 'Загруженность по часам и дням',    adminOnly: true  },
  { id: 'studio',    icon: '🏅', label: 'Результаты студии', desc: 'Итого по всем клиентам',          adminOnly: true  },
  { id: 'settings',  icon: '⚙️', label: 'Настройки',        desc: 'Импорт InBody, пересчёт, без клиента', adminOnly: true  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [section, setSection] = useState<Section | null>(() => {
    try { return (sessionStorage.getItem('reports-section') as Section | null) ?? null; } catch { return null; }
  });
  const [role, setRole] = useState<string>('manager');

  useEffect(() => {
    fetch('/kviz/api/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.role) setRole(d.role); })
      .catch(() => {});
  }, []);

  function openSection(s: Section) {
    setSection(s);
    try { sessionStorage.setItem('reports-section', s); } catch {}
  }
  function backToBoard() {
    setSection(null);
    try { sessionStorage.removeItem('reports-section'); } catch {}
  }

  const isAdmin = role === 'admin';
  const visibleSections = BOARD_SECTIONS.filter(s => !s.adminOnly || isAdmin);

  return (
    <div style={s.root}>
      <div style={s.header}>
        {section ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button style={s.backBtn} onClick={backToBoard}>← Все отчёты</button>
            <span style={s.title}>{BOARD_SECTIONS.find(b => b.id === section)?.label}</span>
          </div>
        ) : (
          <span style={s.title}>Отчёты</span>
        )}
      </div>

      {/* Board */}
      {!section && (
        <div style={s.board}>
          {visibleSections.map(sec => (
            <button key={sec.id} style={s.boardCard} onClick={() => openSection(sec.id)}>
              <span style={{ fontSize: 28 }}>{sec.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#1a202c' }}>{sec.label}</span>
              <span style={{ fontSize: 12, color: '#64748b' }}>{sec.desc}</span>
            </button>
          ))}
          {/* Замеры — opens measure reports in the measure pane via postMessage */}
          <button style={s.boardCard} onClick={() => window.parent.postMessage({ type: 'open-measure', path: '/kviz/measure/reports' }, '*')}>
            <span style={{ fontSize: 28 }}>📏</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#1a202c' }}>Замеры</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>Список клиентов, отчёты замеров</span>
          </button>
        </div>
      )}

      {/* Sections */}
      {section === 'shifts'    && isAdmin !== undefined && <ShiftsSection />}
      {section === 'tasks'     && <TasksSection />}
      {section === 'funnel'    && isAdmin && <div style={{ flex: 1, overflow: 'auto', height: 'calc(100vh - 53px)' }}><MetricsPage /></div>}
      {section === 'sales'     && isAdmin && <SalesSection />}
      {section === 'occupancy' && isAdmin && <OccupancySection />}
      {section === 'studio'    && isAdmin && <StudioSection />}
      {section === 'settings'  && isAdmin && <SettingsSection />}
    </div>
  );
}

// ── Shifts section ────────────────────────────────────────────────────────────

function ShiftsSection() {
  const [shiftFrom, setShiftFrom] = useState(monthStart);
  const [shiftTo, setShiftTo]     = useState(today);
  const [shifts, setShifts]       = useState<ShiftRecord[]>([]);
  const [loading, setLoading]     = useState(false);
  const [editShift, setEditShift] = useState<Partial<ShiftRecord> | null>(null);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/kviz/api/shifts?from=${shiftFrom}&to=${shiftTo}`, { credentials: 'include' });
      setShifts(r.ok ? await r.json() : []);
    } catch {} finally { setLoading(false); }
  }, [shiftFrom, shiftTo]);

  const monthlyTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const sh of shifts) {
      if (!sh.started_at || !sh.ended_at) continue;
      const key = `${sh.user_name}|${sh.shift_date.slice(0, 7)}`;
      map.set(key, (map.get(key) ?? 0) + calcHoursNum(sh));
    }
    return [...map.entries()]
      .map(([k, h]) => { const [name, month] = k.split('|'); return { name, month, hours: h }; })
      .sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
  }, [shifts]);

  const saveShift = async () => {
    if (!editShift?.id) return;
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (editShift.started_at !== undefined) body.started_at = editShift.started_at;
      if (editShift.ended_at   !== undefined) body.ended_at   = editShift.ended_at;
      if (editShift.status     !== undefined) body.status     = editShift.status;
      if (editShift.replacing  !== undefined) body.replacing  = editShift.replacing;
      if (editShift.comment    !== undefined) body.comment    = editShift.comment;
      const r = await fetch(`/kviz/api/shifts/${editShift.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Ошибка');
      setEditShift(null);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  return (
    <div style={s.section}>
      <div style={s.filterRow}>
        <input type="date" style={s.dateInp} value={shiftFrom} onChange={e => setShiftFrom(e.target.value)} />
        <span style={{ color: '#64748b' }}>—</span>
        <input type="date" style={s.dateInp} value={shiftTo} onChange={e => setShiftTo(e.target.value)} />
        <button style={s.loadBtn} onClick={load} disabled={loading}>{loading ? '...' : 'Загрузить'}</button>
        {shifts.length > 0 && (
          <button style={s.csvBtn} onClick={() => {
            const rows = [
              ['Дата','Сотрудник','Начало','Конец','Часов','Статус','Замена','Комментарий'],
              ...shifts.map(sh => [sh.shift_date, sh.user_name, fmtHHMM(sh.started_at), fmtHHMM(sh.ended_at), calcHours(sh), sh.status, sh.replacing ?? '', sh.comment ?? '']),
            ];
            downloadCSV(rows, `shifts_${shiftFrom}_${shiftTo}.csv`);
          }}>CSV</button>
        )}
      </div>

      {shifts.length === 0 && !loading && <div style={s.empty}>Нет данных за период</div>}

      {shifts.map(sh => (
        <div key={sh.id} style={shiftRowSt(sh)}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.rowTitle}>
              {fmtDate(sh.shift_date)} · {sh.user_name}
              {sh.replacing && <span style={s.muted}> (замена: {sh.replacing})</span>}
            </div>
            <div style={s.rowMeta}>
              {fmtHHMM(sh.started_at)} — {fmtHHMM(sh.ended_at)} · {calcHours(sh)} ч
              {' · '}{SHIFT_STATUS[sh.status] ?? sh.status}
              {sh.ended_at && !sh.sheet_synced_end && <span style={s.warn}> ! не в таблице</span>}
            </div>
            {sh.comment && <div style={{ ...s.rowMeta, marginTop: 2 }}>{sh.comment}</div>}
          </div>
          <button style={s.editBtn} onClick={() => setEditShift({ ...sh })}>Ред.</button>
        </div>
      ))}

      {monthlyTotals.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={s.sectionTitle}>Итого по месяцам</div>
          {monthlyTotals.map(mt => (
            <div key={mt.month + mt.name} style={s.totalRow}>
              <span>{mt.month} · {mt.name}</span>
              <span style={{ fontWeight: 700, color: '#02BDB6' }}>{mt.hours.toFixed(1)} ч</span>
            </div>
          ))}
        </div>
      )}

      {editShift && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={s.mh3}>Редактировать смену</h3>
            {error && <div style={s.errBox}>{error}</div>}
            <MField label="Начало (Екб)">
              <input style={s.inp} type="datetime-local" value={toYekLocal(editShift.started_at)}
                onChange={e => setEditShift(p => ({ ...p!, started_at: fromYekLocal(e.target.value) }))} />
            </MField>
            <MField label="Конец (Екб)">
              <input style={s.inp} type="datetime-local" value={toYekLocal(editShift.ended_at)}
                onChange={e => setEditShift(p => ({ ...p!, ended_at: e.target.value ? fromYekLocal(e.target.value) : null }))} />
            </MField>
            <MField label="Статус">
              <select style={s.inp} value={editShift.status ?? 'closed'} onChange={e => setEditShift(p => ({ ...p!, status: e.target.value }))}>
                <option value="open">открыта</option>
                <option value="closed">закрыта</option>
                <option value="auto_closed">авто-закрыта</option>
              </select>
            </MField>
            <MField label="Замена">
              <input style={s.inp} value={editShift.replacing ?? ''} onChange={e => setEditShift(p => ({ ...p!, replacing: e.target.value || null }))} />
            </MField>
            <MField label="Комментарий">
              <input style={s.inp} value={editShift.comment ?? ''} onChange={e => setEditShift(p => ({ ...p!, comment: e.target.value || null }))} />
            </MField>
            <div style={s.mBtns}>
              <button style={s.cancelBtn} onClick={() => { setEditShift(null); setError(null); }}>Отмена</button>
              <button style={s.saveBtn} disabled={saving} onClick={saveShift}>{saving ? '...' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tasks section ─────────────────────────────────────────────────────────────

function TasksSection() {
  const [from, setFrom]   = useState(monthStart);
  const [to, setTo]       = useState(today);
  const [tasks, setTasks] = useState<TaskDone[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/kviz/api/reports/tasks?from=${from}&to=${to}`, { credentials: 'include' });
      setTasks(r.ok ? await r.json() : []);
    } catch {} finally { setLoading(false); }
  }, [from, to]);

  const byPerson = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) map.set(t.done_by_name, (map.get(t.done_by_name) ?? 0) + 1);
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [tasks]);

  return (
    <div style={s.section}>
      <div style={s.filterRow}>
        <input type="date" style={s.dateInp} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: '#64748b' }}>—</span>
        <input type="date" style={s.dateInp} value={to} onChange={e => setTo(e.target.value)} />
        <button style={s.loadBtn} onClick={load} disabled={loading}>{loading ? '...' : 'Загрузить'}</button>
        {tasks.length > 0 && (
          <button style={s.csvBtn} onClick={() => {
            downloadCSV([
              ['Дата','Задача','Слот','Выполнил','Время'],
              ...tasks.map(t => [t.task_date, t.manager_task_templates?.title ?? '', t.manager_task_templates?.slot_time ?? '', t.done_by_name, fmtTime(t.done_at)]),
            ], `tasks_${from}_${to}.csv`);
          }}>CSV</button>
        )}
      </div>
      {tasks.length === 0 && !loading && <div style={s.empty}>Нет данных за период</div>}
      {tasks.length > 0 && (
        <>
          {byPerson.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={s.sectionTitle}>По сотрудникам</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {byPerson.map(p => <div key={p.name} style={s.personChip}>{p.name}: {p.count}</div>)}
              </div>
            </div>
          )}
          {tasks.map(t => (
            <div key={t.id} style={s.taskRow}>
              <div style={s.taskDate}>{fmtDate(t.task_date)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.rowTitle}>{t.manager_task_templates?.title ?? t.template_id}</div>
                <div style={s.rowMeta}>{t.done_by_name} · {fmtTime(t.done_at)}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Studio section ────────────────────────────────────────────────────────────

function StudioSection() {
  const [studio, setStudio]   = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/kviz/api/reports/studio', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setStudio)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={s.section}>
      {loading && <div style={s.empty}>Загрузка...</div>}
      {!loading && studio.length === 0 && <div style={s.empty}>Нет данных</div>}
      {studio.map((row, i) => (
        <div key={String(row.id ?? i)} style={s.studioRow}>
          {Object.entries(row).filter(([k]) => k !== 'id').map(([k, v]) => (
            <div key={k} style={s.studioField}>
              <span style={s.studioKey}>{k}:</span>
              <span style={s.studioVal}>{String(v ?? '—')}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Sales section ─────────────────────────────────────────────────────────────

function SalesSection() {
  const [from, setFrom]     = useState(today);
  const [to, setTo]         = useState(today);
  const [data, setData]     = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  // Multi-select filters (empty set = show all)
  const [filterCashier, setFilterCashier]   = useState<Set<string>>(new Set());
  const [filterManager, setFilterManager]   = useState<Set<string>>(new Set());
  const [filterItem, setFilterItem]         = useState<Set<string>>(new Set());
  const [filterPayMethod, setFilterPayMethod] = useState<Set<string>>(new Set());
  const [filterOpType, setFilterOpType]     = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/kviz/api/reports/sales?from=${from}&to=${to}`, { credentials: 'include' });
      const d = r.ok ? await r.json() : null;
      setData(d);
      // Reset filters when new data loads
      setFilterCashier(new Set()); setFilterManager(new Set());
      setFilterItem(new Set()); setFilterPayMethod(new Set()); setFilterOpType(new Set());
    } catch {} finally { setLoading(false); }
  }, [from, to]);

  async function syncFB() {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await fetch('/kviz/api/cash/sync', { method: 'POST', credentials: 'include' });
      const j = await r.json() as Record<string, unknown>;
      setSyncMsg(r.ok ? `Обновлено в ${new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : String(j.error || 'Ошибка'));
      if (r.ok) await load();
    } catch (e) { setSyncMsg(String(e)); }
    finally { setSyncing(false); }
  }

  function setPreset(preset: 'today' | 'week' | 'month') {
    const now = new Date(Date.now() + 5 * 3600_000);
    const d = now.toISOString().slice(0, 10);
    if (preset === 'today') { setFrom(d); setTo(d); return; }
    if (preset === 'week') {
      const dow = now.getUTCDay() || 7;
      const mon = new Date(now.getTime() - (dow - 1) * 86400_000).toISOString().slice(0, 10);
      setFrom(mon); setTo(d); return;
    }
    setFrom(d.slice(0, 7) + '-01'); setTo(d);
  }

  function toggleFilter(set: Set<string>, val: string, setFn: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setFn(next);
  }

  const filteredOps = useMemo(() => {
    if (!data) return [];
    return data.ops.filter(op =>
      (filterCashier.size   === 0 || filterCashier.has(op.cashier))   &&
      (filterManager.size   === 0 || filterManager.has(op.manager))   &&
      (filterItem.size      === 0 || filterItem.has(op.item_type))    &&
      (filterPayMethod.size === 0 || filterPayMethod.has(op.payment_type)) &&
      (filterOpType.size    === 0 || filterOpType.has(op.op_type))
    );
  }, [data, filterCashier, filterManager, filterItem, filterPayMethod, filterOpType]);

  const filteredTotals = useMemo(() => {
    let cash_sale = 0, card_sale = 0, cash_refund = 0, card_refund = 0;
    for (const op of filteredOps) {
      const isCash = op.payment_type === 'cash';
      if (op.op_type === 'sale')   { isCash ? (cash_sale   += op.amount) : (card_sale   += op.amount); }
      if (op.op_type === 'refund') { isCash ? (cash_refund += op.amount) : (card_refund += op.amount); }
    }
    return { cash_sale, card_sale, cash_refund, card_refund };
  }, [filteredOps]);

  const avail = useMemo(() => {
    if (!data) return { cashiers: [], managers: [], items: [], payMethods: [], opTypes: [] };
    return {
      cashiers:   [...new Set(data.ops.map(o => o.cashier).filter(Boolean))].sort(),
      managers:   [...new Set(data.ops.map(o => o.manager).filter(Boolean))].sort(),
      items:      [...new Set(data.ops.map(o => o.item_type).filter(Boolean))].sort(),
      payMethods: [...new Set(data.ops.map(o => o.payment_type).filter(Boolean))].sort(),
      opTypes:    [...new Set(data.ops.map(o => o.op_type).filter(Boolean))].sort(),
    };
  }, [data]);

  function exportXLSX() {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const t = filteredTotals;
    const fmtN = (n: number) => Math.round(n);
    const s1 = [
      ['Период', `${data.from} — ${data.to}`],
      [],
      ['Продажи наличными', fmtN(t.cash_sale)],
      ['Продажи по карте', fmtN(t.card_sale)],
      ['Итого продаж', fmtN(t.cash_sale + t.card_sale)],
      ['Возвраты', fmtN(t.cash_refund + t.card_refund)],
      ['Чистые продажи', fmtN(t.cash_sale + t.card_sale - t.cash_refund - t.card_refund)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s1), 'Итоги');
    const ops = [['Время', 'Тип', 'Клиент', 'Менеджер', 'Кассир', 'Товар', 'Сумма', 'Оплата'],
      ...filteredOps.map(o => [
        new Date(o.pay_ts).toLocaleString('ru', { timeZone: 'Asia/Yekaterinburg' }),
        o.is_refund ? 'Возврат' : 'Продажа',
        o.client, o.manager, o.cashier, o.item_type,
        o.is_refund ? -o.amount : o.amount, o.payment_type,
      ])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ops), 'Операции');
    XLSX.writeFile(wb, `sales-${data.from}-${data.to}.xlsx`);
  }

  const fmt = (n: number) => Math.round(n).toLocaleString('ru');

  function ChipRow({ label, values, active, onToggle }: { label: string; values: string[]; active: Set<string>; onToggle: (v: string) => void }) {
    if (values.length === 0) return null;
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{label}</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {values.map(v => (
            <button key={v} style={{ ...s.chip, ...(active.has(v) ? s.chipActive : {}) }} onClick={() => onToggle(v)}>{v}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={s.section}>
      <div style={s.filterRow}>
        {(['today','week','month'] as const).map(p => (
          <button key={p} style={s.csvBtn} onClick={() => setPreset(p)}>
            {{ today: 'Сегодня', week: 'Неделя', month: 'Месяц' }[p]}
          </button>
        ))}
        <input type="date" style={s.dateInp} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: '#64748b' }}>—</span>
        <input type="date" style={s.dateInp} value={to} onChange={e => setTo(e.target.value)} />
        <button style={s.loadBtn} onClick={load} disabled={loading}>{loading ? '...' : 'Загрузить'}</button>
        <button style={{ ...s.csvBtn, background: '#02BDB6', color: '#fff', border: 'none' }}
          onClick={syncFB} disabled={syncing}>{syncing ? '...' : '↺ Обновить FB'}</button>
        {data && <button style={s.csvBtn} onClick={exportXLSX}>Excel</button>}
      </div>
      {syncMsg && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{syncMsg}</div>}

      {!data && !loading && <div style={s.empty}>Выберите период и нажмите «Загрузить»</div>}
      {loading && <div style={s.empty}>Загрузка…</div>}

      {data && (
        <>
          {/* Filters */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', marginBottom: 16, border: '1px solid #e2e8f0' }}>
            <ChipRow label="Кассир"    values={avail.cashiers}   active={filterCashier}   onToggle={v => toggleFilter(filterCashier,   v, setFilterCashier)} />
            <ChipRow label="Менеджер"  values={avail.managers}   active={filterManager}   onToggle={v => toggleFilter(filterManager,   v, setFilterManager)} />
            <ChipRow label="Товар"     values={avail.items}      active={filterItem}      onToggle={v => toggleFilter(filterItem,      v, setFilterItem)} />
            <ChipRow label="Оплата"    values={avail.payMethods} active={filterPayMethod} onToggle={v => toggleFilter(filterPayMethod, v, setFilterPayMethod)} />
            <ChipRow label="Тип"       values={avail.opTypes}    active={filterOpType}    onToggle={v => toggleFilter(filterOpType,    v, setFilterOpType)} />
            {(filterCashier.size + filterManager.size + filterItem.size + filterPayMethod.size + filterOpType.size) > 0 && (
              <button style={{ ...s.csvBtn, fontSize: 12, padding: '4px 10px', marginTop: 4 }}
                onClick={() => { setFilterCashier(new Set()); setFilterManager(new Set()); setFilterItem(new Set()); setFilterPayMethod(new Set()); setFilterOpType(new Set()); }}>
                Сбросить фильтры
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            {[
              { label: 'Продажи нал.', val: filteredTotals.cash_sale, color: '#02BDB6' },
              { label: 'Продажи карта', val: filteredTotals.card_sale, color: '#263CD9' },
              { label: 'Возвраты', val: -(filteredTotals.cash_refund + filteredTotals.card_refund), color: '#ef4444' },
              { label: 'Итого чисто', val: filteredTotals.cash_sale + filteredTotals.card_sale - filteredTotals.cash_refund - filteredTotals.card_refund, color: '#22c55e' },
              { label: 'Показано операций', val: filteredOps.length, color: '#64748b' },
            ].map(c => (
              <div key={c.label} style={{ background: '#fff', borderRadius: 10, padding: '10px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', minWidth: 130 }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.color }}>{typeof c.val === 'number' && c.label !== 'Показано операций' ? fmt(c.val) + ' ₸' : c.val}</div>
              </div>
            ))}
          </div>

          <div style={s.sectionTitle}>Операции ({filteredOps.length})</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f1f5f9' }}>
                {['Время','Тип','Клиент','Менеджер','Кассир','Товар','Сумма','Оплата'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filteredOps.map(op => (
                  <tr key={op.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '5px 8px' }}>{new Date(op.pay_ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' })}</td>
                    <td style={{ padding: '5px 8px', color: op.is_refund ? '#ef4444' : '#22c55e' }}>{op.is_refund ? 'Возврат' : 'Продажа'}</td>
                    <td style={{ padding: '5px 8px' }}>{op.client || '—'}</td>
                    <td style={{ padding: '5px 8px' }}>{op.manager}</td>
                    <td style={{ padding: '5px 8px' }}>{op.cashier}</td>
                    <td style={{ padding: '5px 8px' }}>{op.item_type}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{op.is_refund ? '-' : ''}{fmt(op.amount)}</td>
                    <td style={{ padding: '5px 8px' }}>{op.payment_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Settings section ──────────────────────────────────────────────────────────

async function safePost(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data: Record<string, unknown> = {};
  try { data = await r.json(); } catch {
    data = { error: r.status === 413 ? 'Файл слишком большой' : `HTTP ${r.status}` };
  }
  return { ok: r.ok, data };
}

interface IbPreview { total: number; new: number; duplicates: number; linked: number; unlinked: number; unlinked_ids: string[] }
interface IbImportResult { added: number; skipped: number; without_client: number }
interface IbTest { id: string; inbody_id: string; tested_at: string; phone: string | null; phone_digits: string | null; gender: string | null; weight: number | null; bfm: number | null; smm: number | null }

function SettingsSection() {
  type ParsedRows = ReturnType<typeof parseLookinBodyCSV>;
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows]         = useState<ParsedRows | null>(null);
  const [preview, setPreview]   = useState<IbPreview | null>(null);
  const [result, setResult]     = useState<IbImportResult | null>(null);
  const [recalc, setRecalc]     = useState<{ updated: number } | null>(null);
  const [unlinked, setUnlinked] = useState<IbTest[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    setLoading(true); setError(''); setPreview(null); setResult(null); setRows(null);
    try {
      const parsed = parseLookinBodyCSV(await file.text());
      if (!parsed.length) { setError('CSV не распарсился — 0 строк.'); setLoading(false); return; }
      setRows(parsed);
      const { ok, data } = await safePost('/kviz/api/inbody/csv-preview', { rows: parsed.map(r => ({ inbody_id: r.inbody_id, tested_at: r.tested_at, phone: r.phone })) });
      if (!ok) { setError(String(data.error || 'Ошибка предпросмотра')); return; }
      setPreview(data as unknown as IbPreview);
    } catch (e2) { setError(String(e2)); }
    finally { setLoading(false); }
  }

  async function doImport() {
    if (!rows) return;
    setLoading(true); setError('');
    try {
      let added = 0, skipped = 0, without_client = 0;
      for (let i = 0; i < rows.length; i += 50) {
        const { ok, data } = await safePost('/kviz/api/inbody/csv-import', { rows: rows.slice(i, i + 50) });
        if (!ok) { setError(String(data.error || 'Ошибка импорта')); return; }
        added         += Number(data.added ?? 0);
        skipped       += Number(data.skipped ?? 0);
        without_client += Number(data.without_client ?? 0);
      }
      setResult({ added, skipped, without_client });
    } catch (e2) { setError(String(e2)); }
    finally { setLoading(false); }
  }

  async function doRecalculate() {
    setLoading(true); setError(''); setRecalc(null);
    try {
      const { ok, data } = await safePost('/kviz/api/inbody/recalculate', {});
      if (!ok) { setError(String(data.error || 'Ошибка пересчёта')); return; }
      setRecalc({ updated: Number(data.updated ?? 0) });
    } catch (e2) { setError(String(e2)); }
    finally { setLoading(false); }
  }

  async function loadUnlinked() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/kviz/api/inbody/unlinked-tests', { credentials: 'include' });
      setUnlinked(r.ok ? await r.json() : []);
    } catch (e2) { setError(String(e2)); }
    finally { setLoading(false); }
  }

  const SS: Record<string, React.CSSProperties> = {
    block:  { background: '#fff', borderRadius: 12, padding: '16px 20px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    title:  { fontWeight: 700, fontSize: 15, marginBottom: 12, color: '#1a202c' },
    btn:    { padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', border: 'none', opacity: loading ? 0.7 : 1, width: '100%', marginBottom: 8 },
    tblKey: { padding: '4px 0', color: '#6b7280', fontSize: 13 },
    tblVal: { padding: '4px 0', fontWeight: 700, fontSize: 13 },
  };

  return (
    <div style={{ ...s.section, maxWidth: 560 }}>
      {error && <div style={{ ...s.errBox, marginBottom: 16 }}>{error}</div>}

      {/* Import CSV */}
      <div style={SS.block}>
        <div style={SS.title}>Импорт InBody CSV</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          Загрузите <b>inbody270_data.csv</b> из LookinBody Web. Файл читается только в браузере.
        </div>
        <button style={{ ...SS.btn, background: '#02BDB6', color: '#fff' }} onClick={() => fileRef.current?.click()} disabled={loading}>
          {loading && !preview && !result ? 'Обработка…' : 'Выбрать файл CSV…'}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />

        {preview && !result && (
          <div style={{ marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Всего строк', preview.total, '#374151'],
                  ['Новых', preview.new, '#16a34a'],
                  ['Дублей', preview.duplicates, '#9ca3af'],
                  ['С клиентом', preview.linked, '#2563eb'],
                  ['Без клиента', preview.unlinked, preview.unlinked > 0 ? '#f59e0b' : '#9ca3af'],
                ].map(([label, val, color]) => (
                  <tr key={String(label)}>
                    <td style={SS.tblKey}>{label}</td>
                    <td style={{ ...SS.tblVal, color: String(color) }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.unlinked_ids.length > 0 && (
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                Без клиента (ID): {preview.unlinked_ids.join(', ')}{preview.unlinked_ids.length === 20 ? ' …' : ''}
              </div>
            )}
            {preview.new > 0 ? (
              <button style={{ ...SS.btn, background: '#263CD9', color: '#fff', marginTop: 12 }} onClick={doImport} disabled={loading}>
                {loading ? 'Импорт…' : `Импортировать ${preview.new} новых`}
              </button>
            ) : (
              <div style={{ marginTop: 10, fontSize: 14, color: '#16a34a' }}>Все строки уже в базе</div>
            )}
          </div>
        )}

        {result && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 16px', marginTop: 12 }}>
            <div style={{ fontWeight: 700, color: '#166534', marginBottom: 8 }}>✓ Импорт завершён</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Добавлено', result.added, '#16a34a'],
                  ['Пропущено', result.skipped, '#9ca3af'],
                  ['Без клиента', result.without_client, result.without_client > 0 ? '#f59e0b' : '#9ca3af'],
                ].map(([l, v, c]) => (
                  <tr key={String(l)}><td style={SS.tblKey}>{l}</td><td style={{ ...SS.tblVal, color: String(c) }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <button style={{ ...SS.btn, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', marginTop: 12 }}
              onClick={() => { setRows(null); setPreview(null); setResult(null); }}>
              Загрузить ещё
            </button>
          </div>
        )}
      </div>

      {/* Recalculate */}
      <div style={SS.block}>
        <div style={SS.title}>Пересчёт InBody</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
          Пересчитывает числовые поля из сохранённого raw CSV для всех тестов.
        </div>
        <button style={{ ...SS.btn, background: '#f8fafc', color: '#374151', border: '1px solid #e2e6ea' }} onClick={doRecalculate} disabled={loading}>
          Пересчитать InBody (исправить CSV)
        </button>
        {recalc && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '8px 14px', fontSize: 14, color: '#166534' }}>
            ✓ Пересчитано тестов: <b>{recalc.updated}</b>
          </div>
        )}
      </div>

      {/* Unlinked tests */}
      <div style={SS.block}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={SS.title}>InBody без клиента</div>
          <button style={{ padding: '6px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={loadUnlinked} disabled={loading}>
            {unlinked === null ? 'Загрузить' : '↺ Обновить'}
          </button>
        </div>
        {unlinked === null && <div style={s.empty}>Нажмите «Загрузить» для просмотра непривязанных тестов</div>}
        {unlinked !== null && unlinked.length === 0 && <div style={s.empty}>Все тесты привязаны к клиентам</div>}
        {unlinked !== null && unlinked.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              Тесты InBody без соответствующего клиента в базе. Привязать можно из карточки клиента.
            </div>
            {unlinked.map(t => (
              <div key={t.id} style={{ padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: '#263CD9' }}>{t.inbody_id}</span>
                <span style={{ color: '#6b7280', marginLeft: 10 }}>{t.tested_at?.slice(0, 10) ?? '—'}</span>
                {t.phone && <span style={{ color: '#64748b', marginLeft: 10 }}>{t.phone}</span>}
                {t.weight != null && <span style={{ color: '#94a3b8', marginLeft: 10 }}>{t.weight} кг</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers for edit modal ────────────────────────────────────────────────────

function MField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 12 }}>{label}</label>
      {children}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const shiftRowSt = (sh: ShiftRecord): React.CSSProperties => ({
  background: sh.ended_at && !sh.sheet_synced_end ? '#fef9f9' : '#fff',
  borderRadius: 10, padding: '10px 12px', marginBottom: 8,
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  borderLeft: `4px solid ${sh.status === 'open' ? '#22c55e' : sh.status === 'auto_closed' ? '#f59e0b' : '#94a3b8'}`,
});

const s: Record<string, React.CSSProperties> = {
  root:         { height: '100vh', overflow: 'auto', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif", display: 'flex', flexDirection: 'column' },
  header:       { padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10, flexShrink: 0 },
  title:        { fontSize: 16, fontWeight: 700 },
  backBtn:      { background: 'none', border: 'none', color: '#263CD9', cursor: 'pointer', fontWeight: 600, fontSize: 14, padding: '4px 0', fontFamily: 'inherit' },
  board:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 12, padding: 16 },
  boardCard:    { background: '#fff', borderRadius: 14, padding: '16px 14px', border: '1.5px solid #e2e8f0', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, textAlign: 'left' as const, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', fontFamily: 'inherit', transition: 'box-shadow .15s,border-color .15s' },
  section:      { padding: '12px 12px 32px' },
  filterRow:    { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  dateInp:      { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  loadBtn:      { padding: '8px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  csvBtn:       { padding: '8px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  chip:         { padding: '3px 10px', border: '1px solid #e2e8f0', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: '#fff', fontFamily: 'inherit', color: '#374151' },
  chipActive:   { background: '#02BDB6', color: '#fff', borderColor: '#02BDB6' },
  empty:        { color: '#94a3b8', fontSize: 13, padding: '12px 0' },
  rowTitle:     { fontSize: 14, fontWeight: 600, color: '#1a202c' },
  rowMeta:      { fontSize: 12, color: '#64748b', marginTop: 2 },
  muted:        { fontWeight: 400, color: '#64748b' },
  warn:         { color: '#ef4444', marginLeft: 6 },
  editBtn:      { padding: '5px 12px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 },
  totalRow:     { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f1f5f9' },
  taskRow:      { background: '#fff', borderRadius: 10, padding: '8px 12px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'flex-start', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  taskDate:     { fontSize: 12, fontWeight: 600, color: '#64748b', width: 60, flexShrink: 0, paddingTop: 2 },
  personChip:   { background: '#e0f2fe', color: '#0369a1', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 600 },
  studioRow:    { background: '#fff', borderRadius: 10, padding: '10px 12px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
  studioField:  { display: 'flex', gap: 6, fontSize: 13, padding: '1px 0' },
  studioKey:    { color: '#64748b', flexShrink: 0 },
  studioVal:    { color: '#1a202c' },
  overlay:      { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal:        { background: '#fff', borderRadius: 16, padding: 24, width: 'min(440px,96vw)', maxHeight: '90vh', overflow: 'auto' },
  mh3:          { fontSize: 16, fontWeight: 700, margin: '0 0 16px' },
  inp:          { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  mBtns:        { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' },
  cancelBtn:    { padding: '8px 16px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn:      { padding: '8px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  errBox:       { background: '#fef2f2', color: '#ef4444', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
};
