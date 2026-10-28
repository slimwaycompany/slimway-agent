import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdSource { id: string; name: string; requires_referrer: boolean; is_active: boolean }

interface ClientRow {
  id: string; full_name: string; phone: string | null; birth_date: string | null;
  ad_source_id: string | null; profile_complete: boolean; status: string;
  fitbase_client_id: string | null; created_at: string;
}

interface ClientFull extends ClientRow {
  iin: string | null; referrer_client_id: string | null;
  id_issued_by: string | null; id_valid_until: string | null;
  photo_path: string | null; contraindications: string | null; notes: string | null;
  source: string; branch_id: string; is_deleted: boolean;
}

interface RefClient { id: string; full_name: string; phone: string | null }

interface ClientBalance { deposit: number; bonus: number }
interface ClientPlan {
  id: string; plan_id: string; status: string; purchase_date: string;
  activated_at: string | null; valid_until: string | null;
  plan: { id: string; name: string; kind: string } | null;
  crm_client_plan_items: { device_type_code: string; sessions: number }[];
}
interface SaleRow {
  id: string; number: number; total_amount: number; status: string; created_at: string;
  cashier: string; discount_kind: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('.');
}

function maskPhone(phone: string | null) {
  if (!phone) return '—';
  return phone;
}

function iinToDob(iin: string): string {
  if (iin.length < 7) return '';
  const yy = iin.slice(0, 2), mm = iin.slice(2, 4), dd = iin.slice(4, 6);
  const c = parseInt(iin[6]);
  const century = c <= 2 ? '19' : c <= 4 ? '20' : '18';
  if (parseInt(mm) < 1 || parseInt(mm) > 12 || parseInt(dd) < 1 || parseInt(dd) > 31) return '';
  return `${century}${yy}-${mm}-${dd}`;
}

async function apiJSON(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d, status: r.status };
}

// ── Client form ────────────────────────────────────────────────────────────────

