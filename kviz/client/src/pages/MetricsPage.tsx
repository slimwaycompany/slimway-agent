import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api';

interface FunnelRow { leads: number; in_work: number; trial_booked: number; visited: number; bought: number }
interface SourceRow extends FunnelRow { source: string }
interface ManagerRow extends FunnelRow { manager: string }
interface FunnelData {
  period: { from: string; to: string };
  funnel: FunnelRow;
  by_source: SourceRow[];
  by_manager: ManagerRow[];
  availableSources: string[];
  availableManagers: string[];
}

const STAGES: { key: keyof FunnelRow; label: string; color: string }[] = [
  { key: 'leads',        label: 'Лиды',               color: '#6366f1' },
  { key: 'in_work',      label: 'В работе',            color: '#0ea5e9' },
  { key: 'trial_booked', label: 'Записались на пробное', color: '#10b981' },
  { key: 'visited',      label: 'Пришли',              color: '#02BDB6' },
  { key: 'bought',       label: 'Купили',              color: '#263CD9' },
];

const SOURCE_SETS: { label: string; values: string[] }[] = [
  { label: 'Все',       values: [] },
  { label: 'TikTok',    values: ['TikTok'] },
  { label: 'Instagram', values: ['Instagram'] },
  { label: 'Блогеры',   values: ['Блогеры'] },
];

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function FunnelBar({ row, total, color }: { row: FunnelRow; total: number; color?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4 }}>
      {STAGES.map(s => {
        const v = row[s.key];
        const barPct = pct(v, total);
        return (
          <div key={s.key} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: color ?? s.color }}>{v}</div>
            <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, margin: '2px 0' }}>
              <div style={{ height: '100%', background: color ?? s.color, borderRadius: 2, width: `${barPct}%` }} />
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>{barPct}%</div>
          </div>
        );
      })}
    </div>
  );
}

