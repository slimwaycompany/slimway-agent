import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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

type Section = 'shifts' | 'tasks' | 'studio' | 'sales' | 'renewals' | 'fact-day' | 'day-rhythm' | 'occupancy' | 'measures' | 'inbody';

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

// ── Board definition (columns layout) ────────────────────────────────────────

const REPORT_COLUMNS: { title: string; adminOnly: boolean; items: { id: Section; label: string; desc: string; adminOnly: boolean }[] }[] = [
  {
    title: 'Менеджер', adminOnly: false,
    items: [
      { id: 'tasks',  label: 'Задачи',   desc: 'Выполнение задач по периоду', adminOnly: false },
      { id: 'shifts', label: 'Смены',    desc: 'Отметки, часы, сотрудники',   adminOnly: false },
    ],
  },
  {
    title: 'Продажи', adminOnly: true,
    items: [
      { id: 'sales',    label: 'Отчёт по продажам', desc: 'Операции Fitbase, разбивка', adminOnly: true },
      { id: 'renewals', label: 'Продления',           desc: 'Новые, продления, вернулись', adminOnly: true },
    ],
  },
  {
    title: 'Клиенты', adminOnly: false,
    items: [
      { id: 'measures',  label: 'Отчёт по замерам тела', desc: 'Список замеров, фильтры, Excel', adminOnly: false },
      { id: 'inbody',    label: 'Отчёт по InBody',       desc: 'Клиенты с тестами, динамика',   adminOnly: false },
      { id: 'studio',    label: 'Результаты студии',      desc: 'Счётчики и таблица клиенток',   adminOnly: false },
      { id: 'occupancy', label: 'Занятия и загруженность', desc: 'Сетка день × час, фильтры', adminOnly: true },
    ],
  },
  {
    title: 'Маркетинг', adminOnly: true,
    items: [
      { id: 'fact-day',   label: 'Факт дня',      desc: 'Что произошло в период', adminOnly: true },
      { id: 'day-rhythm', label: 'Дневной такт',  desc: 'Судьба лидов периода',   adminOnly: true },
    ],
  },
];

