import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api';
import { MeasureLayout } from './MeasureLayout';

const CONSULTANT_KEY = 'sw_consultant';

const FIELDS = [
  { key: 'weight',      label: 'Вес',           unit: 'кг', min: 30,  max: 250, optional: true },
  { key: 'neck',        label: 'Шея',           unit: 'см', min: 10,  max: 200 },
  { key: 'chest',       label: 'Грудь',         unit: 'см', min: 10,  max: 200 },
  { key: 'arm_l',    label: 'Левая рука',     unit: 'см', min: 10,  max: 200 },
  { key: 'arm_r',    label: 'Правая рука',    unit: 'см', min: 10,  max: 200 },
  { key: 'waist',    label: 'Талия',          unit: 'см', min: 10,  max: 200 },
  { key: 'belly',    label: 'Живот',          unit: 'см', min: 10,  max: 200 },
  { key: 'glutes',   label: 'Ягодицы',        unit: 'см', min: 10,  max: 200 },
  { key: 'thigh_l',  label: 'Левое бедро',    unit: 'см', min: 10,  max: 200 },
  { key: 'thigh_r',  label: 'Правое бедро',   unit: 'см', min: 10,  max: 200 },
  { key: 'shin_l',   label: 'Левая голень',   unit: 'см', min: 10,  max: 200 },
  { key: 'shin_r',   label: 'Правая голень',  unit: 'см', min: 10,  max: 200 },
] as const;

type FieldKey = typeof FIELDS[number]['key'];

interface Client {
  id: string | null;
  fitbase_client_id: number | null;
  name: string;
  phone: string | null;
  source: 'measure' | 'fitbase';
  measure_count: number;
  last_measured: string | null;
}

interface Measurement {
  [key: string]: unknown;
  id: string;
  measure_no: number;
  measured_at: string;
  total_cm: number;
}

interface SavedClient {
  id: string;
  name: string;
  phone: string | null;
  fitbase_client_id: number | null;
  measurements: Measurement[];
}