export default function MetricsPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const defaultTo = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [sources, setSources] = useState<string[]>([]);
  const [manager, setManager] = useState('');
  const [breakdown, setBreakdown] = useState<'source' | 'manager' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ from, to });
      sources.forEach(s => params.append('sources', s));
      if (manager) params.set('manager', manager);
      const d = await apiGet(`/api/metrics/funnel?${params}`);
      if ((d as { error?: string }).error) throw new Error((d as { error: string }).error);
      setData(d as FunnelData);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [from, to, sources, manager]);

  useEffect(() => { load(); }, [load]);

  async function doSync() {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await fetch('/kviz/api/metrics/sync', { method: 'POST', credentials: 'include' });
      const j = await r.json() as { ok?: boolean; leads?: number; visits?: number; error?: string };
      if (j.ok) {
        const t = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yekaterinburg' });
        setSyncMsg(`Обновлено в ${t} · лидов ${j.leads ?? '?'} · записей ${j.visits ?? '?'}`);
        await load();
      } else {
        setSyncMsg(j.error ?? JSON.stringify(j));
      }
    } catch (e) { setSyncMsg(String(e)); }
    finally { setSyncing(false); }
  }

  const funnelTotal = data?.funnel.leads ?? 0;

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'Inter,system-ui,sans-serif', background: '#f8fafc', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 22, color: '#1a1a2e' }}>Метрики</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {syncMsg && <span style={{ fontSize: 12, color: '#6b7280' }}>{syncMsg}</span>}
            <button onClick={doSync} disabled={syncing}
              style={{ padding: '7px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8,
                fontWeight: 600, fontSize: 13, cursor: syncing ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: syncing ? 0.7 : 1 }}>
              {syncing ? 'Запуск…' : '↺ Обновить Fitbase'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, padding: '14px 16px', marginBottom: 18, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Период</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid #e2e6ea', borderRadius: 6, fontSize: 13 }} />
              <span style={{ color: '#9ca3af' }}>—</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                style={{ padding: '6px 8px', border: '1px solid #e2e6ea', borderRadius: 6, fontSize: 13 }} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Источник</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {SOURCE_SETS.map(ss => {
                const active = ss.values.length === 0
                  ? sources.length === 0
                  : ss.values.every(v => sources.includes(v)) && sources.length === ss.values.length;
                return (
                  <button key={ss.label} onClick={() => setSources(ss.values)}
                    style={{ padding: '5px 12px', borderRadius: 20, border: `1.5px solid ${active ? '#263CD9' : '#e2e6ea'}`,
                      background: active ? '#eef2ff' : '#f8fafc', color: active ? '#263CD9' : '#374151',
                      fontSize: 12, fontWeight: active ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {ss.label}
                  </button>
                );
              })}
            </div>
          </div>

          {data && data.availableManagers.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Менеджер</div>
              <select value={manager} onChange={e => setManager(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e2e6ea', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}>
                <option value="">Все</option>
                {data.availableManagers.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }}>Разбивка</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[{ k: null, l: 'Общая' }, { k: 'source', l: 'По источнику' }, { k: 'manager', l: 'По менеджеру' }].map(({ k, l }) => (
                <button key={String(k)} onClick={() => setBreakdown(k as 'source' | 'manager' | null)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: `1.5px solid ${breakdown === k ? '#02BDB6' : '#e2e6ea'}`,
                    background: breakdown === k ? 'rgba(2,189,182,.08)' : '#f8fafc',
                    color: breakdown === k ? '#02BDB6' : '#374151',
                    fontSize: 12, fontWeight: breakdown === k ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#ef4444', fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Загрузка…</div>
        )}

        {!loading && data && (
          <>
            {/* Summary funnel */}
            <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, padding: '16px 20px', marginBottom: 18 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#374151', marginBottom: 14 }}>
                Воронка · {fmtDate(data.period.from)} — {fmtDate(data.period.to)}
                {sources.length > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af', marginLeft: 8 }}>· {sources.join(', ')}</span>}
              </div>

              {/* Stage header labels */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4, marginBottom: 8 }}>
                {STAGES.map(s => (
                  <div key={s.key} style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', fontWeight: 600 }}>{s.label}</div>
                ))}
              </div>

              {/* Main funnel bars */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4 }}>
                {STAGES.map((s, si) => {
                  const v = data.funnel[s.key];
                  const barH = funnelTotal > 0 ? Math.max(12, (v / funnelTotal) * 120) : 12;
                  const prev = si > 0 ? data.funnel[STAGES[si - 1].key] : null;
                  const conv = prev ? pct(v, prev) : 100;
                  return (
                    <div key={s.key} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{v}</div>
                      <div style={{ height: barH, background: s.color, borderRadius: 6, margin: '4px auto', opacity: 0.85, maxWidth: 80 }} />
                      {si > 0 && <div style={{ fontSize: 10, color: '#9ca3af' }}>↓ {conv}%</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Breakdown table */}
            {breakdown === 'source' && data.by_source.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e6ea', fontWeight: 700, fontSize: 13, color: '#374151' }}>По источнику</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e2e6ea' }}>Источник</th>
                        {STAGES.map(s => <th key={s.key} style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: s.color, borderBottom: '1px solid #e2e6ea', minWidth: 72 }}>{s.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_source.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '7px 12px', fontWeight: 600 }}>{row.source}</td>
                          {STAGES.map(s => (
                            <td key={s.key} style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 600, color: s.color }}>
                              {row[s.key]}
                              {s.key !== 'leads' && row.leads > 0 && (
                                <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400, marginLeft: 3 }}>
                                  {pct(row[s.key], row.leads)}%
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {breakdown === 'manager' && data.by_manager.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, overflow: 'hidden', marginBottom: 18 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e6ea', fontWeight: 700, fontSize: 13, color: '#374151' }}>По менеджеру</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e2e6ea' }}>Менеджер</th>
                        {STAGES.map(s => <th key={s.key} style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: s.color, borderBottom: '1px solid #e2e6ea', minWidth: 72 }}>{s.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_manager.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '7px 12px', fontWeight: 600 }}>{row.manager}</td>
                          {STAGES.map(s => (
                            <td key={s.key} style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 600, color: s.color }}>
                              {row[s.key]}
                              {s.key !== 'leads' && row.leads > 0 && (
                                <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400, marginLeft: 3 }}>
                                  {pct(row[s.key], row.leads)}%
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {data.funnel.leads === 0 && (
              <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, padding: '32px 20px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                Нет лидов за выбранный период.{' '}
                {!data.availableSources.length
                  ? 'Запустите «Обновить Fitbase» для первичной синхронизации.'
                  : 'Попробуйте изменить фильтры.'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
