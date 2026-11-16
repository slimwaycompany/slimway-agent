import { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StaffMember {
  id: string;
  login: string;
  display_name: string;
  role: 'admin' | 'manager';
  phone: string | null;
  is_active: boolean;
  fired_at: string | null;
  last_login_at: string | null;
  created_at: string;
}

interface PermEntry { perm_key: string; level: 'view' | 'edit'; see_all: boolean }

interface PermTab { key: string; label: string; hasSeeAll: boolean }
interface PermBlock { key: string; label: string; icon: string; tabs: PermTab[] }

interface LoginLogEntry { id: string; ok: boolean; reason: string | null; ip: string; user_agent: string; created_at: string }

// ── API helpers ────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100%', fontFamily: "'Manrope',system-ui,sans-serif", fontSize: 14 },
  list: { width: 260, flexShrink: 0, borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' },
  listHead: { padding: '16px 16px 12px', borderBottom: '1px solid #e5e7eb' },
  listTitle: { fontSize: 15, fontWeight: 700, color: '#1a202c', marginBottom: 8 },
  addBtn: { width: '100%', padding: '8px 12px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  listItems: { flex: 1, overflowY: 'auto', padding: '6px 0' },
  listItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer', borderLeft: '3px solid transparent', transition: 'background .12s' },
  listItemActive: { background: 'rgba(2,189,182,0.08)', borderLeft: '3px solid #02BDB6' },
  avatar: { width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#02BDB6,#263CD9)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 },
  itemName: { fontWeight: 600, color: '#1a202c', fontSize: 13 },
  itemRole: { fontSize: 11, color: '#64748b' },
  badge: { fontSize: 10, padding: '2px 6px', borderRadius: 10, fontWeight: 700 },
  content: { flex: 1, overflowY: 'auto', padding: 24 },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 10 },
  row: { display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-end' },
  label: { fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none' },
  select: { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', background: '#fff', outline: 'none' },
  btn: { padding: '8px 16px', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
  btnPrimary: { background: '#02BDB6', color: '#fff' },
  btnDanger: { background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca' },
  btnSecondary: { background: '#f1f5f9', color: '#374151', border: '1px solid #e5e7eb' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#fff', borderRadius: 16, padding: 24, width: 'min(480px,90vw)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' },
  err: { fontSize: 12, color: '#ef4444', marginTop: 6 },
  divider: { height: 1, background: '#e5e7eb', margin: '20px 0' },
  permBlock: { marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' },
  permBlockHead: { padding: '10px 14px', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' as const },
  permTabRow: { padding: '8px 14px 8px 36px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' },
};

// ── Permission tree component ──────────────────────────────────────────────────

function PermTree({
  catalog,
  perms,
  onChange,
  disabled,
}: {
  catalog: PermBlock[];
  perms: Record<string, PermEntry>;
  onChange: (perms: Record<string, PermEntry>) => void;
  disabled?: boolean;
}) {
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());

  function toggleBlock(key: string) {
    setOpenBlocks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function blockHasAny(block: PermBlock): boolean {
    return block.tabs.some(t => perms[t.key]);
  }

  function toggleBlockAll(block: PermBlock, checked: boolean) {
    const next = { ...perms };
    if (checked) {
      for (const t of block.tabs) next[t.key] = { perm_key: t.key, level: 'view', see_all: false };
    } else {
      for (const t of block.tabs) delete next[t.key];
    }
    onChange(next);
  }

  function setLevel(key: string, level: 'view' | 'edit') {
    const next = { ...perms };
    if (next[key]) next[key] = { ...next[key], level };
    else next[key] = { perm_key: key, level, see_all: false };
    onChange(next);
  }

  function setSeeAll(key: string, see_all: boolean) {
    const next = { ...perms };
    if (next[key]) next[key] = { ...next[key], see_all };
    onChange(next);
  }

  function setTabEnabled(key: string, enabled: boolean) {
    const next = { ...perms };
    if (enabled) next[key] = { perm_key: key, level: 'view', see_all: false };
    else delete next[key];
    onChange(next);
  }

  return (
    <div>
      {catalog.map(block => {
        const hasAny = blockHasAny(block);
        const isOpen = openBlocks.has(block.key);
        return (
          <div key={block.key} style={S.permBlock}>
            <div style={S.permBlockHead} onClick={() => toggleBlock(block.key)}>
              <input
                type="checkbox"
                checked={hasAny}
                disabled={disabled}
                onChange={e => { e.stopPropagation(); toggleBlockAll(block, e.target.checked); }}
                onClick={e => e.stopPropagation()}
                style={{ width: 15, height: 15 }}
              />
              <span>{block.icon}</span>
              <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{block.label}</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && block.tabs.map(tab => {
              const p = perms[tab.key];
              return (
                <div key={tab.key} style={S.permTabRow}>
                  <label style={S.checkLabel}>
                    <input type="checkbox" checked={Boolean(p)} disabled={disabled}
                      onChange={e => setTabEnabled(tab.key, e.target.checked)} style={{ width: 14, height: 14 }} />
                    <span style={{ flex: 1, minWidth: 140 }}>{tab.label}</span>
                  </label>
                  {p && (
                    <>
                      <label style={S.checkLabel}>
                        <input type="radio" name={`level-${tab.key}`} value="view" checked={p.level === 'view'} disabled={disabled}
                          onChange={() => setLevel(tab.key, 'view')} />
                        Просмотр
                      </label>
                      <label style={S.checkLabel}>
                        <input type="radio" name={`level-${tab.key}`} value="edit" checked={p.level === 'edit'} disabled={disabled}
                          onChange={() => setLevel(tab.key, 'edit')} />
                        Изменение
                      </label>
                      {tab.hasSeeAll && (
                        <label style={S.checkLabel}>
                          <input type="checkbox" checked={p.see_all} disabled={disabled}
                            onChange={e => setSeeAll(tab.key, e.target.checked)} style={{ width: 14, height: 14 }} />
                          Видит всех
                        </label>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Create staff modal ─────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ login: '', display_name: '', role: 'manager', phone: '', password: '' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setErr('');
    if (!form.login || !form.display_name || !form.password) { setErr('Заполните все обязательные поля'); return; }
    setLoading(true);
    const r = await api('POST', '/api/staff', form);
    setLoading(false);
    if (!r.ok) { setErr(r.data.error || 'Ошибка'); return; }
    onCreated();
    onClose();
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Новый сотрудник</h3>
        <label style={S.label}>Логин *</label>
        <input style={{ ...S.input, marginBottom: 10 }} value={form.login}
          onChange={e => setForm(f => ({ ...f, login: e.target.value }))} placeholder="vera_ivanova" />
        <label style={S.label}>Имя (отображается) *</label>
        <input style={{ ...S.input, marginBottom: 10 }} value={form.display_name}
          onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="Вера" />
        <label style={S.label}>Роль</label>
        <select style={{ ...S.select, marginBottom: 10 }} value={form.role}
          onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
          <option value="manager">Менеджер</option>
          <option value="admin">Администратор</option>
        </select>
        <label style={S.label}>Телефон</label>
        <input style={{ ...S.input, marginBottom: 10 }} value={form.phone}
          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+7..." />
        <label style={S.label}>Пароль *</label>
        <input style={{ ...S.input, marginBottom: 10 }} type="password" value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
        {err && <div style={S.err}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={onClose}>Отмена</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={submit} disabled={loading}>
            {loading ? 'Создаю…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Staff detail panel ─────────────────────────────────────────────────────────

function StaffDetail({
  member,
  catalog,
  allStaff,
  onRefresh,
}: {
  member: StaffMember;
  catalog: PermBlock[];
  allStaff: StaffMember[];
  onRefresh: () => void;
}) {
  const [form, setForm] = useState({ display_name: member.display_name, phone: member.phone ?? '', login: member.login, role: member.role });
  const [permsArr, setPermsArr] = useState<PermEntry[]>([]);
  const [permsMap, setPermsMap] = useState<Record<string, PermEntry>>({});
  const [permsSaving, setPermsSaving] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [editErr, setEditErr] = useState('');
  const [logEntries, setLogEntries] = useState<LoginLogEntry[] | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');

  const loadPerms = useCallback(async () => {
    const r = await api('GET', `/api/staff/${member.id}/permissions`);
    if (r.ok) {
      const arr = r.data as PermEntry[];
      setPermsArr(arr);
      const map: Record<string, PermEntry> = {};
      for (const p of arr) map[p.perm_key] = p;
      setPermsMap(map);
    }
  }, [member.id]);

  useEffect(() => {
    setForm({ display_name: member.display_name, phone: member.phone ?? '', login: member.login, role: member.role });
    setNewPw(''); setPwErr(''); setEditErr(''); setShowLog(false); setLogEntries(null);
    loadPerms();
  }, [member.id, loadPerms, member]);

  async function saveProfile() {
    setEditErr('');
    const r = await api('PATCH', `/api/staff/${member.id}`, form);
    if (!r.ok) { setEditErr(r.data.error || 'Ошибка сохранения'); return; }
    onRefresh();
  }

  async function changePassword() {
    setPwErr('');
    if (!newPw) { setPwErr('Введите новый пароль'); return; }
    const r = await api('POST', `/api/staff/${member.id}/password`, { password: newPw });
    if (!r.ok) { setPwErr(r.data.error || 'Ошибка'); return; }
    setNewPw('');
    alert('Пароль изменён. Все сессии сотрудника завершены.');
  }

  async function savePerms() {
    setPermsSaving(true);
    const rows = Object.values(permsMap);
    const r = await api('PUT', `/api/staff/${member.id}/permissions`, rows);
    setPermsSaving(false);
    if (!r.ok) { alert(r.data.error || 'Ошибка сохранения прав'); return; }
    setPermsArr(rows);
  }

  async function copyPerms() {
    if (!copyFrom) return;
    const r = await api('POST', `/api/staff/${member.id}/permissions/copy`, { from_user_id: copyFrom });
    if (!r.ok) { alert(r.data.error || 'Ошибка'); return; }
    await loadPerms();
    setCopyFrom('');
  }

  async function fire() {
    if (!confirm(`Уволить ${member.display_name}? Вход будет заблокирован немедленно.`)) return;
    const r = await api('POST', `/api/staff/${member.id}/fire`);
    if (!r.ok) { alert(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function restore() {
    const r = await api('DELETE', `/api/staff/${member.id}/fire`);
    if (!r.ok) { alert(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function deleteMember() {
    if (!confirm(`Удалить ${member.display_name} физически? Это необратимо.`)) return;
    const r = await api('DELETE', `/api/staff/${member.id}`);
    if (!r.ok) { alert(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function logoutAll() {
    if (!confirm(`Завершить все сессии ${member.display_name}?`)) return;
    const r = await api('POST', `/api/staff/${member.id}/logout-all`);
    if (!r.ok) { alert(r.data.error || 'Ошибка'); return; }
    alert('Все сессии завершены.');
  }

  async function loadLog() {
    if (logEntries) { setShowLog(!showLog); return; }
    const r = await api('GET', `/api/staff/${member.id}/login-log`);
    if (r.ok) { setLogEntries(r.data as LoginLogEntry[]); setShowLog(true); }
  }

  const isAdmin = member.role === 'admin';
  const isFired = !member.is_active;

  return (
    <div style={S.content}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <div style={{ ...S.avatar, width: 44, height: 44, fontSize: 18 }}>
          {member.display_name[0]?.toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{member.display_name}</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>@{member.login} · {isAdmin ? 'Администратор' : 'Менеджер'}
            {isFired && <span style={{ marginLeft: 8, ...S.badge, background: '#fef2f2', color: '#ef4444' }}>Уволен</span>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={logoutAll}>Завершить сессии</button>
          <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={loadLog}>Журнал входов</button>
          {isFired
            ? <button style={{ ...S.btn, ...S.btnPrimary, fontSize: 12 }} onClick={restore}>Восстановить</button>
            : <button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={fire}>Уволить</button>}
        </div>
      </div>

      {/* Login log */}
      {showLog && logEntries && (
        <div style={{ ...S.section, background: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Журнал входов (последние 100)</div>
          {logEntries.length === 0 && <div style={{ color: '#94a3b8' }}>Нет записей</div>}
          {logEntries.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #e5e7eb' }}>
              <span style={{ color: e.ok ? '#16a34a' : '#ef4444', fontWeight: 700 }}>{e.ok ? '✓' : '✗'}</span>
              <span style={{ color: '#64748b' }}>{fmtDate(e.created_at)}</span>
              <span>{e.ip}</span>
              {e.reason && <span style={{ color: '#ef4444' }}>{e.reason}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Profile */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Профиль</div>
        <div style={S.row}>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Имя</label>
            <input style={S.input} value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Телефон</label>
            <input style={S.input} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
        </div>
        <div style={S.row}>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Логин</label>
            <input style={S.input} value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Роль</label>
            <select style={S.select} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'manager' }))}>
              <option value="manager">Менеджер</option>
              <option value="admin">Администратор</option>
            </select>
          </div>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={saveProfile}>Сохранить</button>
        </div>
        {editErr && <div style={S.err}>{editErr}</div>}
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
          Последний вход: {fmtDate(member.last_login_at)}
        </div>
      </div>

      <div style={S.divider} />

      {/* Password */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Смена пароля</div>
        <div style={S.row}>
          <input style={S.input} type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
            placeholder="Новый пароль (мин. 4 симв.)" />
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={changePassword}>Сменить</button>
        </div>
        {pwErr && <div style={S.err}>{pwErr}</div>}
      </div>

      <div style={S.divider} />

      {/* Permissions (not shown for admin) */}
      {!isAdmin && (
        <div style={S.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={S.sectionTitle}>Права доступа</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select style={{ ...S.select, width: 160, fontSize: 12, padding: '5px 8px' }}
                value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
                <option value="">Скопировать с…</option>
                {allStaff.filter(s => s.id !== member.id && s.role === 'manager' && s.is_active).map(s => (
                  <option key={s.id} value={s.id}>{s.display_name}</option>
                ))}
              </select>
              {copyFrom && <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={copyPerms}>Скопировать</button>}
              <button style={{ ...S.btn, ...S.btnPrimary, fontSize: 12 }} disabled={permsSaving} onClick={savePerms}>
                {permsSaving ? 'Сохраняю…' : 'Сохранить права'}
              </button>
            </div>
          </div>
          <PermTree
            catalog={catalog}
            perms={permsMap}
            onChange={map => { setPermsMap(map); setPermsArr(Object.values(map)); }}
            disabled={isFired}
          />
          {permsArr.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 8 }}>Нет ни одного права — сотрудник не видит ни одной вкладки.</div>}
        </div>
      )}
      {isAdmin && <div style={{ color: '#64748b', fontSize: 13, fontStyle: 'italic' }}>Администратор — полный доступ ко всем вкладкам.</div>}

      <div style={S.divider} />

      {/* Delete */}
      <div>
        <button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={deleteMember}>
          Удалить физически (если нет записей)
        </button>
      </div>
    </div>
  );
}

// ── Main StaffPage ─────────────────────────────────────────────────────────────

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [catalog, setCatalog] = useState<PermBlock[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFired, setShowFired] = useState(false);

  const loadStaff = useCallback(async () => {
    const r = await api('GET', '/api/staff');
    if (r.ok) setStaff(r.data as StaffMember[]);
  }, []);

  useEffect(() => {
    loadStaff();
    api('GET', '/api/permissions/catalog').then(r => { if (r.ok) setCatalog(r.data as PermBlock[]); });
  }, [loadStaff]);

  const visible = staff.filter(s => showFired ? true : s.is_active);
  const selectedMember = staff.find(s => s.id === selected);

  return (
    <div style={S.root}>
      {/* Left list */}
      <div style={S.list}>
        <div style={S.listHead}>
          <div style={S.listTitle}>Сотрудники</div>
          <button style={S.addBtn} onClick={() => setShowCreate(true)}>+ Добавить</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={showFired} onChange={e => setShowFired(e.target.checked)} />
            Показать уволенных
          </label>
        </div>
        <div style={S.listItems}>
          {visible.map(s => (
            <div
              key={s.id}
              style={{ ...S.listItem, ...(selected === s.id ? S.listItemActive : {}), opacity: s.is_active ? 1 : 0.5 }}
              onClick={() => setSelected(s.id)}
            >
              <div style={S.avatar}>{s.display_name[0]?.toUpperCase()}</div>
              <div style={{ overflow: 'hidden' }}>
                <div style={S.itemName}>{s.display_name}</div>
                <div style={S.itemRole}>{s.role === 'admin' ? '⭐ Администратор' : 'Менеджер'}</div>
              </div>
            </div>
          ))}
          {visible.length === 0 && <div style={{ padding: '20px 16px', color: '#94a3b8', fontSize: 13 }}>Нет сотрудников</div>}
        </div>
      </div>

      {/* Right panel */}
      {selectedMember
        ? <StaffDetail
            key={selectedMember.id}
            member={selectedMember}
            catalog={catalog}
            allStaff={staff}
            onRefresh={() => { loadStaff(); }}
          />
        : <div style={S.empty}>Выберите сотрудника</div>
      }

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { loadStaff(); }}
        />
      )}
    </div>
  );
}