function todayStr() {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function fmtPhone(p: string | null) {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  if (d.length === 11) return `+7 ${d.slice(1,4)}•••-••-${d.slice(9)}`;
  return p;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase();
}

export default function NewMeasurePage() {
  const navigate = useNavigate();
  const [consultant, setConsultant] = useState(localStorage.getItem(CONSULTANT_KEY) ?? '');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Client[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const [selectedClient, setSelectedClient] = useState<SavedClient | null>(null);
  const [newClientMode, setNewClientMode] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newClientErr, setNewClientErr] = useState('');
  const [values, setValues] = useState<Record<FieldKey, string>>({} as Record<FieldKey, string>);
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [result, setResult] = useState<null | { m: Measurement & { fitbase_error?: string }; client: SavedClient; prev: Measurement | null; start: Measurement | null }>(null);
  const [showInbodyModal, setShowInbodyModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const prevM = selectedClient?.measurements.at(-1) ?? null;
  const startM = selectedClient?.measurements[0] ?? null;

  // Debounced search
  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); setShowDrop(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiGet(`/api/measure/clients?q=${encodeURIComponent(query)}`);
        setSuggestions(data);
        setShowDrop(true);
      } catch { setShowDrop(false); }
    }, 250);
  }, [query]);

  async function selectSuggestion(c: Client) {
    setShowDrop(false);
    setQuery(c.name);
    if (c.id) {
      // existing body_client
      const data = await apiGet(`/api/measure/clients/${c.id}`);
      setSelectedClient(data);
    } else {
      // fitbase-only → create body_client
      try {
        const created = await apiPost('/api/measure/clients', {
          name: c.name, phone: c.phone,
          fitbase_client_id: c.fitbase_client_id,
        });
        const full = await apiGet(`/api/measure/clients/${created.id}`);
        setSelectedClient(full);
      } catch (e: unknown) {
        const err = e as { message?: string };
        setSaveErr(String(err.message || e));
      }
    }
    setNewClientMode(false);
    setValues({} as Record<FieldKey, string>);
  }

  async function createNewClient() {
    setNewClientErr('');
    if (!newName.trim()) { setNewClientErr('Введите имя'); return; }
    if (!newPhone.trim()) { setNewClientErr('Введите телефон'); return; }
    try {
      const created = await apiPost('/api/measure/clients', { name: newName.trim(), phone: newPhone.trim() });
      const full = await apiGet(`/api/measure/clients/${created.id}`);
      setSelectedClient(full);
      setNewClientMode(false);
      setQuery(full.name);
    } catch (e: unknown) {
      const body = e as { existing?: { id: string; name: string } };
      if (body?.existing) {
        setNewClientErr(`Клиент с этим телефоном уже есть: ${body.existing.name}`);
      } else {
        setNewClientErr(String(e));
      }
    }
  }

  function handleValueChange(key: FieldKey, raw: string) {
    setValues(prev => ({ ...prev, [key]: raw.replace(',', '.') }));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const next = FIELDS[idx + 1];
      if (next) fieldRefs.current[next.key]?.focus();
    }
  }

  function circSum(): number | null {
    let s = 0;
    for (const f of FIELDS.slice(1)) {
      const v = parseFloat(values[f.key] || '');
      if (isNaN(v)) return null;
      s += v;
    }
    return Math.round(s * 10) / 10;
  }

  async function save() {
    if (!selectedClient) return;
    if (!consultant) { setSaveErr('Укажите имя консультанта в настройках'); return; }
    setSaving(true); setSaveErr('');
    try {
      const payload: Record<string, unknown> = { client_id: selectedClient.id, consultant, measured_at: date };
      for (const f of FIELDS) payload[f.key] = values[f.key] ?? '';
      const m = await apiPost('/api/measure/measurements', payload);
      if (m.error) { setSaveErr(m.error); return; }
      // Reload client
      const refreshed = await apiGet(`/api/measure/clients/${selectedClient.id}`);
      const sorted = refreshed.measurements as Measurement[];
      const idx = sorted.findIndex((x: Measurement) => x.id === m.id);
      const prev = idx > 0 ? sorted[idx - 1] : null;
      const start = idx > 0 ? sorted[0] : null;
      setResult({ m, client: refreshed, prev, start });
    } catch (e: unknown) {
      setSaveErr(String(e));
    } finally { setSaving(false); }
  }

  function copyResult() {
    if (!result) return;
    const { m, prev, start } = result;
    const total = Number(m.total_cm ?? 0);
    const prevTotal = prev ? Number(prev.total_cm ?? 0) : null;
    const startTotal = start ? Number(start.total_cm ?? 0) : null;
    let text = `📏 Замер №${m.measure_no} — ${result.client.name}\n`;
    text += `Сумма обхватов: ${total.toFixed(1)} см`;
    if (prevTotal !== null) text += ` (${fmtDiff(total - prevTotal)} к прошлому`;
    if (startTotal !== null) text += `, ${fmtDiff(total - startTotal)} со старта`;
    if (prevTotal !== null) text += ')';
    if (m.weight != null) {
      text += `\nВес: ${Number(m.weight).toFixed(1)} кг`;
      if (prev?.weight != null) text += ` (${fmtDiff(Number(m.weight) - Number(prev.weight))} к прошлому)`;
    }
    navigator.clipboard.writeText(text).catch(() => {});
  }

  async function retryFitbase() {
    if (!result) return;
    try {
      await apiPost(`/api/measure/measurements/${result.m.id}/fitbase`, {});
      setResult(r => r ? { ...r, m: { ...r.m, fitbase_error: undefined, fitbase_comment_at: new Date().toISOString() } } : r);
    } catch (e) { alert(String(e)); }
  }

  async function deleteMeasurement(id: string) {
    try {
      await fetch(`/kviz/api/measure/measurements/${id}`, { method: 'DELETE', credentials: 'include' });
      const refreshed = await apiGet(`/api/measure/clients/${selectedClient!.id}`);
      setSelectedClient(refreshed);
      setConfirmDelete(null);
    } catch (e) { alert(String(e)); }
  }

  // ── Result screen ────────────────────────────────────────────────────────
  if (result) {
    const { m, client, prev, start } = result;
    const total = Number(m.total_cm ?? 0);
    const prevTotal = prev ? Number(prev.total_cm ?? 0) : null;
    const startTotal = start ? Number(start.total_cm ?? 0) : null;

    return (
      <MeasureLayout active="new">
        <div style={{ padding: '0 16px 80px', maxWidth: 560, margin: '0 auto' }}>
          <div style={{ background: 'linear-gradient(135deg,#02BDB6,#263CD9)', borderRadius: 16, padding: '20px 24px', color: '#fff', marginBottom: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>Замер №{m.measure_no} сохранён</div>
            <div style={{ opacity: 0.85, marginTop: 4 }}>{client.name} · {fmtDate(m.measured_at)}</div>
            {m.fitbase_error && (
              <div style={{ marginTop: 10, background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '8px 14px', fontSize: 13 }}>
                ⚠ В Fitbase не отправлено
                <button onClick={retryFitbase} style={{ marginLeft: 10, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, color: '#fff', padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>Отправить ещё раз</button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="measure-result-table">
            <table>
              <thead><tr><th>Точка</th><th>Сейчас</th><th>Прошлый</th><th>Δ к пред.</th><th>Старт</th><th>Δ со старта</th></tr></thead>
              <tbody>
                {FIELDS.map(f => {
                  const cur  = m[f.key] != null ? Number(m[f.key]) : null;
                  const prv  = prev?.[f.key] != null ? Number(prev[f.key]) : null;
                  const st   = start?.[f.key] != null ? Number(start[f.key]) : null;
                  if (cur == null) return null;
                  return (
                    <tr key={f.key}>
                      <td>{f.label}</td>
                      <td>{cur.toFixed(1)}</td>
                      <td>{prv?.toFixed(1) ?? '—'}</td>
                      <td style={{ color: prv != null ? (cur - prv < 0 ? '#16a34a' : cur - prv > 0 ? '#f59e0b' : '#6b7280') : '#6b7280', fontWeight: 600 }}>
                        {prv != null ? fmtDiff(cur - prv) : '—'}
                      </td>
                      <td>{st?.toFixed(1) ?? '—'}</td>
                      <td style={{ color: st != null ? (cur - st < 0 ? '#16a34a' : cur - st > 0 ? '#f59e0b' : '#6b7280') : '#6b7280', fontWeight: 600 }}>
                        {st != null ? fmtDiff(cur - st) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '14px 18px', margin: '16px 0', fontSize: 14 }}>
            <strong>Итого обхватов: {total.toFixed(1)} см</strong>
            {prevTotal !== null && <span style={{ color: total - prevTotal < 0 ? '#16a34a' : '#f59e0b', marginLeft: 8 }}>{fmtDiff(total - prevTotal)} к прошлому</span>}
            {startTotal !== null && <span style={{ color: total - startTotal < 0 ? '#16a34a' : '#f59e0b', marginLeft: 8 }}>{fmtDiff(total - startTotal)} со старта</span>}
            {m.weight != null && (
              <div style={{ marginTop: 6 }}>
                <strong>Вес: {Number(m.weight).toFixed(1)} кг</strong>
                {prev?.weight != null && <span style={{ color: Number(m.weight) - Number(prev.weight) < 0 ? '#16a34a' : '#f59e0b', marginLeft: 8 }}>{fmtDiff(Number(m.weight) - Number(prev.weight))} к прошлому</span>}
                {start?.weight != null && <span style={{ color: Number(m.weight) - Number(start.weight) < 0 ? '#16a34a' : '#f59e0b', marginLeft: 8 }}>{fmtDiff(Number(m.weight) - Number(start.weight))} со старта</span>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={copyResult}>📋 Скопировать итог</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { setResult(null); setSelectedClient(null); setQuery(''); setValues({} as Record<FieldKey, string>); }}>
              + Новый замер
            </button>
            <button className="btn btn-secondary" onClick={() => navigate(`/measure/client/${client.id}`)}>
              Открыть клиента
            </button>
          </div>
        </div>
      </MeasureLayout>
    );
  }

  const canSave = selectedClient && FIELDS.slice(1).every(f => {
    const v = parseFloat(values[f.key] || '');
    return !isNaN(v) && v >= f.min && v <= f.max;
  });
  const sum = circSum();

  return (
    <MeasureLayout active="new">
      <div style={{ padding: '0 16px 80px', maxWidth: 560, margin: '0 auto' }}>

        {/* Consultant */}
        <div className="consultant-bar" style={{ marginBottom: 16 }}>
          <span>Консультант: </span>
          <input
            value={consultant}
            onChange={e => { setConsultant(e.target.value); localStorage.setItem(CONSULTANT_KEY, e.target.value); }}
            placeholder="Ваше имя"
            style={{ flex: 1, padding: '5px 10px', border: '1px solid #e2e6ea', borderRadius: 6, fontSize: 14 }}
          />
        </div>

        {/* Client search */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <label style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, display: 'block', marginBottom: 6 }}>Клиент</label>
          <input
            className="field input"
            style={{ width: '100%', padding: '12px 14px', border: '2px solid #e2e6ea', borderRadius: 8, fontSize: 15 }}
            placeholder="Имя или телефон"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedClient(null); setNewClientMode(false); }}
            onFocus={() => suggestions.length > 0 && setShowDrop(true)}
          />
          {showDrop && suggestions.length > 0 && (
            <div className="measure-dropdown">
              {suggestions.map((c, i) => (
                <div key={i} className="measure-dropdown-item" onClick={() => selectSuggestion(c)}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  {c.phone && <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 13 }}>{fmtPhone(c.phone)}</span>}
                  <span className={`measure-source-badge ${c.source}`}>{c.source === 'measure' ? 'Замеры' : 'Fitbase'}</span>
                  {c.measure_count > 0 && <span style={{ marginLeft: 8, fontSize: 12, color: '#9ca3af' }}>замеров: {c.measure_count} · посл. {c.last_measured ? fmtDate(c.last_measured) : '—'}</span>}
                </div>
              ))}
              <div className="measure-dropdown-item measure-new-client" onClick={() => { setShowDrop(false); setNewClientMode(true); setNewName(query); }}>
                + Новый клиент
              </div>
            </div>
          )}
          {query.length >= 2 && suggestions.length === 0 && !showDrop && (
            <button className="btn btn-secondary" style={{ marginTop: 8, fontSize: 13, padding: '7px 14px' }}
              onClick={() => { setNewClientMode(true); setNewName(query); }}>
              + Новый клиент
            </button>
          )}
        </div>

        {/* New client form */}
        {newClientMode && !selectedClient && (
          <div style={{ background: '#f9fafb', border: '1px solid #e2e6ea', borderRadius: 12, padding: '16px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Новый клиент</div>
            <div className="field"><label>Имя *</label><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Имя клиента" /></div>
            <div className="field"><label>Телефон *</label><input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="+7..." inputMode="tel" /></div>
            {newClientErr && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{newClientErr}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={createNewClient}>Создать</button>
              <button className="btn btn-secondary" onClick={() => setNewClientMode(false)}>Отмена</button>
            </div>
          </div>
        )}

        {/* Client card */}
        {selectedClient && (
          <div style={{ background: 'rgba(2,189,182,0.06)', border: '1px solid rgba(2,189,182,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedClient.name}</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {selectedClient.phone && <span>{fmtPhone(selectedClient.phone)}</span>}
              <span>ID: {shortId(selectedClient.id)}</span>
              <span>Замеров: {selectedClient.measurements.length}</span>
              {selectedClient.measurements.length > 0 && (
                <span>Посл.: {fmtDate(selectedClient.measurements.at(-1)!.measured_at)} · {Number(selectedClient.measurements.at(-1)!.total_cm).toFixed(1)} см</span>
              )}
            </div>
          </div>
        )}

        {/* Measurement form */}
        {selectedClient && (
          <>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Дата замера</label>
              <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
              {FIELDS.map((f, idx) => {
                const v = values[f.key] ?? '';
                const num = parseFloat(v);
                const prevVal = prevM ? Number(prevM[f.key as keyof Measurement] ?? null) : null;
                const diff = !isNaN(num) && prevVal != null ? num - prevVal : null;
                return (
                  <div key={f.key} className="measure-field-row">
                    <label className="measure-field-label">{f.label}{f.optional ? '' : ' *'}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        ref={el => { fieldRefs.current[f.key] = el; }}
                        inputMode="decimal"
                        value={v}
                        onChange={e => handleValueChange(f.key, e.target.value)}
                        onKeyDown={e => handleKeyDown(e, idx)}
                        placeholder={f.optional ? 'необяз.' : ''}
                        style={{ width: 90, padding: '10px 10px', border: '2px solid #e2e6ea', borderRadius: 8, fontSize: 16, textAlign: 'right',
                          borderColor: v && (isNaN(num) || num < f.min || num > f.max) ? '#dc2626' : '#e2e6ea' }}
                      />
                      <span style={{ color: '#9ca3af', fontSize: 13, minWidth: 22 }}>{f.unit}</span>
                      <span style={{ fontSize: 12, color: '#9ca3af', minWidth: 50 }}>
                        {prevVal != null ? prevVal.toFixed(1) : '—'}
                      </span>
                      {diff !== null && (
                        <span style={{ fontSize: 13, fontWeight: 600, minWidth: 48, color: diff < 0 ? '#16a34a' : diff > 0 ? '#f59e0b' : '#9ca3af' }}>
                          {diff >= 0 ? '+' : '−'}{Math.abs(diff).toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live total */}
            {sum !== null && (
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '12px 16px', margin: '16px 0', fontSize: 14 }}>
                <strong>Сумма обхватов: {sum.toFixed(1)} см</strong>
                {prevM && (
                  <span style={{ marginLeft: 10, color: sum - Number(prevM.total_cm) < 0 ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>
                    {fmtDiff(sum - Number(prevM.total_cm))} к прошлому
                  </span>
                )}
                {selectedClient.measurements.length > 1 && startM && (
                  <span style={{ marginLeft: 8, color: sum - Number(startM.total_cm) < 0 ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>
                    {fmtDiff(sum - Number(startM.total_cm))} со старта
                  </span>
                )}
              </div>
            )}

            {saveErr && <div className="alert alert-stop">{saveErr}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowInbodyModal(true)}>📷 Сканировать лист InBody</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={!canSave || saving} onClick={save}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>

            {/* Previous measurements */}
            {selectedClient.measurements.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div className="section-title">История замеров</div>
                {[...selectedClient.measurements].reverse().map(m => {
                  const canEdit = isToday(m.created_at as string);
                  return (
                    <div key={m.id} style={{ background: '#fff', borderRadius: 10, padding: '10px 14px', marginBottom: 8, border: '1px solid #e2e6ea', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>№{m.measure_no}</span>
                        <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 8 }}>{fmtDate(m.measured_at as string)}</span>
                        <span style={{ color: '#374151', fontSize: 13, marginLeft: 8 }}>{Number(m.total_cm).toFixed(1)} см</span>
                        {m.note && <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 8 }}>{m.note as string}</span>}
                      </div>
                      {canEdit && (
                        confirmDelete === m.id
                          ? <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-danger" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => deleteMeasurement(m.id)}>Удалить</button>
                              <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setConfirmDelete(null)}>Отмена</button>
                            </div>
                          : <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px', color: '#dc2626' }} onClick={() => setConfirmDelete(m.id)}>Удалить</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* InBody stub modal */}
        {showInbodyModal && (
          <div className="dialog-overlay" onClick={() => setShowInbodyModal(false)}>
            <div className="dialog" onClick={e => e.stopPropagation()}>
              <h3>📷 Сканировать лист InBody</h3>
              <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>
                Скоро: данные с листа InBody будут подтягиваться автоматически.
              </p>
              <button className="btn btn-secondary" style={{ marginTop: 20, width: '100%' }} onClick={() => setShowInbodyModal(false)}>Закрыть</button>
            </div>
          </div>
        )}
      </div>
    </MeasureLayout>
  );
}

function isToday(isoCreatedAt: string): boolean {
  const yekDay = (iso: string) => new Date(new Date(iso).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  return yekDay(isoCreatedAt) === yekDay(new Date().toISOString());
}

function fmtDiff(d: number): string {
  return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1);
}