// flat list for header title lookup
const ALL_SECTIONS = REPORT_COLUMNS.flatMap(c => c.items);

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

  function openSection(sec: Section) {
    setSection(sec);
    try { sessionStorage.setItem('reports-section', sec); } catch {}
  }
  function backToBoard() {
    setSection(null);
    try { sessionStorage.removeItem('reports-section'); } catch {}
  }

  const isAdmin = role === 'admin';

  return (
    <div style={s.root}>
      <div style={s.header}>
        {section ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button style={s.backBtn} onClick={backToBoard}>← Все отчёты</button>
            <span style={s.title}>{ALL_SECTIONS.find(b => b.id === section)?.label}</span>
          </div>
        ) : (
          <span style={s.title}>Отчёты</span>
        )}
      </div>

      {/* Board — column layout */}
      {!section && (
        <div style={s.board}>
          {REPORT_COLUMNS
            .filter(col => !col.adminOnly || isAdmin)
            .map(col => {
              const items = col.items.filter(it => !it.adminOnly || isAdmin);
              if (!items.length) return null;
              return (
                <div key={col.title} style={s.column}>
                  <div style={s.colTitle}>{col.title}</div>
                  {items.map(it => (
                    <button key={it.id} style={s.colItem} onClick={() => openSection(it.id)}>
                      <span style={s.colItemLabel}>{it.label}</span>
                      {it.desc && <span style={s.colItemDesc}>{it.desc}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
        </div>
      )}

      {/* Sections */}
      {section === 'shifts'         && <ShiftsSection />}
      {section === 'tasks'          && <TasksSection isAdmin={isAdmin} />}
      {section === 'measures'       && <MeasuresSection />}
      {section === 'inbody'         && <InBodySection />}
      {section === 'fact-day'       && isAdmin && <FactDaySection />}
      {section === 'day-rhythm'     && isAdmin && <DayRhythmSection />}
      {section === 'sales'          && isAdmin && <SalesSection />}
      {section === 'renewals'       && isAdmin && <RenewalsSection />}
      {section === 'occupancy'      && isAdmin && <OccupancySection />}
      {section === 'studio'         && <StudioSection isAdmin={isAdmin} />}
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

function TasksSection({ isAdmin }: { isAdmin: boolean }) {
  const [from, setFrom]     = useState(monthStart);
  const [to, setTo]         = useState(today);
  const [tasks, setTasks]   = useState<TaskDone[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const mine = !isAdmin || !showAll ? '&mine=1' : '';
      const r = await fetch(`/kviz/api/reports/tasks?from=${from}&to=${to}${mine}`, { credentials: 'include' });
      setTasks(r.ok ? await r.json() : []);
    } catch {} finally { setLoading(false); }
  }, [from, to, isAdmin, showAll]);

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
        {isAdmin && (
          <button style={{ ...s.csvBtn, background: showAll ? '#263CD9' : undefined, color: showAll ? '#fff' : undefined, borderColor: showAll ? '#263CD9' : undefined }}
            onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Все' : 'Мои'}
          </button>
        )}
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

interface StudioRow {
  id: string; client_id: string; cm_lost: number; kg_lost: number;
  fat_kg_lost: number | null; sent_by: string; sent_at: string;
  body_clients: { name: string; phone: string | null };
}

function StudioSection({ isAdmin }: { isAdmin: boolean }) {
  const navigate = useNavigate();
  const [studio, setStudio]       = useState<StudioRow[]>([]);
  const [totals, setTotals]       = useState<{ cm_lost: number; kg_lost: number; fat_kg_lost: number; clients: number } | null>(null);
  const [loading, setLoading]     = useState(false);
  const [tvUrl, setTvUrl]         = useState('');
  const [copied, setCopied]       = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/kviz/api/reports/studio', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch('/kviz/api/results/summary', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      isAdmin
        ? fetch('/kviz/api/results/mission', { credentials: 'include' }).then(r => r.ok ? r.json() : {}).catch(() => ({}))
        : Promise.resolve({}),
    ]).then(([rows, summary, mission]) => {
      setStudio(rows);
      if (summary) setTotals(summary);
      if (mission?.display_url) setTvUrl(window.location.origin + mission.display_url);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [isAdmin]);

  async function copyLink() {
    await navigator.clipboard.writeText(tvUrl);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={s.section}>
      {/* Counters */}
      {totals && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          {[
            { label: 'Сантиметров убрали', val: totals.cm_lost.toFixed(1), unit: 'см', color: '#02BDB6' },
            { label: 'Килограммов сбросили', val: totals.kg_lost.toFixed(1), unit: 'кг', color: '#263CD9' },
            { label: 'Жира сожгли', val: totals.fat_kg_lost.toFixed(1), unit: 'кг жира', color: '#22c55e' },
            { label: 'Клиенток с результатом', val: String(totals.clients), unit: '', color: '#f59e0b' },
          ].map(c => (
            <div key={c.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 18px', flex: '1 1 140px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderTop: `3px solid ${c.color}` }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{c.val} <span style={{ fontSize: 13 }}>{c.unit}</span></div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Admin: TV link + fullscreen */}
      {isAdmin && tvUrl && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <button style={s.csvBtn} onClick={copyLink}>{copied ? '✓ Скопировано' : 'Скопировать ссылку ТВ'}</button>
          <button style={s.loadBtn} onClick={() => setFullscreen(true)}>Открыть на весь экран</button>
        </div>
      )}

      {loading && <div style={s.empty}>Загрузка...</div>}
      {!loading && studio.length === 0 && <div style={s.empty}>Нет данных</div>}

      {studio.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f1f5f9' }}>
              {['Клиент','Телефон','−см','−кг','−жир кг','Отправил','Дата'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {studio.map(row => (
                <tr key={row.id} onClick={() => navigate(`/reports/client/${row.client_id}`, { state: { fromReports: true } })}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}>
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: '#263CD9' }}>{row.body_clients?.name ?? '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#64748b' }}>{row.body_clients?.phone ?? '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#02BDB6', fontWeight: 700 }}>{row.cm_lost > 0 ? `−${row.cm_lost.toFixed(1)}` : '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#263CD9', fontWeight: 700 }}>{row.kg_lost > 0 ? `−${row.kg_lost.toFixed(1)}` : '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#22c55e', fontWeight: 700 }}>{row.fat_kg_lost != null && row.fat_kg_lost > 0 ? `−${row.fat_kg_lost.toFixed(1)}` : '—'}</td>
                  <td style={{ padding: '6px 10px', color: '#64748b' }}>{row.sent_by}</td>
                  <td style={{ padding: '6px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                    {new Date(row.sent_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fullscreen TV overlay */}
      {fullscreen && tvUrl && (
        <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
          <button onClick={() => setFullscreen(false)}
            style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, zIndex: 1 }}>
            ✕ Закрыть
          </button>
          <iframe src={tvUrl.replace(window.location.origin, '')} style={{ flex: 1, border: 'none', width: '100%' }} title="Результаты студии" />
        </div>
      )}
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

// ── Measures section ──────────────────────────────────────────────────────────

interface MeasureRow {
  id: string; client_id: string; measure_no: number; measured_at: string;
  weight: number | null; total_cm: number; consultant: string;
  body_clients: { name: string; phone: string | null };
  studio_result?: { cm_lost: number; kg_lost: number } | null;
  [key: string]: unknown;
}

function MeasuresSection() {
  const navigate = useNavigate();
  const [rows, setRows]         = useState<MeasureRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [from, setFrom]         = useState(monthStart);
  const [to, setTo]             = useState(today);
  const [clientQ, setClientQ]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/kviz/api/measure/measurements?from=${from}&to=${to}`, { credentials: 'include' });
      setRows(r.ok ? await r.json() : []);
    } catch {} finally { setLoading(false); }
  }, [from, to]);

  // Group by client
  const clients = useMemo(() => {
    const map = new Map<string, { clientId: string; name: string; phone: string | null; count: number; lastDate: string; totalCm: number; cmLost?: number }>();
    for (const r of rows) {
      const key = r.client_id;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          clientId: key,
          name: r.body_clients?.name ?? '—',
          phone: r.body_clients?.phone ?? null,
          count: 1,
          lastDate: r.measured_at,
          totalCm: r.total_cm,
          cmLost: r.studio_result?.cm_lost,
        });
      } else {
        existing.count++;
        if (r.measured_at > existing.lastDate) {
          existing.lastDate = r.measured_at;
          existing.totalCm = r.total_cm;
        }
        if (r.studio_result?.cm_lost) existing.cmLost = r.studio_result.cm_lost;
      }
    }
    return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [rows]);

  const filtered = clients.filter(c => {
    if (!clientQ) return true;
    const q = clientQ.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);
  });

  return (
    <div style={s.section}>
      <div style={s.filterRow}>
        <input type="date" style={s.dateInp} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: '#64748b' }}>—</span>
        <input type="date" style={s.dateInp} value={to} onChange={e => setTo(e.target.value)} />
        <button style={s.loadBtn} onClick={load} disabled={loading}>{loading ? '...' : 'Загрузить'}</button>
        {rows.length > 0 && (
          <input style={{ ...s.dateInp, width: 160 }} placeholder="Поиск клиента…" value={clientQ} onChange={e => setClientQ(e.target.value)} />
        )}
      </div>
      {rows.length === 0 && !loading && <div style={s.empty}>Нет данных за период</div>}
      {filtered.map(c => (
        <button key={c.clientId} style={{ ...s.colItem, width: '100%', borderRadius: 10, marginBottom: 6, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          onClick={() => navigate(`/reports/client/${c.clientId}`, { state: { fromReports: true } })}>
          <div style={{ textAlign: 'left' }}>
            <div style={s.rowTitle}>{c.name}</div>
            <div style={s.rowMeta}>{c.phone ?? ''}{c.phone ? ' · ' : ''}{c.count} замер{c.count === 1 ? '' : c.count < 5 ? 'а' : 'ов'} · последний {new Date(c.lastDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
          </div>
          {c.cmLost != null && c.cmLost > 0 && <div style={{ color: '#02BDB6', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>−{c.cmLost.toFixed(1)} см</div>}
        </button>
      ))}
    </div>
  );
}

// ── Client detail panel ────────────────────────────────────────────────────────

interface ClientMeasurement {
  id: string; measure_no: number; measured_at: string;
  weight: number | null; total_cm: number;
  neck?: number | null; chest?: number | null; waist?: number | null; belly?: number | null;
  glutes?: number | null; arm_l?: number | null; arm_r?: number | null;
  thigh_l?: number | null; thigh_r?: number | null;
}
interface ClientResult { cm_lost: number; kg_lost: number; fat_kg_lost: number | null; sent_by: string; sent_at: string }

function ClientDetailPanel({ clientId, name, onClose }: { clientId: string; name: string; onClose: () => void }) {
  const [measurements, setMeasurements] = useState<ClientMeasurement[]>([]);
  const [result, setResult]             = useState<ClientResult | null>(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/kviz/api/measure/measurements?client_id=${clientId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch(`/kviz/api/measure/clients/${clientId}/results`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([ms, res]) => {
      setMeasurements((ms as ClientMeasurement[]).sort((a: ClientMeasurement, b: ClientMeasurement) => a.measured_at.localeCompare(b.measured_at)));
      if (Array.isArray(res) && res.length > 0) setResult(res[0]);
      else if (res && !Array.isArray(res)) setResult(res);
    }).finally(() => setLoading(false));
  }, [clientId]);

  const first = measurements[0];
  const last  = measurements[measurements.length - 1];
  const cmDelta = first && last ? last.total_cm - first.total_cm : null;
  const kgDelta = first?.weight != null && last?.weight != null ? last.weight - first.weight : null;

  return (
    <div style={s.section}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button style={s.backBtn} onClick={onClose}>← Назад</button>
        <span style={s.title}>{name}</span>
      </div>

      {loading && <div style={s.empty}>Загрузка...</div>}

      {!loading && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Measurements table */}
          <div style={{ flex: '2 1 320px', overflowX: 'auto' }}>
            <div style={s.sectionTitle}>Замеры ({measurements.length})</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: '#f1f5f9' }}>
                {['№','Дата','Вес','Сумма см','Талия','Живот','Ягодицы'].map(h => (
                  <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {measurements.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '5px 8px' }}>{m.measure_no}</td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{new Date(m.measured_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                    <td style={{ padding: '5px 8px' }}>{m.weight != null ? `${m.weight} кг` : '—'}</td>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{m.total_cm} см</td>
                    <td style={{ padding: '5px 8px' }}>{m.waist ?? '—'}</td>
                    <td style={{ padding: '5px 8px' }}>{m.belly ?? '—'}</td>
                    <td style={{ padding: '5px 8px' }}>{m.glutes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {cmDelta != null && (
              <div style={{ marginTop: 10, fontSize: 13, color: '#64748b' }}>
                Изменение: <b style={{ color: cmDelta < 0 ? '#02BDB6' : '#f59e0b' }}>{cmDelta < 0 ? `−${Math.abs(cmDelta).toFixed(1)}` : `+${cmDelta.toFixed(1)}`} см</b>
                {kgDelta != null && <>, <b style={{ color: kgDelta < 0 ? '#22c55e' : '#f59e0b' }}>{kgDelta < 0 ? `−${Math.abs(kgDelta).toFixed(1)}` : `+${kgDelta.toFixed(1)}`} кг</b></>}
              </div>
            )}
          </div>

          {/* Result summary */}
          <div style={{ flex: '1 1 200px' }}>
            <div style={s.sectionTitle}>Результат студии</div>
            {result ? (
              <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { label: '−см', val: result.cm_lost > 0 ? `${result.cm_lost.toFixed(1)} см` : '—', color: '#02BDB6' },
                  { label: '−кг', val: result.kg_lost > 0 ? `${result.kg_lost.toFixed(1)} кг` : '—', color: '#263CD9' },
                  { label: '−жир кг', val: result.fat_kg_lost != null && result.fat_kg_lost > 0 ? `${result.fat_kg_lost.toFixed(1)} кг` : '—', color: '#22c55e' },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, color: '#64748b' }}>{label}</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color }}>{val}</span>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  {result.sent_by} · {new Date(result.sent_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                </div>
              </div>
            ) : (
              <div style={s.empty}>Результат ещё не отправлен на ТВ</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── InBody section ────────────────────────────────────────────────────────────

interface IbRow {
  phone_digits: string; client_id: string | null; name: string; phone: string | null;
  count: number; first_date: string; last_date: string;
  weight_delta: number | null; bfm_delta: number | null; smm_delta: number | null;
  score_first: number | null; score_last: number | null;
}

function InBodySection() {
  const navigate = useNavigate();
  const [rows, setRows]     = useState<IbRow[]>([]);
  const [totals, setTotals] = useState<{ tests: number; clients: number; bfm_lost: number; smm_gained: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom]     = useState(monthStart);
  const [to, setTo]         = useState(today);
  const [q, setQ]           = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/kviz/api/reports/inbody?from=${from}&to=${to}`, { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setRows(d.rows ?? []); setTotals(d.totals ?? null); }
    } catch {} finally { setLoading(false); }
  }, [from, to]);

  const filtered = rows.filter(r => {
    if (!q) return true;
    return r.name.toLowerCase().includes(q.toLowerCase()) || (r.phone || '').includes(q);
  });

  function fmtDelta(v: number | null, inverted = false) {
    if (v == null) return '—';
    const good = inverted ? v < 0 : v > 0;
    const color = good ? '#22c55e' : v === 0 ? '#94a3b8' : '#f59e0b';
    return <span style={{ color, fontWeight: 700 }}>{v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)}</span>;
  }

  return (
    <div style={s.section}>
      <div style={s.filterRow}>
        <input type="date" style={s.dateInp} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: '#64748b' }}>—</span>
        <input type="date" style={s.dateInp} value={to} onChange={e => setTo(e.target.value)} />
        <button style={s.loadBtn} onClick={load} disabled={loading}>{loading ? '...' : 'Загрузить'}</button>
        {rows.length > 0 && (
          <input style={{ ...s.dateInp, width: 160 }} placeholder="Поиск…" value={q} onChange={e => setQ(e.target.value)} />
        )}
      </div>

      {totals && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {[
            { label: 'Тестов', val: totals.tests, color: '#64748b' },
            { label: 'Клиентов', val: totals.clients, color: '#263CD9' },
            { label: 'Жира потеряно', val: `${totals.bfm_lost.toFixed(1)} кг`, color: '#22c55e' },
            { label: 'Мышц набрано', val: `${totals.smm_gained.toFixed(1)} кг`, color: '#02BDB6' },
          ].map(c => (
            <div key={c.label} style={{ background: '#fff', borderRadius: 10, padding: '8px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', minWidth: 110 }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>{c.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && !loading && <div style={s.empty}>Нет данных за период</div>}

      {filtered.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#f1f5f9' }}>
              {['Клиент','Тестов','1й тест','Посл.','Δ вес','Δ жир','Δ мышцы','Балл'].map(h => (
                <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.phone_digits} onClick={() => r.client_id && navigate(`/reports/client/${r.client_id}`, { state: { fromReports: true } })}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: r.client_id ? 'pointer' : 'default' }}>
                  <td style={{ padding: '5px 8px' }}>
                    <div style={{ fontWeight: 600, color: r.client_id ? '#263CD9' : '#1a202c' }}>{r.name}</div>
                    {r.phone && <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.phone}</div>}
                    {!r.client_id && <div style={{ fontSize: 10, color: '#f59e0b' }}>не найден в базе</div>}
                  </td>
                  <td style={{ padding: '5px 8px', fontWeight: 700 }}>{r.count}</td>
                  <td style={{ padding: '5px 8px', color: '#64748b', whiteSpace: 'nowrap' }}>{r.first_date}</td>
                  <td style={{ padding: '5px 8px', color: '#64748b', whiteSpace: 'nowrap' }}>{r.last_date}</td>
                  <td style={{ padding: '5px 8px' }}>{fmtDelta(r.weight_delta, true)}</td>
                  <td style={{ padding: '5px 8px' }}>{fmtDelta(r.bfm_delta, true)}</td>
                  <td style={{ padding: '5px 8px' }}>{fmtDelta(r.smm_delta, false)}</td>
                  <td style={{ padding: '5px 8px' }}>
                    {r.score_first != null && r.score_last != null
                      ? <span>{r.score_first} → <b style={{ color: r.score_last > r.score_first ? '#22c55e' : '#f59e0b' }}>{r.score_last}</b></span>
                      : r.score_last ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Mission section ───────────────────────────────────────────────────────────

function MissionSection() {
  const [mission, setMission]   = useState('');
  const [tvUrl, setTvUrl]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    fetch('/kviz/api/results/mission', { credentials: 'include' })
      .then(r => r.ok ? r.json() : {})
      .then(d => { setMission(d.mission ?? ''); if (d.display_url) setTvUrl(window.location.origin + d.display_url); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const r = await fetch('/kviz/api/results/mission', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Ошибка'); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(tvUrl);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ ...s.section, maxWidth: 480 }}>
      {loading && <div style={s.empty}>Загрузка...</div>}
      {!loading && (
        <>
          <div style={s.sectionTitle}>Миссия студии</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>
            Текст отображается на экране с результатами.
          </div>
          {error && <div style={s.errBox}>{error}</div>}
          <textarea
            style={{ ...s.inp, height: 120, resize: 'vertical', marginBottom: 12 }}
            value={mission}
            maxLength={500}
            onChange={e => setMission(e.target.value)}
            placeholder="Текст миссии студии (до 500 символов)"
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button style={s.saveBtn} onClick={save} disabled={saving}>
              {saving ? '...' : saved ? '✓ Сохранено' : 'Сохранить'}
            </button>
            {tvUrl && (
              <button style={s.csvBtn} onClick={copyLink}>
                {copied ? '✓ Скопировано' : 'Скопировать ссылку ТВ'}
              </button>
            )}
          </div>
          {tvUrl && (
            <div style={{ fontSize: 12, color: '#94a3b8', wordBreak: 'break-all' }}>
              Ссылка для ТВ: {tvUrl}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Helpers for edit modal ────────────────────────────────────────────────────

// ── Funnel sections (Факт дня / Дневной такт) ─────────────────────────────────

const todayStr = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const weekAgoStr = new Date(Date.now() + 5 * 3600_000 - 7 * 86400_000).toISOString().slice(0, 10);
const monthAgoStr = new Date(Date.now() + 5 * 3600_000 - 30 * 86400_000).toISOString().slice(0, 10);

interface DrillItem { name?: string | null; source?: string | null; manager?: string | null; date?: string | null; amount?: number | null; resource?: string | null; item?: string | null }
interface AliveItem { name: string|null; funnel: string|null; stage: string|null; manager: string|null }
interface FunnelStep { count: number; pct?: number; amount?: number; net_amount?: number; refund_count?: number; refund_amount?: number; test_count?: number; test_amount?: number; trial_sold_count?: number; alive_count?: number; alive_items?: AliveItem[]; items: DrillItem[]; refund_items?: DrillItem[]; test_items?: DrillItem[] }
interface FdTotalNet { amount: number; sales_amount: number; refund_amount: number; test_count: number; test_amount: number }

function DrillModal({ title, items, onClose }: { title: string; items: DrillItem[]; onClose: () => void }) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title} ({items.length})</h3>
          <button style={s.cancelBtn} onClick={onClose}>✕</button>
        </div>
        {items.length === 0 && <div style={s.empty}>Нет данных</div>}
        {items.map((it, i) => (
          <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{it.name ?? '—'}</div>
            <div style={{ color: '#64748b', marginTop: 2 }}>
              {[it.item, it.source, it.resource, it.manager, it.date, it.amount != null ? Math.round(it.amount).toLocaleString('ru') + ' ₸' : null].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesDrillModal({ title, step, onClose }: { title: string; step: FunnelStep; onClose: () => void }) {
  const [tab, setTab] = useState<0|1|2>(0);
  const fmt = (n: number) => Math.round(n).toLocaleString('ru');
  const cols = [
    { label: 'Покупки', items: step.items, count: step.count, amount: step.amount ?? 0, color: '#263CD9' },
    { label: 'Чистые возвраты', items: step.refund_items ?? [], count: step.refund_count ?? 0, amount: step.refund_amount ?? 0, color: '#ef4444' },
    { label: 'Тест', items: step.test_items ?? [], count: step.test_count ?? 0, amount: step.test_amount ?? 0, color: '#f59e0b' },
  ];
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 480;
  const items = cols[tab].items;
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, maxHeight: '85vh', overflow: 'auto', minWidth: 320 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
          <button style={s.cancelBtn} onClick={onClose}>✕</button>
        </div>
        {isNarrow ? (
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {cols.map((c, i) => (
              <button key={i} onClick={() => setTab(i as 0|1|2)}
                style={{ ...s.chip, ...(tab === i ? s.chipActive : {}), flex: 1, fontSize: 11 }}>
                {c.label} ({c.count})
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            {cols.map((c, i) => (
              <div key={i} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', borderTop: `3px solid ${c.color}` }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: c.color }}>{c.count}</div>
                <div style={{ fontSize: 11, color: '#374151' }}>{fmt(c.amount)} ₸</div>
              </div>
            ))}
          </div>
        )}
        {!isNarrow && (
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 10, padding: '6px 10px', background: '#f0fdf4', borderRadius: 6 }}>
            Итог: {fmt(step.amount ?? 0)} − {fmt(step.refund_amount ?? 0)} = <b>{fmt((step.amount ?? 0) - (step.refund_amount ?? 0))} ₸</b>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          {cols.map((c, i) => (
            <button key={i} onClick={() => setTab(i as 0|1|2)}
              style={{ ...s.chip, ...(tab === i ? s.chipActive : {}), fontSize: 11 }}>
              {c.label} ({c.count})
            </button>
          ))}
        </div>
        {items.length === 0 && <div style={s.empty}>Нет данных</div>}
        {items.map((it, i) => (
          <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{it.name ?? '—'}</div>
            <div style={{ color: '#64748b', marginTop: 1 }}>
              {[it.item, it.date, it.amount != null ? fmt(it.amount) + ' ₸' : null].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelView({ steps }: { steps: Array<{ label: string; step: FunnelStep }> }) {
  const [drill, setDrill] = useState<{ label: string; items: DrillItem[] } | null>(null);
  const fmt = (n: number) => Math.round(n).toLocaleString('ru');
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        {steps.map(({ label, step }, i) => {
          const pct = step.pct != null ? step.pct : (i === 0 ? 100 : steps[i - 1].step.count > 0 ? Math.round(100 * step.count / steps[i - 1].step.count) : 0);
          return (
            <button key={label} onClick={() => setDrill({ label, items: step.items })}
              style={{ flex: '1 1 130px', minWidth: 120, background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{i + 1}. {label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#02BDB6' }}>{step.count}</div>
              {step.amount != null && <div style={{ fontSize: 12, color: '#263CD9', fontWeight: 600 }}>{fmt(step.amount)} ₸</div>}
              {step.trial_sold_count != null && <div style={{ fontSize: 11, color: '#64748b' }}>Продано услуг: {step.trial_sold_count}</div>}
              <div style={{ fontSize: 12, color: i === 0 ? '#94a3b8' : pct >= 50 ? '#22c55e' : pct >= 20 ? '#f59e0b' : '#ef4444' }}>
                {i === 0 ? '100%' : `${pct}% от пред.`}
              </div>
            </button>
          );
        })}
      </div>
      {drill && <DrillModal title={drill.label} items={drill.items} onClose={() => setDrill(null)} />}
    </>
  );
}

function useFunnelFilters(availSources: string[]) {
  const [from, setFrom] = useState(todayStr);
  const [to, setTo]     = useState(todayStr);
  const [sources, setSources] = useState<string[]>([]);
  const [manager, setManager] = useState('');

  const QUICK = [
    { label: 'Все', fn: () => setSources([]) },
    { label: 'TikTok', fn: () => setSources(availSources.filter(s => /tiktok/i.test(s))) },
    { label: 'Instagram', fn: () => setSources(availSources.filter(s => /insta/i.test(s))) },
    { label: 'Блогеры', fn: () => setSources(availSources.filter(s => /блог|blogger|блогер/i.test(s))) },
  ];

  const filterBar = (
    <div style={{ ...s.filterRow, flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
      <button style={{ ...s.chip, ...(from === todayStr && to === todayStr ? s.chipActive : {}) }} onClick={() => { setFrom(todayStr); setTo(todayStr); }}>Сегодня</button>
      <button style={{ ...s.chip, ...(from === weekAgoStr && to === todayStr ? s.chipActive : {}) }} onClick={() => { setFrom(weekAgoStr); setTo(todayStr); }}>Неделя</button>
      <button style={{ ...s.chip, ...(from === monthAgoStr && to === todayStr ? s.chipActive : {}) }} onClick={() => { setFrom(monthAgoStr); setTo(todayStr); }}>Месяц</button>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={s.dateInp} />
      <span style={{ color: '#94a3b8' }}>—</span>
      <input type="date" value={to} onChange={e => setTo(e.target.value)} style={s.dateInp} />
    </div>
  );

  const sourceBar = availSources.length > 0 ? (
    <div style={{ ...s.filterRow, flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
      {QUICK.map(q => (
        <button key={q.label} style={s.csvBtn} onClick={q.fn}>{q.label}</button>
      ))}
      {availSources.map(src => (
        <button key={src} onClick={() => setSources(v => v.includes(src) ? v.filter(x => x !== src) : [...v, src])}
          style={{ ...s.chip, ...(sources.includes(src) ? s.chipActive : {}) }}>
          {src}
        </button>
      ))}
    </div>
  ) : null;

  return { from, to, sources, manager, setManager, filterBar, sourceBar };
}

function useSyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  async function doSync() {
    setSyncing(true); setSyncMsg('Запуск синхронизации…');
    try {
      await fetch('/kviz/api/metrics/sync', { method: 'POST', credentials: 'include' });
      const poll = async () => {
        const r = await fetch('/kviz/api/metrics/sync', { credentials: 'include' });
        const d = await r.json().catch(() => ({}));
        if (d.status === 'done') {
          const base = `Синхронизировано: лидов ${d.leads ?? '?'}, записей ${d.visits ?? '?'}, абонементов ${d.contracts ?? '?'}`;
          setSyncMsg(d.error ? `${base}. Ошибки: ${d.error}` : base);
          setSyncing(false);
        } else if (d.status === 'error') {
          setSyncMsg(d.error || 'Ошибка синхронизации');
          setSyncing(false);
        } else {
          pollRef.current = setTimeout(poll, 2000);
        }
      };
      pollRef.current = setTimeout(poll, 1500);
    } catch (e) { setSyncMsg(String(e)); setSyncing(false); }
  }

  return { syncing, syncMsg, doSync };
}

interface FdSrcRow { source: string; leads: number; in_work: number; alive_count: number; trial_booked: number; visited: number; trial_sold_count: number; sales_count: number; new_count: number; renewal_count: number; sales_amount: number; new_amount: number; renewal_amount: number; refund_amount: number; net_amount: number; lead_to_buy_pct: number }
interface FdMgrRow { manager: string; leads: number; in_work: number; alive_count: number; trial_booked: number; visited: number; trial_sold_count: number; sales_count: number; new_count: number; renewal_count: number; sales_amount: number; new_amount: number; renewal_amount: number; refund_amount: number; net_amount: number; lead_to_buy_pct: number; items?: DrillItem[] }
interface FdCshRow { cashier: string; sales_count: number; sales_amount: number; refund_amount: number; net_amount: number }

const FD_STEP_ORDER = ['leads','in_work','trial_booked','visited','sales','renewals'] as const;
const FD_LABELS: Record<string, string> = {
  leads: 'Лиды', in_work: 'Квал', trial_booked: 'Записи на пробное',
  visited: 'Пришли', sales: 'Новые', renewals: 'Продления',
  same_day: 'Сразу несколько', returned: 'Вернулась', goods: 'Товары/услуги', total_net: 'Итог касса',
};
const CONV_STAGES_FROM = ['leads','in_work','trial_booked','visited'] as const;
const CONV_STAGES_TO   = ['in_work','trial_booked','visited','sales','renewals','total'] as const;
type ConvStageFrom = typeof CONV_STAGES_FROM[number];
type ConvStageTo   = typeof CONV_STAGES_TO[number];
type ConvStage = ConvStageFrom | ConvStageTo;
const CONV_LABELS_FROM: Record<ConvStageFrom, string> = { leads: 'Лиды', in_work: 'Квал', trial_booked: 'Записи', visited: 'Пришли' };
const CONV_LABELS_TO: Record<ConvStageTo, string> = { in_work: 'Квал', trial_booked: 'Записи', visited: 'Пришли', sales: 'Купили (новые)', renewals: 'Продления', total: 'Купили (всего)' };
const CONV_NORMS: Partial<Record<string, [number, number]>> = {
  'in_work→trial_booked': [60, 70],
  'trial_booked→visited': [85, 100],
  'visited→sales': [50, 80],
};

function CrossConvPanel({ data, totalNet }: { data: Record<string, FunnelStep>; totalNet: FdTotalNet | null }) {
  const [from, setFrom] = useState<ConvStageFrom>('trial_booked');
  const [to, setTo]     = useState<ConvStageTo>('visited');
  const fromCount = data[from]?.count ?? 0;
  const toCount   = to === 'total'
    ? new Set([...(data.sales?.items ?? []), ...(data.renewals?.items ?? []), ...(data.returned?.items ?? [])].map(i => i.name)).size
    : to === 'renewals' ? (data.renewals?.count ?? 0) : (data[to]?.count ?? 0);
  const pct  = fromCount > 0 ? Math.round(100 * toCount / fromCount) : 0;
  const norm = CONV_NORMS[`${from}→${to}`];
  const color = norm ? (pct >= norm[0] ? '#22c55e' : '#ef4444') : '#02BDB6';
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Сквозная конверсия</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select value={from} onChange={e => setFrom(e.target.value as ConvStageFrom)} style={{ ...s.dateInp, padding: '5px 8px', fontSize: 12 }}>
          {CONV_STAGES_FROM.map(st => <option key={st} value={st}>{CONV_LABELS_FROM[st]}</option>)}
        </select>
        <span style={{ color: '#94a3b8', fontWeight: 700 }}>→</span>
        <select value={to} onChange={e => setTo(e.target.value as ConvStageTo)} style={{ ...s.dateInp, padding: '5px 8px', fontSize: 12 }}>
          {CONV_STAGES_TO.map(st => <option key={st} value={st}>{CONV_LABELS_TO[st]}</option>)}
        </select>
        <div style={{ fontSize: 28, fontWeight: 800, color, marginLeft: 4 }}>{pct}%</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{toCount} из {fromCount}</div>
        {norm && <div style={{ fontSize: 12, color: color, fontWeight: 600 }}>норма {norm[0]}–{norm[1]}%{pct >= norm[0] ? ' ✓' : ' ↓'}</div>}
      </div>
      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 4, marginTop: 8, position: 'relative' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 4, transition: 'width 0.3s' }} />
        {norm && <div style={{ position: 'absolute', left: `${norm[0]}%`, top: 0, bottom: 0, width: 2, background: '#94a3b8', borderRadius: 1 }} />}
      </div>
      {totalNet && totalNet.test_count > 0 && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Тестов (куп. и сразу вернули): {totalNet.test_count} шт</div>
      )}
    </div>
  );
}

function CollapsibleTable({ title, storageKey, children }: { title: string; storageKey: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== 'collapsed'; } catch { return true; }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? 'open' : 'collapsed'); } catch {}
  };
  return (
    <div style={{ marginTop: 14 }}>
      <button onClick={toggle} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '0 0 6px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#374151', width: '100%', textAlign: 'left' }}>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && children}
    </div>
  );
}

const CHART_TABS = ['Менеджеры', 'Источники', 'Где проседаем', 'Кассиры'] as const;
type ChartTab = typeof CHART_TABS[number];

function ChartsPanel({ byMgr, bySrc, byCsh, data }: { byMgr: FdMgrRow[]; bySrc: FdSrcRow[]; byCsh: FdCshRow[]; data: Record<string, FunnelStep> }) {
  const [tab, setTab] = useState<ChartTab>('Менеджеры');
  const fmtK = (v: number) => v >= 1000 ? Math.round(v / 1000) + 'к' : String(Math.round(v));

  const mgrData = byMgr.slice(0, 8).map(r => ({
    name: r.manager.split(' ').slice(0, 2).join(' '),
    'Новые': r.new_amount,
    'Продления': r.renewal_amount,
  }));
  const srcData = bySrc.slice(0, 8).map(r => ({
    name: r.source.length > 18 ? r.source.slice(0, 18) + '…' : r.source,
    'Лидов': r.leads,
    'Продажи': r.sales_count,
  }));
  const funnelData = FD_STEP_ORDER.map(k => ({ name: FD_LABELS[k] ?? k, count: data[k]?.count ?? 0 }));
  const cshData = byCsh.slice(0, 8).map(r => ({
    name: r.cashier.split(' ')[0] ?? r.cashier,
    'Итог': r.net_amount,
  }));

  const chart = tab === 'Менеджеры' ? (
    <BarChart data={mgrData} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
      <YAxis tickFormatter={fmtK} tick={{ fontSize: 10 }} />
      <Tooltip formatter={(v: number) => Math.round(v).toLocaleString('ru') + ' ₸'} />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="Новые" fill="#263CD9" stackId="a" />
      <Bar dataKey="Продления" fill="#02BDB6" stackId="a" radius={[3,3,0,0]} />
    </BarChart>
  ) : tab === 'Источники' ? (
    <BarChart data={srcData} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
      <YAxis tick={{ fontSize: 10 }} />
      <Tooltip />
      <Bar dataKey="Лидов" fill="#263CD9" />
      <Bar dataKey="Продажи" fill="#02BDB6" radius={[3,3,0,0]} />
    </BarChart>
  ) : tab === 'Где проседаем' ? (
    <BarChart data={funnelData} layout="vertical" margin={{ top: 4, right: 16, left: 60, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
      <XAxis type="number" tick={{ fontSize: 10 }} />
      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={60} />
      <Tooltip />
      <Bar dataKey="count" fill="#02BDB6" radius={[0,3,3,0]} />
    </BarChart>
  ) : (
    <BarChart data={cshData} margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
      <YAxis tickFormatter={fmtK} tick={{ fontSize: 10 }} />
      <Tooltip formatter={(v: number) => Math.round(v).toLocaleString('ru') + ' ₸'} />
      <Bar dataKey="Итог" fill="#02BDB6" radius={[3,3,0,0]} />
    </BarChart>
  );

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {CHART_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...s.chip, ...(t === tab ? s.chipActive : {}), fontSize: 11, padding: '3px 8px' }}>
            {t}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>{chart}</ResponsiveContainer>
    </div>
  );
}

function FactDayCards({ data, totalNet }: { data: Record<string, FunnelStep>; totalNet: FdTotalNet | null }) {
  const [salesDrill, setSalesDrill] = useState<{ label: string; step: FunnelStep } | null>(null);
  const [aliveDrill, setAliveDrill] = useState<AliveItem[] | null>(null);
  const fmt = (n: number) => Math.round(n).toLocaleString('ru');

  const funnelSteps: Array<{ key: string; label: string }> = [
    { key: 'leads', label: 'Лиды' },
    { key: 'in_work', label: 'Квал' },
    { key: 'trial_booked', label: 'Записи' },
    { key: 'visited', label: 'Пришли' },
  ];
  const moneySteps: Array<{ key: string; label: string; color: string }> = [
    { key: 'sales', label: 'Новые', color: '#263CD9' },
    { key: 'renewals', label: 'Продления', color: '#02BDB6' },
    { key: 'goods', label: 'Товары/услуги', color: '#f59e0b' },
    { key: 'total_net', label: 'Итог касса', color: '#22c55e' },
  ];

  const totalSalesAmt = totalNet?.sales_amount ?? 0;
  const totalNetAmt   = totalNet?.amount ?? 0;
  const refundAmt     = totalNet?.refund_amount ?? 0;

  function moneyPct(amount: number) {
    return totalSalesAmt > 0 ? Math.round(100 * amount / totalSalesAmt) : 0;
  }

  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Воронка</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {funnelSteps.map(({ key, label }, i) => {
            const step = data[key];
            if (!step) return null;
            const prev = i > 0 ? data[funnelSteps[i-1].key]?.count ?? 0 : 0;
            const pct = i === 0 ? 100 : prev > 0 ? Math.round(100 * step.count / prev) : 0;
            return (
              <button key={key} onClick={() => {}}
                style={{ flex: '1 1 100px', minWidth: 90, background: '#fff', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '10px 12px', cursor: 'default', textAlign: 'left', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#02BDB6' }}>{step.count}</div>
                {step.trial_sold_count != null && <div style={{ fontSize: 10, color: '#64748b' }}>услуг: {step.trial_sold_count}</div>}
                <div style={{ fontSize: 11, color: i === 0 ? '#94a3b8' : pct >= 50 ? '#22c55e' : pct >= 20 ? '#f59e0b' : '#ef4444' }}>
                  {i === 0 ? '100%' : `${pct}% от пред.`}
                </div>
                {key === 'in_work' && step.alive_count != null && (
                  <button onClick={e => { e.stopPropagation(); setAliveDrill(step.alive_items ?? []); }}
                    style={{ fontSize: 10, color: '#02BDB6', marginTop: 3, cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}>
                    Живые: {step.alive_count}
                  </button>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {aliveDrill && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setAliveDrill(null)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, maxWidth: 640, width: '90%', maxHeight: '80vh', overflow: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>Живые лиды — {aliveDrill.length} шт</div>
              <button onClick={() => setAliveDrill(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
            </div>
            <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr style={{ background: '#f1f5f9' }}>
                {['Клиент','Воронка','Этап','Менеджер'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {aliveDrill.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '3px 8px', fontWeight: 600 }}>{l.name ?? '—'}</td>
                    <td style={{ padding: '3px 8px' }}>{l.funnel ?? '—'}</td>
                    <td style={{ padding: '3px 8px' }}>{l.stage ?? '—'}</td>
                    <td style={{ padding: '3px 8px' }}>{l.manager ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Деньги</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {moneySteps.map(({ key, label, color }) => {
            if (key === 'total_net') {
              return (
                <div key={key} style={{ flex: '1 1 130px', minWidth: 120, background: '#fff', border: `1.5px solid ${color}30`, borderRadius: 12, padding: '10px 12px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderTop: `3px solid ${color}` }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>Итог касса</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color }}>{fmt(totalNetAmt)} ₸</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>продажи {fmt(totalSalesAmt)} ₸</div>
                  {refundAmt > 0 && (
                    <div style={{ fontSize: 10, color: '#ef4444', marginTop: 1 }}>
                      возвраты −{fmt(refundAmt)} ₸{(totalNet?.test_count ?? 0) > 0 ? ` (тест ${totalNet!.test_count})` : ''}
                    </div>
                  )}
                </div>
              );
            }
            const step = data[key];
            if (!step) return null;
            const hasDrill = key === 'sales' || key === 'renewals';
            let amt = step.amount ?? 0;
            let subNote: React.ReactNode = null;
            if (key === 'renewals') {
              const ret = data['returned'];
              if (ret && ret.count > 0) {
                amt += (ret.amount ?? 0);
                subNote = <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>из них вернулись: {ret.count} / {fmt(ret.amount ?? 0)} ₸</div>;
              }
            }
            const pct = moneyPct(amt);
            return (
              <button key={key} onClick={hasDrill ? () => setSalesDrill({ label, step }) : undefined}
                style={{ flex: '1 1 130px', minWidth: 120, background: '#fff', border: `1.5px solid ${color}30`, borderRadius: 12, padding: '10px 12px', cursor: hasDrill ? 'pointer' : 'default', textAlign: 'left', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', borderTop: `3px solid ${color}` }}>
                <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{step.count} шт</div>
                <div style={{ fontSize: 12, color, fontWeight: 600 }}>{fmt(amt)} ₸</div>
                {pct > 0 && <div style={{ fontSize: 10, color: '#94a3b8' }}>{pct}% выручки</div>}
                {subNote}
              </button>
            );
          })}
        </div>
      </div>

      {salesDrill && <SalesDrillModal title={salesDrill.label} step={salesDrill.step} onClose={() => setSalesDrill(null)} />}
    </>
  );
}

function FactDaySection() {
  const [data, setData]             = useState<Record<string, FunnelStep> | null>(null);
  const [totalNet, setTotalNet]     = useState<FdTotalNet | null>(null);
  const [bySrc, setBySrc]           = useState<FdSrcRow[]>([]);
  const [byMgr, setByMgr]           = useState<FdMgrRow[]>([]);
  const [byCsh, setByCsh]           = useState<FdCshRow[]>([]);
  const [availSources, setAvailSrc] = useState<string[]>([]);
  const [availMgr, setAvailMgr]     = useState<string[]>([]);
  const [availCsh, setAvailCsh]     = useState<string[]>([]);
  const [cashier, setCashier]       = useState('');
  const [loading, setLoading]       = useState(false);
  const [mgrDrill, setMgrDrill]     = useState<{ label: string; items: DrillItem[] } | null>(null);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const { syncing, syncMsg, doSync } = useSyncButton();
  const { from, to, sources, manager, setManager, filterBar, sourceBar } = useFunnelFilters(availSources);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ from, to });
      sources.forEach(src => sp.append('sources', src));
      if (manager) sp.set('manager', manager);
      if (cashier) sp.set('cashier', cashier);
      const r = await fetch(`/kviz/api/metrics/fact-day?${sp}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setData(d.steps);
      setTotalNet(d.steps?.total_net ?? null);
      setBySrc(d.by_source ?? []);
      setByMgr(d.by_manager ?? []);
      setByCsh(d.by_cashier ?? []);
      setAvailSrc(d.availableSources ?? []);
      setAvailMgr(d.availableManagers ?? []);
      setAvailCsh(d.availableCashiers ?? []);
    } catch {} finally { setLoading(false); }
  }, [from, to, sources, manager, cashier]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n: number) => Math.round(n).toLocaleString('ru');
  const TH: React.CSSProperties = { padding: '4px 8px', textAlign: 'right', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12 };
  const THL: React.CSSProperties = { ...TH, textAlign: 'left' };
  const TD: React.CSSProperties = { padding: '3px 8px', fontSize: 12, textAlign: 'right' };
  const TDL: React.CSSProperties = { ...TD, textAlign: 'left' };
  const rowBg = (i: number): React.CSSProperties => ({ background: i % 2 === 1 ? '#f8fafc' : '' });

  function toggleAllCollapsed() {
    const next = !allCollapsed;
    setAllCollapsed(next);
    ['fd-src','fd-mgr','fd-csh'].forEach(k => { try { localStorage.setItem(k, next ? 'collapsed' : 'open'); } catch {} });
  }

  return (
    <div style={s.section}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={s.csvBtn} onClick={doSync} disabled={syncing}>{syncing ? 'Запуск…' : '↺ Обновить Fitbase'}</button>
        {syncMsg && <span style={{ fontSize: 12, color: '#6b7280' }}>{syncMsg}</span>}
      </div>
      {filterBar}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={manager} onChange={e => setManager(e.target.value)} style={{ ...s.dateInp, minWidth: 160 }}>
          <option value="">Все менеджеры</option>
          {availMgr.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={cashier} onChange={e => setCashier(e.target.value)} style={{ ...s.dateInp, minWidth: 160 }}>
          <option value="">Все кассиры</option>
          {availCsh.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {sourceBar}

      {data && (
        <>
          <FactDayCards data={data} totalNet={totalNet} />
          <CrossConvPanel data={data} totalNet={totalNet} />

          {/* Two-column layout: tables left, charts right */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 44%', minWidth: 300, maxWidth: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <button style={{ ...s.csvBtn, fontSize: 11, padding: '3px 10px' }} onClick={toggleAllCollapsed}>
                  {allCollapsed ? 'Развернуть всё' : 'Свернуть всё'}
                </button>
              </div>

              {bySrc.length > 0 && (
                <CollapsibleTable title="По источникам" storageKey="fd-src">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ fontSize: 12, borderCollapse: 'collapse', minWidth: 480, width: '100%' }}>
                      <thead><tr style={{ background: '#f1f5f9' }}>
                        <th style={THL}>Источник</th>
                        {['Лидов','Живые','Записи','Пришли','Новые','Продл.','Итог','Л→П%'].map(h => <th key={h} style={TH}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {bySrc.map((r, i) => (
                          <tr key={r.source} style={rowBg(i)}>
                            <td style={TDL}>{r.source}</td>
                            <td style={{ ...TD, fontWeight: 700 }}>{r.leads || '—'}</td>
                            <td style={{ ...TD, color: '#02BDB6' }}>{r.alive_count || '—'}</td>
                            <td style={TD}>{r.trial_booked || '—'}</td>
                            <td style={TD}>{r.visited || '—'}</td>
                            <td style={{ ...TD, color: r.new_amount > 0 ? '#263CD9' : '#94a3b8' }}>{r.new_amount > 0 ? fmt(r.new_amount) : '—'}</td>
                            <td style={{ ...TD, color: r.renewal_amount > 0 ? '#02BDB6' : '#94a3b8' }}>{r.renewal_amount > 0 ? fmt(r.renewal_amount) : '—'}</td>
                            <td style={{ ...TD, fontWeight: 700, color: r.net_amount > 0 ? '#02BDB6' : r.net_amount < 0 ? '#ef4444' : '#94a3b8' }}>{fmt(r.net_amount)}</td>
                            <td style={{ ...TD, color: r.lead_to_buy_pct >= 20 ? '#22c55e' : '#94a3b8' }}>{r.lead_to_buy_pct > 0 ? r.lead_to_buy_pct + '%' : '—'}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc', fontWeight: 700 }}>
                          <td style={TDL}>Итого</td>
                          <td style={TD}>{bySrc.reduce((s, r) => s + r.leads, 0)}</td>
                          <td style={{ ...TD, color: '#02BDB6' }}>{bySrc.reduce((s, r) => s + (r.alive_count ?? 0), 0)}</td>
                          <td style={TD}>{bySrc.reduce((s, r) => s + r.trial_booked, 0)}</td>
                          <td style={TD}>{bySrc.reduce((s, r) => s + r.visited, 0)}</td>
                          <td style={{ ...TD, color: '#263CD9' }}>{fmt(bySrc.reduce((s, r) => s + r.new_amount, 0))}</td>
                          <td style={{ ...TD, color: '#02BDB6' }}>{fmt(bySrc.reduce((s, r) => s + r.renewal_amount, 0))}</td>
                          <td style={{ ...TD, color: '#02BDB6' }}>{fmt(bySrc.reduce((s, r) => s + r.net_amount, 0))}</td>
                          <td style={TD}></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CollapsibleTable>
              )}

              {byMgr.length > 0 && (
                <CollapsibleTable title="По менеджерам" storageKey="fd-mgr">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ fontSize: 12, borderCollapse: 'collapse', minWidth: 480, width: '100%' }}>
                      <thead><tr style={{ background: '#f1f5f9' }}>
                        <th style={THL}>Менеджер</th>
                        {['Лидов','Живые','Записи','Пришли','Новые','Продл.','Итог','Л→П%'].map(h => <th key={h} style={TH}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {byMgr.map((r, i) => (
                          <tr key={r.manager} style={{ ...rowBg(i), cursor: 'pointer' }}
                            onClick={() => setMgrDrill({ label: r.manager, items: r.items ?? [] })}
                            onMouseEnter={e => (e.currentTarget.style.background = '#eff6ff')}
                            onMouseLeave={e => (e.currentTarget.style.background = rowBg(i).background ?? '')}>
                            <td style={{ ...TDL, fontWeight: 600, color: '#263CD9' }}>{r.manager}</td>
                            <td style={{ ...TD, fontWeight: 700 }}>{r.leads || '—'}</td>
                            <td style={{ ...TD, color: '#02BDB6' }}>{r.alive_count || '—'}</td>
                            <td style={TD}>{r.trial_booked || '—'}</td>
                            <td style={TD}>{r.visited || '—'}</td>
                            <td style={{ ...TD, color: r.new_amount > 0 ? '#263CD9' : '#94a3b8' }}>{r.new_amount > 0 ? fmt(r.new_amount) : '—'}</td>
                            <td style={{ ...TD, color: r.renewal_amount > 0 ? '#02BDB6' : '#94a3b8' }}>{r.renewal_amount > 0 ? fmt(r.renewal_amount) : '—'}</td>
                            <td style={{ ...TD, fontWeight: 700, color: r.net_amount > 0 ? '#02BDB6' : r.net_amount < 0 ? '#ef4444' : '#94a3b8' }}>{fmt(r.net_amount)}</td>
                            <td style={{ ...TD, color: r.lead_to_buy_pct >= 20 ? '#22c55e' : '#94a3b8' }}>{r.lead_to_buy_pct > 0 ? r.lead_to_buy_pct + '%' : '—'}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc', fontWeight: 700 }}>
                          <td style={TDL}>Итого</td>
                          <td style={TD}>{byMgr.reduce((s, r) => s + r.leads, 0)}</td>
                          <td style={{ ...TD, color: '#02BDB6' }}>{byMgr.reduce((s, r) => s + (r.alive_count ?? 0), 0)}</td>
                          <td style={TD}>{byMgr.reduce((s, r) => s + r.trial_booked, 0)}</td>
                          <td style={TD}>{byMgr.reduce((s, r) => s + r.visited, 0)}</td>
                          <td style={{ ...TD, color: '#263CD9' }}>{fmt(byMgr.reduce((s, r) => s + r.new_amount, 0))}</td>
                          <td style={{ ...TD, color: '#02BDB6' }}>{fmt(byMgr.reduce((s, r) => s + r.renewal_amount, 0))}</td>
                          <td style={{ ...TD, color: '#02BDB6' }}>{fmt(byMgr.reduce((s, r) => s + r.net_amount, 0))}</td>
                          <td style={TD}></td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Клик по строке — детализация лидов</div>
                  </div>
                </CollapsibleTable>
              )}

              {byCsh.length > 0 && (
                <CollapsibleTable title="По кассирам" storageKey="fd-csh">
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ fontSize: 12, borderCollapse: 'collapse', minWidth: 280, width: '100%' }}>
                      <thead><tr style={{ background: '#f1f5f9' }}>
                        <th style={THL}>Кассир</th>
                        {['Продаж','Продажи','Возвраты','Итог'].map(h => <th key={h} style={TH}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {byCsh.map((r, i) => (
                          <tr key={r.cashier} style={rowBg(i)}>
                            <td style={{ ...TDL, fontWeight: 600 }}>{r.cashier}</td>
                            <td style={TD}>{r.sales_count || '—'}</td>
                            <td style={TD}>{r.sales_amount > 0 ? fmt(r.sales_amount) : '—'}</td>
                            <td style={{ ...TD, color: r.refund_amount > 0 ? '#ef4444' : '#94a3b8' }}>{r.refund_amount > 0 ? fmt(r.refund_amount) : '—'}</td>
                            <td style={{ ...TD, fontWeight: 700, color: r.net_amount > 0 ? '#02BDB6' : r.net_amount < 0 ? '#ef4444' : '#94a3b8' }}>{fmt(r.net_amount)}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc', fontWeight: 700 }}>
                          <td style={TDL}>Итого</td>
                          <td style={TD}>{byCsh.reduce((s, r) => s + r.sales_count, 0)}</td>
                          <td style={TD}>{fmt(byCsh.reduce((s, r) => s + r.sales_amount, 0))}</td>
                          <td style={{ ...TD, color: '#ef4444' }}>{fmt(byCsh.reduce((s, r) => s + r.refund_amount, 0))}</td>
                          <td style={{ ...TD, color: '#02BDB6' }}>{fmt(byCsh.reduce((s, r) => s + r.net_amount, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CollapsibleTable>
              )}
            </div>

            {/* Charts right (55%) */}
            {(byMgr.length > 0 || bySrc.length > 0) && (
              <div style={{ flex: '1 1 300px', minWidth: 260 }}>
                <ChartsPanel byMgr={byMgr} bySrc={bySrc} byCsh={byCsh} data={data} />
              </div>
            )}
          </div>
        </>
      )}
      {!data && loading && <div style={s.empty}>Загрузка…</div>}
      {mgrDrill && <DrillModal title={mgrDrill.label} items={mgrDrill.items} onClose={() => setMgrDrill(null)} />}
    </div>
  );
}

interface DrSrcRow { source: string; leads: number; qualified: number; booked: number; visited: number; bought: number }
interface DrMgrRow { manager: string; leads: number; qualified: number; booked: number; visited: number; bought: number }

function DayRhythmSection() {
  const [steps, setSteps]           = useState<Array<{ id: string; label: string; count: number; pct: number; items: DrillItem[] }> | null>(null);
  const [bySrc, setBySrc]           = useState<DrSrcRow[]>([]);
  const [byMgr, setByMgr]           = useState<DrMgrRow[]>([]);
  const [availSources, setAvailSrc] = useState<string[]>([]);
  const [availMgr, setAvailMgr]     = useState<string[]>([]);
  const [loading, setLoading]       = useState(false);
  const [mgrDrill, setMgrDrill]     = useState<{ label: string; items: DrillItem[] } | null>(null);
  const { syncing, syncMsg, doSync } = useSyncButton();
  const { from, to, sources, manager, setManager, filterBar, sourceBar } = useFunnelFilters(availSources);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ from, to });
      sources.forEach(s => sp.append('sources', s));
      if (manager) sp.set('manager', manager);
      const r = await fetch(`/kviz/api/metrics/day-rhythm?${sp}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setSteps(d.steps ?? []);
      setBySrc(d.by_source ?? []);
      setByMgr(d.by_manager ?? []);
      setAvailSrc(d.availableSources ?? []);
      setAvailMgr(d.availableManagers ?? []);
    } catch {} finally { setLoading(false); }
  }, [from, to, sources, manager]);

  useEffect(() => { load(); }, [load]);

  const TH: React.CSSProperties = { padding: '4px 10px 4px 0', textAlign: 'left', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' };
  const TD: React.CSSProperties = { padding: '3px 10px 3px 0', fontSize: 13 };

  return (
    <div style={s.section}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={s.csvBtn} onClick={doSync} disabled={syncing}>{syncing ? 'Запуск…' : '↺ Обновить Fitbase'}</button>
        {syncMsg && <span style={{ fontSize: 12, color: '#6b7280' }}>{syncMsg}</span>}
      </div>
      {filterBar}
      <div style={{ marginBottom: 10 }}>
        <select value={manager} onChange={e => setManager(e.target.value)} style={{ ...s.dateInp, minWidth: 160 }}>
          <option value="">Все менеджеры</option>
          {availMgr.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {sourceBar}
      {steps && (
        <>
          <FunnelView steps={steps.map(st => ({ label: st.label, step: { count: st.count, pct: st.pct, items: st.items } }))} />
          {bySrc.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={s.sectionTitle}>По источникам</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 460 }}>
                  <thead><tr style={{ background: '#f8fafc' }}>
                    {['Источник','Лидов','Квалиф.','Записи','Пришли','Купили'].map(h => <th key={h} style={TH}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {bySrc.map(r => (
                      <tr key={r.source} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={TD}>{r.source}</td>
                        <td style={{ ...TD, fontWeight: 700 }}>{r.leads}</td>
                        <td style={TD}>{r.qualified}</td>
                        <td style={TD}>{r.booked}</td>
                        <td style={TD}>{r.visited}</td>
                        <td style={{ ...TD, color: r.bought > 0 ? '#22c55e' : '#94a3b8', fontWeight: r.bought > 0 ? 700 : 400 }}>{r.bought}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {byMgr.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={s.sectionTitle}>По менеджерам</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 460 }}>
                  <thead><tr style={{ background: '#f8fafc' }}>
                    {['Менеджер','Лидов','Квалиф.','Записи','Пришли','Купили'].map(h => <th key={h} style={TH}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {byMgr.map(r => (
                      <tr key={r.manager} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                        onClick={() => setMgrDrill({ label: r.manager, items: [] })}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}>
                        <td style={{ ...TD, fontWeight: 600, color: '#263CD9' }}>{r.manager}</td>
                        <td style={TD}>{r.leads}</td>
                        <td style={TD}>{r.qualified}</td>
                        <td style={TD}>{r.booked}</td>
                        <td style={TD}>{r.visited}</td>
                        <td style={{ ...TD, color: r.bought > 0 ? '#22c55e' : '#94a3b8', fontWeight: r.bought > 0 ? 700 : 400 }}>{r.bought}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Клик по строке — список лидов (уточните период)</div>
              </div>
            </div>
          )}
        </>
      )}
      {!steps && loading && <div style={s.empty}>Загрузка…</div>}
      {mgrDrill && <DrillModal title={mgrDrill.label} items={mgrDrill.items} onClose={() => setMgrDrill(null)} />}
    </div>
  );
}

// ── Settings: migrate InBody clients ─────────────────────────────────────────

function MigrateInBodySection() {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ added: number; already: number } | null>(null);
  const [error, setError]     = useState('');

  async function migrate() {
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetch('/kviz/api/measure/migrate-inbody', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Ошибка'); return; }
      setResult(d);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }

  return (
    <div style={{ ...s.section, maxWidth: 480 }}>
      <div style={s.sectionTitle}>Перенести клиентов InBody в отчёт (без дублей)</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
        Для каждого телефона из inbody_tests: если клиент уже есть — пропустить; если нет — создать из кэша Fitbase или по номеру.
      </div>
      {error && <div style={s.errBox}>{error}</div>}
      {result && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14 }}>
          Добавлено: <b>{result.added}</b> · Уже были: <b>{result.already}</b>
        </div>
      )}
      <button style={s.saveBtn} onClick={migrate} disabled={loading}>
        {loading ? 'Переносим…' : 'Перенести клиентов InBody'}
      </button>
    </div>
  );
}

// ── Settings: bulk export results ────────────────────────────────────────────

function BulkResultsSection() {
  const [preview, setPreview]     = useState<{ will_add: number; will_update: number; delta_cm: number; delta_kg: number; delta_fat: number } | null>(null);
  const [result, setResult]       = useState<{ added: number; updated: number } | null>(null);
  const [loading, setLoading]     = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError]         = useState('');

  async function loadPreview() {
    setLoading(true); setError(''); setPreview(null); setResult(null);
    try {
      const r = await fetch('/kviz/api/measure/bulk-results/preview', { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Ошибка'); return; }
      setPreview(d);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }

  async function confirm() {
    setConfirming(true); setError('');
    try {
      const r = await fetch('/kviz/api/measure/bulk-results', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Ошибка'); return; }
      setResult(d); setPreview(null);
    } catch (e) { setError(String(e)); } finally { setConfirming(false); }
  }

  return (
    <div style={{ ...s.section, maxWidth: 520 }}>
      <div style={s.sectionTitle}>Выгрузить все результаты в общий</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
        Пройти по всем клиентам с замерами и/или InBody, посчитать потери и обновить «Результаты студии».
      </div>
      {error && <div style={s.errBox}>{error}</div>}
      {result && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14 }}>
          Добавлено: <b>{result.added}</b> · Обновлено: <b>{result.updated}</b>
        </div>
      )}
      {preview && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Предпросмотр</div>
          <div style={{ fontSize: 13, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            <span>Будет добавлено:</span><b>{preview.will_add}</b>
            <span>Будет обновлено:</span><b>{preview.will_update}</b>
            {preview.delta_cm !== 0 && <><span>Прирост см:</span><b style={{ color: preview.delta_cm > 0 ? '#22c55e' : '#f59e0b' }}>{preview.delta_cm > 0 ? '+' : ''}{preview.delta_cm.toFixed(1)}</b></>}
            {preview.delta_kg !== 0 && <><span>Прирост кг:</span><b style={{ color: preview.delta_kg > 0 ? '#22c55e' : '#f59e0b' }}>{preview.delta_kg > 0 ? '+' : ''}{preview.delta_kg.toFixed(1)}</b></>}
            {preview.delta_fat !== 0 && <><span>Прирост жир кг:</span><b style={{ color: preview.delta_fat > 0 ? '#22c55e' : '#f59e0b' }}>{preview.delta_fat > 0 ? '+' : ''}{preview.delta_fat.toFixed(1)}</b></>}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button style={s.saveBtn} onClick={confirm} disabled={confirming}>
              {confirming ? 'Выгружаем…' : 'Подтвердить выгрузку'}
            </button>
            <button style={s.cancelBtn} onClick={() => setPreview(null)}>Отмена</button>
          </div>
        </div>
      )}
      {!preview && !result && (
        <button style={s.csvBtn} onClick={loadPreview} disabled={loading}>
          {loading ? '…' : 'Предпросмотр'}
        </button>
      )}
    </div>
  );
}

// ── Renewals section ──────────────────────────────────────────────────────────

const RENEWAL_LABELS: Record<string, string> = { new: 'Новая', renewal: 'Продление', returned: 'Вернулась' };

interface RenRow { client_name: string|null; contract_name: string|null; purchase_date: string|null; prev_name: string|null; prev_end: string|null; days_between: number|null; type: string; manager: string|null; cashier: string|null; amount: number }
interface RenCards { new: number; renewal: number; returned: number; new_amt: number; renewal_amt: number; returned_amt: number }
interface RenMgrRow { manager: string; count: number; amount: number; renewal_count: number; renewal_amount: number }

function RenewalsSection() {
  const [from, setFrom]     = useState(monthStart);
  const [to, setTo]         = useState(today);
  const [cards, setCards]   = useState<RenCards | null>(null);
  const [rows, setRows]     = useState<RenRow[]>([]);
  const [byMgr, setByMgr]  = useState<RenMgrRow[]>([]);
  const [availMgr, setAvailMgr] = useState<string[]>([]);
  const [availCsh, setAvailCsh] = useState<string[]>([]);
  const [filterMgr, setFilterMgr]   = useState('');
  const [filterCsh, setFilterCsh]   = useState('');
  const [filterType, setFilterType] = useState('');
  const [loading, setLoading] = useState(false);
  const { syncing, syncMsg, doSync } = useSyncButton();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ from, to });
      if (filterMgr)  sp.set('manager', filterMgr);
      if (filterCsh)  sp.set('cashier', filterCsh);
      if (filterType) sp.set('type', filterType);
      const r = await fetch(`/kviz/api/metrics/renewals?${sp}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setCards(d.cards ?? null);
      setRows(d.rows ?? []);
      setByMgr(d.by_manager ?? []);
      setAvailMgr(d.availableManagers ?? []);
      setAvailCsh(d.availableCashiers ?? []);
    } catch {} finally { setLoading(false); }
  }, [from, to, filterMgr, filterCsh, filterType]);

  useEffect(() => { load(); }, [load]);

  const fmt = (n: number) => Math.round(n).toLocaleString('ru');
  const TH: React.CSSProperties = { padding: '4px 8px 4px 0', textAlign: 'left', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12 };
  const TD: React.CSSProperties = { padding: '3px 8px 3px 0', fontSize: 12 };
  const CARD_COLORS: Record<string, string> = { new: '#263CD9', renewal: '#02BDB6', returned: '#94a3b8' };

  return (
    <div style={s.section}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={s.csvBtn} onClick={doSync} disabled={syncing}>{syncing ? 'Запуск…' : '↺ Обновить Fitbase'}</button>
        {syncMsg && <span style={{ fontSize: 12, color: '#6b7280' }}>{syncMsg}</span>}
      </div>
      <div style={s.filterRow}>
        <input type="date" style={s.dateInp} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={{ color: '#64748b' }}>—</span>
        <input type="date" style={s.dateInp} value={to} onChange={e => setTo(e.target.value)} />
        <button style={s.loadBtn} onClick={load} disabled={loading}>{loading ? '...' : 'Загрузить'}</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={filterMgr} onChange={e => setFilterMgr(e.target.value)} style={{ ...s.dateInp, minWidth: 160 }}>
          <option value="">Все менеджеры</option>
          {availMgr.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterCsh} onChange={e => setFilterCsh(e.target.value)} style={{ ...s.dateInp, minWidth: 160 }}>
          <option value="">Все кассиры</option>
          {availCsh.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...s.dateInp, minWidth: 160 }}>
          <option value="">Все типы</option>
          {Object.entries(RENEWAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {cards && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {(['new', 'renewal', 'returned'] as const).map(k => (
            <div key={k} style={{ background: '#fff', borderRadius: 10, padding: '10px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', minWidth: 120, borderTop: `3px solid ${CARD_COLORS[k]}` }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>{RENEWAL_LABELS[k]}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: CARD_COLORS[k] }}>{(cards as Record<string,number>)[k]}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{fmt((cards as Record<string,number>)[k + '_amt'])} ₸</div>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && !loading && <div style={s.empty}>Нет данных за период</div>}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f1f5f9' }}>
              {['Клиент','Абонемент','Дата','Предыдущий','Оконч.','Дней','Тип','Менеджер','Кассир','Сумма'].map(h => (
                <th key={h} style={TH}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ ...TD, fontWeight: 600 }}>{r.client_name ?? '—'}</td>
                  <td style={{ ...TD, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.contract_name ?? '—'}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>{r.purchase_date ?? '—'}</td>
                  <td style={{ ...TD, color: '#64748b', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.prev_name ?? '—'}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap', color: '#64748b' }}>{r.prev_end ?? '—'}</td>
                  <td style={TD}>{r.days_between ?? '—'}</td>
                  <td style={{ ...TD, color: CARD_COLORS[r.type] ?? '#374151', fontWeight: 600 }}>{RENEWAL_LABELS[r.type] ?? r.type}</td>
                  <td style={TD}>{r.manager ?? '—'}</td>
                  <td style={TD}>{r.cashier ?? '—'}</td>
                  <td style={{ ...TD, fontWeight: 700, color: '#263CD9' }}>{fmt(r.amount)} ₸</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {byMgr.length > 0 && (
        <div>
          <div style={s.sectionTitle}>По менеджерам</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 400 }}>
              <thead><tr style={{ background: '#f8fafc' }}>
                {['Менеджер','Всего','Сумма','Продлений','Сумма продл.','Доля'].map(h => <th key={h} style={TH}>{h}</th>)}
              </tr></thead>
              <tbody>
                {byMgr.map(r => (
                  <tr key={r.manager} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ ...TD, fontWeight: 600, color: '#263CD9' }}>{r.manager}</td>
                    <td style={TD}>{r.count}</td>
                    <td style={TD}>{fmt(r.amount)} ₸</td>
                    <td style={{ ...TD, color: '#02BDB6', fontWeight: 700 }}>{r.renewal_count}</td>
                    <td style={TD}>{fmt(r.renewal_amount)} ₸</td>
                    <td style={TD}>{r.count > 0 ? Math.round(100 * r.renewal_count / r.count) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

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
  board:        { display: 'flex', alignItems: 'flex-start', padding: 0, overflowX: 'auto' },
  column:       { minWidth: 180, flex: '1 0 180px', borderRight: '1px solid #e2e8f0', paddingBottom: 24 },
  colTitle:     { padding: '12px 16px 8px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  colItem:      { display: 'block', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #f1f5f9', textAlign: 'left' as const, padding: '9px 16px', cursor: 'pointer', fontFamily: 'inherit' },
  colItemLabel: { display: 'block', fontSize: 14, fontWeight: 600, color: '#1a202c' },
  colItemDesc:  { display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 2 },
  section:      { padding: '12px 12px 32px' },
  filterRow:    { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 },
  dateInp:      { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  loadBtn:      { padding: '8px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  csvBtn:       { padding: '8px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  chip:         { padding: '3px 10px', border: '1px solid #e2e8f0', borderRadius: 20, fontSize: 12, cursor: 'pointer', background: '#fff', fontFamily: 'inherit', color: '#374151' },
  chipActive:   { background: '#02BDB6', color: '#fff', border: '1px solid #02BDB6' },
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