function ClientForm({ client, adSources, onSave, onCancel }: {
  client: ClientFull | null;
  adSources: AdSource[];
  onSave: (data: ClientFull) => void;
  onCancel: () => void;
}) {
  const isNew = !client;
  const [form, setForm] = useState({
    full_name: client?.full_name ?? '',
    phone: client?.phone ?? '',
    iin: client?.iin?.replace(/\*+.*/, '') ?? '',
    birth_date: client?.birth_date?.slice(0, 10) ?? '',
    ad_source_id: client?.ad_source_id ?? '',
    referrer_client_id: client?.referrer_client_id ?? '',
    id_issued_by: client?.id_issued_by ?? '',
    id_valid_until: client?.id_valid_until?.slice(0, 10) ?? '',
    contraindications: client?.contraindications ?? '',
    notes: client?.notes ?? '',
    profile_complete: client?.profile_complete ?? false,
  });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl]   = useState<string | null>(null);
  const [referrerSearch, setReferrerSearch] = useState('');
  const [referrerResults, setReferrerResults] = useState<RefClient[]>([]);
  const [referrerName, setReferrerName] = useState('');
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedSource = adSources.find(s => s.id === form.ad_source_id);

  useEffect(() => {
    if (client?.photo_path) {
      fetch(`/kviz/api/crm/clients/${client.id}/photo-url`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.url) setPhotoUrl(d.url); }).catch(() => {});
    }
    if (client?.referrer_client_id) {
      fetch(`/kviz/api/crm/clients/${client.referrer_client_id}`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.full_name) setReferrerName(d.full_name); }).catch(() => {});
    }
  }, [client]);

  async function searchReferrer(q: string) {
    if (q.length < 2) { setReferrerResults([]); return; }
    const r = await fetch(`/kviz/api/crm/clients?search=${encodeURIComponent(q)}&limit=10`, { credentials: 'include' });
    const d = await r.json();
    setReferrerResults(Array.isArray(d) ? d.filter((c: ClientRow) => c.id !== client?.id) : []);
  }

  function onIinChange(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 12);
    setForm(f => {
      const upd = { ...f, iin: digits };
      if (digits.length === 12) {
        const dob = iinToDob(digits);
        if (dob && !f.birth_date) upd.birth_date = dob;
      }
      return upd;
    });
  }

  function onPhoneChange(v: string) {
    let digits = v.replace(/\D/g, '');
    if (digits.startsWith('8') && digits.length > 1) digits = '7' + digits.slice(1);
    if (digits.startsWith('77') || digits.startsWith('7') && digits.length === 1) {
      setForm(f => ({ ...f, phone: '+' + digits }));
    } else {
      setForm(f => ({ ...f, phone: v }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setLoading(true);
    const body: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      phone: form.phone || null,
      iin: form.iin || null,
      birth_date: form.birth_date || null,
      ad_source_id: form.ad_source_id || null,
      referrer_client_id: form.referrer_client_id || null,
      id_issued_by: form.id_issued_by || null,
      id_valid_until: form.id_valid_until || null,
      contraindications: form.contraindications || null,
      notes: form.notes || null,
      profile_complete: form.profile_complete,
    };
    const url = isNew ? '/kviz/api/crm/clients' : `/kviz/api/crm/clients/${client!.id}`;
    const { ok, data } = await apiJSON(isNew ? 'POST' : 'PATCH', url, body);
    if (!ok) { setErr(data.error || 'Ошибка'); setLoading(false); return; }
    const saved = data as ClientFull;
    if (photoFile) {
      const reader = new FileReader();
      reader.onload = async () => {
        const b64 = String(reader.result).split(',')[1];
        await apiJSON('POST', `/kviz/api/crm/clients/${saved.id}/photo`, { data: b64, mime: photoFile.type });
        setLoading(false);
        onSave(saved);
      };
      reader.onerror = () => { setLoading(false); onSave(saved); };
      reader.readAsDataURL(photoFile);
    } else {
      setLoading(false);
      onSave(saved);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ height: '100%', overflow: 'auto', padding: '16px 20px 40px' }}>
      <div style={SF.header}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{isNew ? 'Новый клиент' : 'Редактировать клиента'}</h2>
        <button type="button" style={SF.iconBtn} onClick={onCancel}>✕</button>
      </div>
      {err && <div style={SF.errBox}>{err}</div>}

      <div style={SF.grid}>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>ФИО *</label>
          <input style={SF.inp} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required placeholder="Иванова Анна Ивановна" />
        </div>
        <div>
          <label style={SF.label}>Телефон (+7...)</label>
          <input style={SF.inp} value={form.phone} onChange={e => onPhoneChange(e.target.value)} placeholder="+7 777 000 00 00" />
        </div>
        <div>
          <label style={SF.label}>ИИН (12 цифр)</label>
          <input style={SF.inp} value={form.iin} onChange={e => onIinChange(e.target.value)} maxLength={12} placeholder="000000000000" />
          {form.iin.length > 0 && form.iin.length < 12 && <span style={{ fontSize: 11, color: '#f59e0b' }}>Введено {form.iin.length}/12</span>}
        </div>
        <div>
          <label style={SF.label}>Дата рождения</label>
          <input style={SF.inp} type="date" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} />
        </div>
        <div>
          <label style={SF.label}>Рекламный источник</label>
          <select style={SF.inp} value={form.ad_source_id} onChange={e => setForm(f => ({ ...f, ad_source_id: e.target.value, referrer_client_id: '' }))}>
            <option value="">— не указан —</option>
            {adSources.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {selectedSource?.requires_referrer && (
          <div style={{ gridColumn: '1/-1' }}>
            <label style={SF.label}>Реферер (кто привёл)</label>
            <div style={{ position: 'relative' }}>
              <input style={SF.inp} value={form.referrer_client_id ? referrerName : referrerSearch}
                onChange={e => {
                  if (form.referrer_client_id) { setForm(f => ({ ...f, referrer_client_id: '' })); setReferrerName(''); }
                  setReferrerSearch(e.target.value); searchReferrer(e.target.value);
                }}
                placeholder="Поиск по имени или телефону"
              />
              {referrerResults.length > 0 && !form.referrer_client_id && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10 }}>
                  {referrerResults.map(c => (
                    <div key={c.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}
                      onMouseDown={() => { setForm(f => ({ ...f, referrer_client_id: c.id })); setReferrerName(c.full_name); setReferrerSearch(''); setReferrerResults([]); }}>
                      {c.full_name} {c.phone && <span style={{ color: '#64748b' }}>{c.phone}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {form.referrer_client_id && <div style={{ fontSize: 12, color: '#02BDB6', marginTop: 4 }}>✓ {referrerName}</div>}
          </div>
        )}
        <div>
          <label style={SF.label}>Кем выдан документ</label>
          <input style={SF.inp} value={form.id_issued_by} onChange={e => setForm(f => ({ ...f, id_issued_by: e.target.value }))} placeholder="МЮ РК" />
        </div>
        <div>
          <label style={SF.label}>Действителен до</label>
          <input style={SF.inp} type="date" value={form.id_valid_until} onChange={e => setForm(f => ({ ...f, id_valid_until: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Фото</label>
          {photoUrl && <img src={photoUrl} alt="Фото" style={{ width: 80, height: 80, borderRadius: 40, objectFit: 'cover', display: 'block', marginBottom: 8 }} />}
          <button type="button" style={SF.outlineBtn} onClick={() => fileRef.current?.click()}>
            {photoFile ? `✓ ${photoFile.name}` : photoUrl ? 'Заменить фото' : 'Загрузить фото'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setPhotoFile(e.target.files?.[0] ?? null)} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Противопоказания</label>
          <textarea style={{ ...SF.inp, height: 70, resize: 'vertical' }} value={form.contraindications} onChange={e => setForm(f => ({ ...f, contraindications: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={SF.label}>Заметки</label>
          <textarea style={{ ...SF.inp, height: 70, resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.profile_complete} onChange={e => setForm(f => ({ ...f, profile_complete: e.target.checked }))} />
            Анкета заполнена
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button type="button" style={SF.cancelBtn} onClick={onCancel}>Отмена</button>
        <button type="submit" style={SF.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
      </div>
    </form>
  );
}

// ── Client card ────────────────────────────────────────────────────────────────

function ClientCard({ clientId, adSources, role, onEdit, onClose }: {
  clientId: string; adSources: AdSource[]; role: string;
  onEdit: () => void; onClose: () => void;
}) {
  const [client, setClient] = useState<ClientFull | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [referrerName, setReferrerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'info' | 'plans' | 'sales'>('info');
  const [balance, setBalance] = useState<ClientBalance | null>(null);
  const [plans, setPlans] = useState<ClientPlan[] | null>(null);
  const [sales, setSales] = useState<SaleRow[] | null>(null);

  useEffect(() => {
    setLoading(true);
    setTab('info'); setBalance(null); setPlans(null); setSales(null);
    fetch(`/kviz/api/crm/clients/${clientId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setClient(d); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`/kviz/api/crm/clients/${clientId}/balance`, { credentials: 'include' })
      .then(r => r.json()).then(d => setBalance(d)).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    if (!client) return;
    if (client.photo_path) {
      fetch(`/kviz/api/crm/clients/${clientId}/photo-url`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.url) setPhotoUrl(d.url); }).catch(() => {});
    }
    if (client.referrer_client_id) {
      fetch(`/kviz/api/crm/clients/${client.referrer_client_id}`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.full_name) setReferrerName(d.full_name); }).catch(() => {});
    }
  }, [client, clientId]);

  useEffect(() => {
    if (tab === 'plans' && plans === null) {
      fetch(`/kviz/api/crm/clients/${clientId}/plans`, { credentials: 'include' })
        .then(r => r.json()).then(d => setPlans(Array.isArray(d) ? d : [])).catch(() => setPlans([]));
    }
    if (tab === 'sales' && sales === null) {
      fetch(`/kviz/api/crm/sales?client_id=${clientId}`, { credentials: 'include' })
        .then(r => r.json()).then(d => setSales(Array.isArray(d) ? d : [])).catch(() => setSales([]));
    }
  }, [tab, clientId, plans, sales]);

  if (loading) return <div style={{ padding: 20, color: '#94a3b8', fontSize: 13 }}>Загрузка…</div>;
  if (!client) return <div style={{ padding: 20, color: '#ef4444', fontSize: 13 }}>Клиент не найден</div>;

  const source = adSources.find(s => s.id === client.ad_source_id);

  function row(label: string, value: React.ReactNode) {
    if (!value) return null;
    return (
      <div style={SC.row}>
        <span style={SC.key}>{label}</span>
        <span style={SC.val}>{value}</span>
      </div>
    );
  }

  const planStatusLabel: Record<string, { text: string; color: string }> = {
    not_activated: { text: 'Не активирован', color: '#f59e0b' },
    active:        { text: 'Активен',         color: '#16a34a' },
    frozen:        { text: 'Заморожен',        color: '#6366f1' },
    expired:       { text: 'Истёк',            color: '#ef4444' },
    refunded:      { text: 'Возвращён',        color: '#94a3b8' },
    cancelled:     { text: 'Отменён',          color: '#94a3b8' },
  };

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={SC.header}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {photoUrl ? <img src={photoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 28, objectFit: 'cover', flexShrink: 0 }} /> : (
            <div style={{ width: 56, height: 56, borderRadius: 28, background: 'linear-gradient(135deg,#02BDB6,#263CD9)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>
              {client.full_name[0].toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{client.full_name}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{client.phone ?? 'Без телефона'}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {client.profile_complete && <span style={SC.chip}>✓ Анкета</span>}
              {client.fitbase_client_id && <span style={{ ...SC.chip, background: '#dbeafe', color: '#1d4ed8' }}>Fitbase</span>}
              {client.status !== 'active' && <span style={{ ...SC.chip, background: '#fee2e2', color: '#ef4444' }}>{client.status}</span>}
              {balance && balance.deposit > 0 && <span style={{ ...SC.chip, background: '#ecfdf5', color: '#059669' }}>Депозит: {balance.deposit.toLocaleString('ru-RU')} ₸</span>}
              {balance && balance.bonus > 0 && <span style={{ ...SC.chip, background: '#ede9fe', color: '#6d28d9' }}>{balance.bonus} б.</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={SC.editBtn} onClick={onEdit}>✎ Редактировать</button>
          <button style={SC.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
        {(['info', 'plans', 'sales'] as const).map(t => (
          <button key={t} style={{ padding: '5px 14px', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: tab === t ? 700 : 500, background: tab === t ? '#02BDB6' : '#f1f5f9', color: tab === t ? '#fff' : '#374151' }} onClick={() => setTab(t)}>
            {t === 'info' ? 'Анкета' : t === 'plans' ? 'Абонементы' : 'Продажи'}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <div style={{ padding: '12px 20px' }}>
          {row('Дата рождения', fmtDate(client.birth_date))}
          {client.iin && row('ИИН', role === 'admin' ? client.iin : client.iin.replace(/\d{6}$/, '******'))}
          {row('Источник', source?.name ?? client.ad_source_id)}
          {referrerName && row('Реферер', referrerName)}
          {row('Документ выдан', client.id_issued_by)}
          {row('Документ действует до', fmtDate(client.id_valid_until))}
          {row('Противопоказания', client.contraindications)}
          {row('Заметки', client.notes)}
          {row('Источник создания', client.source)}
          {row('Добавлен', fmtDate(client.created_at))}
        </div>
      )}

      {tab === 'plans' && (
        <div style={{ padding: '12px 16px' }}>
          {plans === null && <div style={{ color: '#94a3b8', fontSize: 13 }}>Загрузка…</div>}
          {plans !== null && plans.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Абонементы не найдены</div>}
          {(plans ?? []).map(cp => {
            const st = planStatusLabel[cp.status] ?? { text: cp.status, color: '#64748b' };
            return (
              <div key={cp.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{cp.plan?.name ?? cp.plan_id}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: st.color, background: st.color + '1a', padding: '2px 8px', borderRadius: 4 }}>{st.text}</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {cp.activated_at && <span>Активирован: {fmtDate(cp.activated_at)}</span>}
                  {cp.valid_until && <span style={{ marginLeft: 8 }}>До: {fmtDate(cp.valid_until)}</span>}
                </div>
                {cp.crm_client_plan_items.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {cp.crm_client_plan_items.map((it, i) => (
                      <span key={i} style={{ fontSize: 11, background: '#f1f5f9', padding: '1px 7px', borderRadius: 4 }}>
                        {it.device_type_code}: {it.sessions} сеансов
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'sales' && (
        <div style={{ padding: '12px 16px' }}>
          {sales === null && <div style={{ color: '#94a3b8', fontSize: 13 }}>Загрузка…</div>}
          {sales !== null && sales.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Продажи не найдены</div>}
          {(sales ?? []).map(sale => (
            <div key={sale.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>#{sale.number} · {sale.total_amount.toLocaleString('ru-RU')} ₸</span>
                {sale.status !== 'completed' && <span style={{ fontSize: 11, color: '#ef4444', background: '#fef2f2', padding: '1px 6px', borderRadius: 4 }}>{sale.status}</span>}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {sale.cashier} · {fmtDate(sale.created_at)}
                {sale.discount_kind !== 'none' && ` · скидка (${sale.discount_kind})`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fitbase import ─────────────────────────────────────────────────────────────

function FitbaseImport({ onDone }: { onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ imported: number; skipped: number; total: number } | null>(null);
  const [error, setError]     = useState('');

  async function run() {
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetch('/kviz/api/crm/clients/fitbase-import', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Ошибка импорта'); return; }
      setResult(d); onDone();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Импорт из Fitbase</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Загрузит всех клиентов из Fitbase. Дубли (по fitbase_client_id) пропускаются.</div>
      {error && <div style={{ background: '#fef2f2', color: '#ef4444', padding: '6px 10px', borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {result && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
          Всего: {result.total} · Импортировано: <b>{result.imported}</b> · Пропущено: {result.skipped}
        </div>
      )}
      <button style={{ padding: '8px 16px', background: '#263CD9', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }} onClick={run} disabled={loading}>
        {loading ? 'Импортируем…' : 'Запустить импорт'}
      </button>
    </div>
  );
}

// ── Main ClientsPage ───────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [clients, setClients]   = useState<ClientRow[]>([]);
  const [adSources, setAdSources] = useState<AdSource[]>([]);
  const [search, setSearch]     = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterComplete, setFilterComplete] = useState('');
  const [loading, setLoading]   = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editClient, setEditClient] = useState<ClientFull | null | 'new'>(null);
  const [role, setRole]         = useState('manager');
  const [showImport, setShowImport] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/kviz/api/crm/ad-sources', { credentials: 'include' }).then(r => r.json()).then(d => { if (Array.isArray(d)) setAdSources(d); }).catch(() => {});
    fetch('/kviz/api/me', { credentials: 'include' }).then(r => r.json()).then(d => { if (d.role) setRole(d.role); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (search) params.set('search', search);
    if (filterSource) params.set('ad_source_id', filterSource);
    if (filterComplete) params.set('profile_complete', filterComplete);
    const r = await fetch(`/kviz/api/crm/clients?${params}`, { credentials: 'include' });
    const d = await r.json();
    setClients(Array.isArray(d) ? d : []);
    setLoading(false);
  }, [search, filterSource, filterComplete]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(load, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [load]);

  async function openEdit(id: string) {
    const r = await fetch(`/kviz/api/crm/clients/${id}`, { credentials: 'include' });
    const d = await r.json();
    setEditClient(d as ClientFull);
    setSelectedId(null);
  }

  async function archiveClient(id: string) {
    if (!confirm('Архивировать клиента?')) return;
    await apiJSON('DELETE', `/kviz/api/crm/clients/${id}`);
    setSelectedId(null); load();
  }

  function onSaved(data: ClientFull) {
    setEditClient(null);
    setSelectedId(data.id);
    load();
  }

  const sourceMap = new Map(adSources.map(s => [s.id, s.name]));

  // edit mode: full screen form
  if (editClient !== null) {
    return (
      <div style={{ height: '100vh', overflow: 'auto', background: '#f8fafc', fontFamily: "'Manrope',system-ui,sans-serif" }}>
        <ClientForm
          client={editClient === 'new' ? null : editClient}
          adSources={adSources}
          onSave={onSaved}
          onCancel={() => setEditClient(null)}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc' }}>
      {/* Left: list */}
      <div style={{ width: selectedId ? 360 : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: selectedId ? '1px solid #e2e8f0' : 'none', background: '#fff' }}>
        {/* Toolbar */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={SL.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или телефону" />
          <select style={SL.filter} value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="">Все источники</option>
            {adSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select style={SL.filter} value={filterComplete} onChange={e => setFilterComplete(e.target.value)}>
            <option value="">Все анкеты</option>
            <option value="true">Заполнена</option>
            <option value="false">Не заполнена</option>
          </select>
          <button style={SL.addBtn} onClick={() => setEditClient('new')}>+ Клиент</button>
          {role === 'admin' && <button style={SL.outlineBtn} onClick={() => setShowImport(v => !v)}>↓ Fitbase</button>}
        </div>
        {showImport && role === 'admin' && <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}><FitbaseImport onDone={load} /></div>}
        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>Загрузка…</div>}
          {!loading && !clients.length && <div style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>Клиенты не найдены</div>}
          {clients.map(c => (
            <div key={c.id} style={{ ...SL.row, background: selectedId === c.id ? 'rgba(2,189,182,0.06)' : '#fff', borderLeft: selectedId === c.id ? '3px solid #02BDB6' : '3px solid transparent' }}
              onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {maskPhone(c.phone)}
                  {c.birth_date && <span style={{ marginLeft: 8 }}>{fmtDate(c.birth_date)}</span>}
                </div>
                {(c.ad_source_id || c.profile_complete) && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {c.ad_source_id && <span style={SL.chip}>{sourceMap.get(c.ad_source_id) ?? '?'}</span>}
                    {c.profile_complete && <span style={{ ...SL.chip, background: '#dcfce7', color: '#16a34a' }}>✓</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#94a3b8' }}>
          {clients.length} клиентов
        </div>
      </div>

      {/* Right: card */}
      {selectedId && (
        <div style={{ flex: 1, overflow: 'auto', background: '#f8fafc' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8, background: '#fff' }}>
            <button style={SL.outlineBtn} onClick={() => openEdit(selectedId)}>✎ Редактировать</button>
            {role === 'admin' && <button style={{ ...SL.outlineBtn, color: '#ef4444', borderColor: '#fca5a5' }} onClick={() => archiveClient(selectedId)}>Архивировать</button>}
          </div>
          <ClientCard clientId={selectedId} adSources={adSources} role={role} onEdit={() => openEdit(selectedId)} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const SF: Record<string, React.CSSProperties> = {
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  iconBtn:   { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#64748b', padding: '2px 6px' },
  errBox:    { background: '#fef2f2', color: '#ef4444', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
  grid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' },
  label:     { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 12 },
  inp:       { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const },
  outlineBtn: { padding: '8px 14px', background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#374151', fontWeight: 500 },
  cancelBtn: { padding: '9px 18px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn:   { padding: '9px 24px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
};

const SL: Record<string, React.CSSProperties> = {
  search:  { flex: 1, minWidth: 160, padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' },
  filter:  { padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', outline: 'none' },
  addBtn:  { padding: '7px 16px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  outlineBtn: { padding: '7px 12px', background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' },
  row:     { padding: '10px 14px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.1s' },
  chip:    { display: 'inline-block', padding: '1px 7px', borderRadius: 6, fontSize: 11, background: '#f1f5f9', color: '#64748b', fontWeight: 500 },
};

const SC: Record<string, React.CSSProperties> = {
  header:  { padding: '14px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  row:     { display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f8fafc', fontSize: 13 },
  key:     { color: '#64748b', minWidth: 140, flexShrink: 0, fontSize: 13 },
  val:     { color: '#1a202c', fontWeight: 500 },
  chip:    { display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, background: '#dcfce7', color: '#16a34a', fontWeight: 600 },
  editBtn: { padding: '6px 14px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  closeBtn: { padding: '6px 10px', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', color: '#64748b' },
};
