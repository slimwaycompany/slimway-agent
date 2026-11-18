import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from '../../lib/toast';
import { useRole } from '../../lib/permContext';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StaffMember {
  id: string; login: string; display_name: string; role: 'admin' | 'manager';
  phone: string | null; is_active: boolean; fired_at: string | null;
  last_login_at: string | null; created_at: string;
  position_id: string | null; position_name: string | null;
  custom_permissions: boolean; branch_id: string | null; all_branches: boolean;
}

interface Position {
  id: string; code: string | null; name: string; description: string | null;
  sort: number; is_archived: boolean; created_at: string; employee_count: number;
}

interface PermEntry { perm_key: string; level: 'view' | 'edit'; see_all: boolean }

interface PermRow { key: string; label: string; kind: 'row' | 'action'; hasSeeAll?: boolean; parent?: string }
interface PermBlock { key: string; label: string; icon: string; rows: PermRow[] }

interface LoginLogEntry { id: string; ok: boolean; reason: string | null; ip: string; user_agent: string; created_at: string }

type PermMap = Record<string, { level: 'view' | 'edit'; see_all: boolean } | undefined>;

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: d };
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function permArrayToMap(arr: PermEntry[]): PermMap {
  const m: PermMap = {};
  for (const p of arr) m[p.perm_key] = { level: p.level, see_all: p.see_all };
  return m;
}

function permMapToArray(m: PermMap): PermEntry[] {
  return Object.entries(m)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ perm_key: k, level: v!.level, see_all: v!.see_all }));
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100%', fontFamily: "'Manrope',system-ui,sans-serif", fontSize: 14 },
  list: { width: 260, flexShrink: 0, borderRight: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column' },
  listHead: { padding: '12px 14px 10px', borderBottom: '1px solid #e5e7eb' },
  listTitle: { fontSize: 14, fontWeight: 700, color: '#1a202c', marginBottom: 8 },
  tabs: { display: 'flex', gap: 2, marginBottom: 8 },
  tabBtn: { flex: 1, padding: '5px 8px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  addBtn: { width: '100%', padding: '7px 12px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' },
  search: { width: '100%', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const },
  listItems: { flex: 1, overflowY: 'auto', padding: '4px 0' },
  listItem: { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px', cursor: 'pointer', borderLeft: '3px solid transparent' },
  listItemActive: { background: 'rgba(2,189,182,0.08)', borderLeft: '3px solid #02BDB6' },
  avatar: { width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#02BDB6,#263CD9)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 },
  itemName: { fontWeight: 600, color: '#1a202c', fontSize: 13, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  itemSub: { fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  content: { flex: 1, overflowY: 'auto', padding: '20px 24px' },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 8 },
  row: { display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-end', flexWrap: 'wrap' as const },
  label: { fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const },
  select: { width: '100%', padding: '7px 9px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 14, fontFamily: 'inherit', background: '#fff', outline: 'none', boxSizing: 'border-box' as const },
  btn: { padding: '7px 14px', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 },
  btnPrimary: { background: '#02BDB6', color: '#fff' },
  btnDanger: { background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca' },
  btnSecondary: { background: '#f1f5f9', color: '#374151', border: '1px solid #e5e7eb' },
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { background: '#fff', borderRadius: 14, padding: 20, width: 'min(480px,100%)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' },
  err: { fontSize: 12, color: '#ef4444', marginTop: 5 },
  divider: { height: 1, background: '#e5e7eb', margin: '16px 0' },
  permBlock: { marginBottom: 10, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' },
  permBlockHead: { padding: '9px 12px', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' as const },
  seg: { display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', flexShrink: 0 },
  segBtn: { padding: '3px 8px', border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: 'transparent', color: '#64748b' },
  segBtnActive: { background: '#02BDB6', color: '#fff' },
};

// ── New PermTree (3-segment) ───────────────────────────────────────────────────

function PermTree({
  catalog, perms, onChange, disabled, search,
}: {
  catalog: PermBlock[]; perms: PermMap;
  onChange: (p: PermMap) => void; disabled?: boolean; search?: string;
}) {
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const q = (search || '').toLowerCase().trim();

  function toggleBlock(key: string) {
    setOpenBlocks(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  function setLevel(key: string, level: 'none' | 'view' | 'edit', row: PermRow) {
    const next = { ...perms };
    if (level === 'none') {
      delete next[key];
      // If this is a parent row, remove its action children too
      if (row.kind === 'row') {
        const block = catalog.find(b => b.rows.some(r => r.key === key));
        if (block) for (const r of block.rows) { if (r.kind === 'action' && r.parent === key) delete next[r.key]; }
      }
    } else {
      next[key] = { level, see_all: perms[key]?.see_all ?? false };
    }
    onChange(next);
  }

  function setSeeAll(key: string, v: boolean) {
    const cur = perms[key];
    if (!cur) return;
    onChange({ ...perms, [key]: { ...cur, see_all: v } });
  }

  function setAction(key: string, checked: boolean) {
    const next = { ...perms };
    if (checked) next[key] = { level: 'edit', see_all: false };
    else delete next[key];
    onChange(next);
  }

  function blockSetAll(block: PermBlock, mode: 'none' | 'view' | 'edit') {
    const next = { ...perms };
    for (const r of block.rows) {
      if (mode === 'none') delete next[r.key];
      else if (r.kind === 'row') next[r.key] = { level: mode, see_all: next[r.key]?.see_all ?? false };
      else if (r.kind === 'action') {
        if (mode === 'edit') next[r.key] = { level: 'edit', see_all: false };
        else delete next[r.key];
      }
    }
    onChange(next);
  }

  return (
    <div>
      {catalog.map(block => {
        const rowRows = block.rows.filter(r => r.kind === 'row');
        const openCount = rowRows.filter(r => perms[r.key]).length;
        const matchRows = q ? block.rows.filter(r => r.label.toLowerCase().includes(q)) : block.rows;
        if (q && matchRows.length === 0) return null;
        const isOpen = q ? true : openBlocks.has(block.key);
        return (
          <div key={block.key} style={S.permBlock}>
            <div style={S.permBlockHead} onClick={() => !q && toggleBlock(block.key)}>
              <span>{block.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{block.label}</span>
              <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 6 }}>{openCount}/{rowRows.length}</span>
              {!disabled && (
                <div style={S.seg} onClick={e => e.stopPropagation()}>
                  <button style={{ ...S.segBtn }} onClick={() => blockSetAll(block, 'none')}>Нет</button>
                  <button style={{ ...S.segBtn }} onClick={() => blockSetAll(block, 'view')}>Всё V</button>
                  <button style={{ ...S.segBtn }} onClick={() => blockSetAll(block, 'edit')}>Всё E</button>
                </div>
              )}
              {!q && <span style={{ fontSize: 11, color: '#94a3b8' }}>{isOpen ? '▲' : '▼'}</span>}
            </div>
            {isOpen && block.rows.map(row => {
              if (q && !row.label.toLowerCase().includes(q)) return null;
              if (row.kind === 'action') {
                const parentPerm = row.parent ? perms[row.parent] : null;
                const hasParent = Boolean(parentPerm);
                const isChecked = Boolean(perms[row.key]);
                return (
                  <div key={row.key} style={{ padding: '7px 12px 7px 36px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8, opacity: hasParent ? 1 : 0.4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: disabled || !hasParent ? 'default' : 'pointer', minHeight: 40 }}>
                      <input type="checkbox" style={{ width: 15, height: 15 }} checked={isChecked}
                        disabled={disabled || !hasParent}
                        onChange={e => setAction(row.key, e.target.checked)} />
                      {row.label}
                    </label>
                  </div>
                );
              }
              // 'row' kind
              const cur = perms[row.key];
              const curLevel: 'none' | 'view' | 'edit' = cur ? cur.level : 'none';
              return (
                <div key={row.key} style={{ padding: '7px 12px', borderTop: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: 13, flex: 1, minWidth: 100 }}>{row.label}</span>
                    {!disabled ? (
                      <div style={S.seg}>
                        {(['none', 'view', 'edit'] as const).map(lv => (
                          <button key={lv} style={{ ...S.segBtn, ...(curLevel === lv ? S.segBtnActive : {}) }}
                            onClick={() => setLevel(row.key, lv, row)}>
                            {lv === 'none' ? 'Нет' : lv === 'view' ? 'Просмотр' : 'Изменение'}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {curLevel === 'none' ? 'Нет' : curLevel === 'view' ? 'Просмотр' : 'Изменение'}
                      </span>
                    )}
                    {row.hasSeeAll && cur && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: disabled ? 'default' : 'pointer', minHeight: 40 }}>
                        <input type="checkbox" checked={cur.see_all} disabled={disabled}
                          onChange={e => setSeeAll(row.key, e.target.checked)} style={{ width: 14, height: 14 }} />
                        Видит всех
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Position detail ────────────────────────────────────────────────────────────

function PositionDetail({ pos, catalog, allPositions, onRefresh, onClose }: {
  pos: Position | 'new'; catalog: PermBlock[]; allPositions: Position[];
  onRefresh: () => void; onClose?: () => void;
}) {
  const isNew = pos === 'new';
  const posObj = isNew ? null : pos as Position;
  const [name, setName] = useState(posObj?.name ?? '');
  const [desc, setDesc] = useState(posObj?.description ?? '');
  const [perms, setPerms] = useState<PermMap>({});
  const [search, setSearch] = useState('');
  const [err, setErr] = useState('');
  const [permsSaving, setPermsSaving] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const loadPerms = useCallback(async () => {
    if (isNew || !posObj) return;
    const r = await api('GET', `/api/positions/${posObj.id}/permissions`);
    if (r.ok) setPerms(permArrayToMap(r.data as PermEntry[]));
  }, [isNew, posObj]);

  useEffect(() => { loadPerms(); }, [loadPerms]);

  async function save() {
    setErr('');
    if (!name.trim()) { setErr('Название обязательно'); return; }
    if (isNew) {
      const r = await api('POST', '/api/positions', { name: name.trim(), description: desc.trim() || undefined });
      if (!r.ok) { setErr(r.data.error || 'Ошибка'); return; }
      onRefresh(); onClose?.();
    } else {
      const r = await api('PATCH', `/api/positions/${posObj!.id}`, { name: name.trim(), description: desc.trim() || null });
      if (!r.ok) { setErr(r.data.error || 'Ошибка'); return; }
      onRefresh();
    }
  }

  async function savePerms() {
    if (!posObj) return;
    setPermsSaving(true);
    const r = await api('PUT', `/api/positions/${posObj.id}/permissions`, permMapToArray(perms));
    setPermsSaving(false);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
  }

  async function resetToPreset() {
    if (!posObj) return;
    const r = await api('POST', `/api/positions/${posObj.id}/reset`);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
    await loadPerms();
    setConfirm(null);
  }

  async function doCopy() {
    if (!copyFrom || !posObj) return;
    const r = await api('POST', `/api/positions/${posObj.id}/copy-perms`, { from_position_id: copyFrom });
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
    await loadPerms(); setCopyFrom('');
  }

  async function archive(v: boolean) {
    if (!posObj) return;
    const r = await api('PATCH', `/api/positions/${posObj.id}`, { is_archived: v });
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function del() {
    if (!posObj) return;
    if (!confirm) { setConfirm('delete'); return; }
    const r = await api('DELETE', `/api/positions/${posObj.id}`);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); setConfirm(null); return; }
    onRefresh(); onClose?.();
  }

  return (
    <div style={S.content}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
            {isNew ? 'Новая должность' : posObj!.name}
            {!isNew && posObj!.code && <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>готовая</span>}
            {!isNew && posObj!.is_archived && <span style={{ marginLeft: 8, fontSize: 11, background: '#fef2f2', color: '#ef4444', padding: '1px 6px', borderRadius: 10 }}>архив</span>}
          </div>
          {!isNew && <div style={{ fontSize: 12, color: '#64748b' }}>{posObj!.employee_count} сотр.</div>}
        </div>
        {onClose && <button style={{ ...S.btn, ...S.btnSecondary }} onClick={onClose}>✕</button>}
      </div>

      <div style={S.section}>
        <label style={S.label}>Название *</label>
        <input style={{ ...S.input, marginBottom: 8 }} value={name} onChange={e => setName(e.target.value)} />
        <label style={S.label}>Описание</label>
        <textarea style={{ ...S.input, height: 60, resize: 'vertical' }} value={desc} onChange={e => setDesc(e.target.value)} />
        {err && <div style={S.err}>{err}</div>}
        <button style={{ ...S.btn, ...S.btnPrimary, marginTop: 10 }} onClick={save}>
          {isNew ? 'Создать' : 'Сохранить название'}
        </button>
      </div>

      {!isNew && (
        <>
          <div style={S.divider} />
          <div style={S.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' as const, gap: 8 }}>
              <div style={S.sectionTitle}>Права должности</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                <select style={{ ...S.select, width: 160, fontSize: 12, padding: '5px 8px' }}
                  value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
                  <option value="">Скопировать с…</option>
                  {allPositions.filter(p => p.id !== posObj!.id).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {copyFrom && <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={doCopy}>Скопировать</button>}
                {posObj!.code && (
                  confirm === 'reset'
                    ? <><button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={resetToPreset}>Да, сбросить</button>
                        <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={() => setConfirm(null)}>Отмена</button></>
                    : <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={() => setConfirm('reset')}>Сбросить к стандарту</button>
                )}
                <button style={{ ...S.btn, ...S.btnPrimary, fontSize: 12 }} disabled={permsSaving} onClick={savePerms}>
                  {permsSaving ? 'Сохраняю…' : 'Сохранить права'}
                </button>
              </div>
            </div>
            <input style={{ ...S.search, marginBottom: 10 }} placeholder="Поиск…" value={search} onChange={e => setSearch(e.target.value)} />
            <PermTree catalog={catalog} perms={perms} onChange={setPerms} search={search} />
          </div>

          <div style={S.divider} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
            {posObj!.is_archived
              ? <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={() => archive(false)}>Вернуть из архива</button>
              : <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={() => archive(true)}>В архив</button>}
            {!posObj!.code && posObj!.employee_count === 0 && (
              confirm === 'delete'
                ? <><button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={del}>Да, удалить</button>
                    <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={() => setConfirm(null)}>Отмена</button></>
                : <button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={del}>Удалить</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Staff detail ───────────────────────────────────────────────────────────────

function StaffDetail({ member, catalog, allStaff, positions, positionsLoaded, onRefresh, isAdmin }: {
  member: StaffMember; catalog: PermBlock[]; allStaff: StaffMember[];
  positions: Position[]; positionsLoaded: boolean; onRefresh: () => void; isAdmin: boolean;
}) {
  const isAdminMember = member.role === 'admin';
  const isFired = !member.is_active;
  const [form, setForm] = useState({ display_name: member.display_name, phone: member.phone ?? '', login: member.login, role: member.role, position_id: member.position_id ?? '' });
  const [customPerms, setCustomPerms] = useState(member.custom_permissions);
  const [perms, setPerms] = useState<PermMap>({});
  const [posPerms, setPosPerms] = useState<PermMap>({});
  const [permsSaving, setPermsSaving] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwErr, setPwErr] = useState('');
  const [editErr, setEditErr] = useState('');
  const [logEntries, setLogEntries] = useState<LoginLogEntry[] | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [permSearch, setPermSearch] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const loadPerms = useCallback(async () => {
    // Load user's custom perms
    const r = await api('GET', `/api/staff/${member.id}/permissions`);
    if (r.ok) setPerms(permArrayToMap(r.data as PermEntry[]));
    // Load position perms for display when custom_permissions=false
    if (member.position_id) {
      const rp = await api('GET', `/api/positions/${member.position_id}/permissions`);
      if (rp.ok) setPosPerms(permArrayToMap(rp.data as PermEntry[]));
    } else {
      setPosPerms({});
    }
  }, [member.id, member.position_id]);

  useEffect(() => {
    setForm({ display_name: member.display_name, phone: member.phone ?? '', login: member.login, role: member.role, position_id: member.position_id ?? '' });
    setCustomPerms(member.custom_permissions);
    setNewPw(''); setPwErr(''); setEditErr(''); setShowLog(false); setLogEntries(null); setConfirm(null);
    loadPerms();
  }, [member.id, loadPerms]);

  async function saveProfile() {
    setEditErr('');
    const body: Record<string, unknown> = { display_name: form.display_name, phone: form.phone || null, login: form.login };
    if (isAdmin) body.role = form.role;
    if (form.role !== 'admin' && positionsLoaded) body.position_id = form.position_id || null;
    const r = await api('PATCH', `/api/staff/${member.id}`, body);
    if (!r.ok) { setEditErr(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function changePassword() {
    setPwErr('');
    if (!newPw) { setPwErr('Введите пароль'); return; }
    const r = await api('POST', `/api/staff/${member.id}/password`, { password: newPw });
    if (!r.ok) { setPwErr(r.data.error || 'Ошибка'); return; }
    setNewPw('');
  }

  async function toggleCustomPerms(enable: boolean) {
    if (enable) {
      // Copy position perms to user perms and enable custom
      const r = await api('POST', `/api/staff/${member.id}/permissions/copy-from-position`);
      if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
      setCustomPerms(true); await loadPerms();
    } else {
      if (!confirm) { setConfirm('disable-custom'); return; }
      setConfirm(null);
      const r = await api('DELETE', `/api/staff/${member.id}/permissions`);
      if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
      setCustomPerms(false); await loadPerms();
    }
  }

  async function savePerms() {
    setPermsSaving(true);
    const r = await api('PUT', `/api/staff/${member.id}/permissions`, permMapToArray(perms));
    setPermsSaving(false);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
  }

  async function doCopyPerms() {
    if (!copyFrom) return;
    const r = await api('POST', `/api/staff/${member.id}/permissions/copy`, { from_user_id: copyFrom });
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
    await loadPerms(); setCopyFrom('');
  }

  async function fire() {
    if (!confirm) { setConfirm('fire'); return; }
    setConfirm(null);
    const r = await api('POST', `/api/staff/${member.id}/fire`);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function restore() {
    const r = await api('DELETE', `/api/staff/${member.id}/fire`);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function del() {
    if (!confirm) { setConfirm('delete'); return; }
    setConfirm(null);
    const r = await api('DELETE', `/api/staff/${member.id}`);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
    onRefresh();
  }

  async function logoutAll() {
    if (!confirm) { setConfirm('logout'); return; }
    setConfirm(null);
    const r = await api('POST', `/api/staff/${member.id}/logout-all`);
    if (!r.ok) { toast.error(r.data.error || 'Ошибка'); return; }
  }

  async function loadLog() {
    if (logEntries) { setShowLog(v => !v); return; }
    const r = await api('GET', `/api/staff/${member.id}/login-log`);
    if (r.ok) { setLogEntries(r.data as LoginLogEntry[]); setShowLog(true); }
  }

  const posObj = positions.find(p => p.id === form.position_id);
  const displayPerms = customPerms ? perms : posPerms;
  const permsDisabled = !customPerms || isFired;

  return (
    <div style={S.content}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' as const }}>
        <div style={{ ...S.avatar, width: 40, height: 40, fontSize: 16 }}>{member.display_name[0]?.toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{member.display_name}</div>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            @{member.login}
            {isFired && <span style={{ marginLeft: 8, fontSize: 11, background: '#fef2f2', color: '#ef4444', padding: '1px 6px', borderRadius: 10 }}>Уволен</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 11 }} onClick={loadLog}>Журнал</button>
          {confirm === 'logout'
            ? <><button style={{ ...S.btn, ...S.btnDanger, fontSize: 11 }} onClick={logoutAll}>Да, завершить</button>
                <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 11 }} onClick={() => setConfirm(null)}>Отмена</button></>
            : <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 11 }} onClick={logoutAll}>Выйти со всех</button>}
          {isFired
            ? <button style={{ ...S.btn, ...S.btnPrimary, fontSize: 11 }} onClick={restore}>Восстановить</button>
            : (confirm === 'fire'
              ? <><button style={{ ...S.btn, ...S.btnDanger, fontSize: 11 }} onClick={fire}>Да, уволить</button>
                  <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 11 }} onClick={() => setConfirm(null)}>Отмена</button></>
              : <button style={{ ...S.btn, ...S.btnDanger, fontSize: 11 }} onClick={fire}>Уволить</button>)}
        </div>
      </div>

      {showLog && logEntries && (
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Журнал входов (последние 30)</div>
          {logEntries.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12 }}>Нет записей</div>}
          {logEntries.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: e.ok ? '#16a34a' : '#ef4444', fontWeight: 700 }}>{e.ok ? '✓' : '✗'}</span>
              <span style={{ color: '#64748b' }}>{fmtDate(e.created_at)}</span>
              <span>{e.ip}</span>
              {e.reason && <span style={{ color: '#ef4444' }}>{e.reason}</span>}
            </div>
          ))}
        </div>
      )}

      <div style={S.section}>
        <div style={S.sectionTitle}>Профиль</div>
        <div style={S.row}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={S.label}>Имя *</label>
            <input style={S.input} value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={S.label}>Телефон</label>
            <input style={S.input} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
        </div>
        <div style={S.row}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label style={S.label}>Логин</label>
            <input style={S.input} value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} />
          </div>
          {isAdmin && (
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={S.label}>Роль</label>
              <select style={S.select} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'admin' | 'manager' }))}>
                <option value="manager">Сотрудник</option>
                <option value="admin">Админ</option>
              </select>
            </div>
          )}
          {form.role !== 'admin' && (
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={S.label}>Должность</label>
              <select style={S.select} value={form.position_id} onChange={e => setForm(f => ({ ...f, position_id: e.target.value }))}>
                <option value="">— не задана —</option>
                {positions.filter(p => !p.is_archived || p.id === member.position_id).map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.is_archived ? ' (архив)' : ''}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        {editErr && <div style={S.err}>{editErr}</div>}
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={saveProfile}>Сохранить</button>
        <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>Последний вход: {fmtDate(member.last_login_at)}</div>
      </div>

      <div style={S.divider} />

      <div style={S.section}>
        <div style={S.sectionTitle}>Пароль</div>
        <div style={S.row}>
          <div style={{ flex: 1 }}>
            <input style={{ ...S.input, fontFamily: 'inherit' }} type={showPw ? 'text' : 'password'} value={newPw}
              onChange={e => setNewPw(e.target.value)} placeholder="Новый пароль (мин. 6 симв.)" />
          </div>
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setShowPw(v => !v)}>{showPw ? '👁' : '👁‍🗨'}</button>
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={changePassword}>Задать</button>
        </div>
        {pwErr && <div style={S.err}>{pwErr}</div>}
      </div>

      <div style={S.divider} />

      {/* Permissions */}
      {!isAdminMember ? (
        <div style={S.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' as const, gap: 8 }}>
            <div style={S.sectionTitle}>Права доступа</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', userSelect: 'none' as const }}>
                <input type="checkbox" checked={customPerms}
                  onChange={e => toggleCustomPerms(e.target.checked)} style={{ width: 14, height: 14 }} />
                Свои права
              </label>
              {customPerms && (
                <>
                  <select style={{ ...S.select, width: 150, fontSize: 12, padding: '5px 8px' }}
                    value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
                    <option value="">Скопировать с…</option>
                    {allStaff.filter(s => s.id !== member.id && s.role === 'manager').map(s => (
                      <option key={s.id} value={s.id}>{s.display_name}</option>
                    ))}
                  </select>
                  {copyFrom && <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={doCopyPerms}>Скопировать</button>}
                  <button style={{ ...S.btn, ...S.btnPrimary, fontSize: 12 }} disabled={permsSaving || isFired} onClick={savePerms}>
                    {permsSaving ? 'Сохраняю…' : 'Сохранить'}
                  </button>
                </>
              )}
            </div>
          </div>
          {confirm === 'disable-custom' && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 13 }}>
              Индивидуальные права будут удалены, сотрудник получит права должности.
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={() => toggleCustomPerms(false)}>Да, отключить</button>
                <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={() => setConfirm(null)}>Отмена</button>
              </div>
            </div>
          )}
          {!customPerms && posObj && (
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, padding: '6px 10px', background: '#f8fafc', borderRadius: 6 }}>
              Права должности «{posObj.name}». Изменить — в Должностях или включите «Свои права».
            </div>
          )}
          {!customPerms && !posObj && (!form.position_id || positionsLoaded) && (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>Должность не задана — нет доступа ни к чему.</div>
          )}
          {!customPerms && !posObj && form.position_id && !positionsLoaded && (
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Загрузка…</div>
          )}
          <input style={{ ...S.search, marginBottom: 8 }} placeholder="Поиск…" value={permSearch} onChange={e => setPermSearch(e.target.value)} />
          <PermTree catalog={catalog} perms={displayPerms} onChange={customPerms ? setPerms : () => {}} disabled={permsDisabled} search={permSearch} />
        </div>
      ) : (
        <div style={{ color: '#64748b', fontSize: 13, fontStyle: 'italic', marginBottom: 16 }}>Администратор — полный доступ ко всему.</div>
      )}

      <div style={S.divider} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
        {confirm === 'delete'
          ? <><button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={del}>Да, удалить навсегда</button>
              <button style={{ ...S.btn, ...S.btnSecondary, fontSize: 12 }} onClick={() => setConfirm(null)}>Отмена</button></>
          : <button style={{ ...S.btn, ...S.btnDanger, fontSize: 12 }} onClick={del}>Удалить</button>}
      </div>
    </div>
  );
}

// ── Main StaffPage ─────────────────────────────────────────────────────────────

export default function StaffPage() {
  const role = useRole();
  const isAdmin = role === 'admin';
  const [activeTab, setActiveTab] = useState<'staff' | 'positions'>('staff');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoaded, setPositionsLoaded] = useState(false);
  const [catalog, setCatalog] = useState<PermBlock[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPos, setSelectedPos] = useState<string | 'new' | null>(null);
  const [showFired, setShowFired] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ login: '', display_name: '', role: 'manager', phone: '', password: '', position_id: '' });
  const [createErr, setCreateErr] = useState('');
  const [creating, setCreating] = useState(false);

  const loadStaff = useCallback(async () => {
    const r = await api('GET', '/api/staff');
    if (r.ok) setStaff(r.data as StaffMember[]);
  }, []);

  const loadPositions = useCallback(async () => {
    const r = await api('GET', '/api/positions');
    if (r.ok) setPositions(r.data as Position[]);
    setPositionsLoaded(true);
  }, []);

  useEffect(() => {
    loadStaff();
    loadPositions(); // server enforces admin-only; non-admins get 403, positions stay []
    api('GET', '/api/permissions/catalog').then(r => { if (r.ok) setCatalog(r.data as PermBlock[]); });
  }, [loadStaff, loadPositions]);

  const visibleStaff = useMemo(() => {
    let list = staff.filter(s => showFired ? true : s.is_active);
    if (staffSearch.trim()) {
      const q = staffSearch.toLowerCase();
      list = list.filter(s => s.display_name.toLowerCase().includes(q) || s.login.toLowerCase().includes(q));
    }
    return list;
  }, [staff, showFired, staffSearch]);

  const selectedMember = staff.find(s => s.id === selected);
  const selectedPosition = selectedPos === 'new' ? 'new' : positions.find(p => p.id === selectedPos);

  async function doCreate() {
    setCreateErr('');
    if (!createForm.login || !createForm.display_name || !createForm.password) { setCreateErr('Заполните обязательные поля'); return; }
    setCreating(true);
    const r = await api('POST', '/api/staff', createForm);
    setCreating(false);
    if (!r.ok) { setCreateErr(r.data.error || 'Ошибка'); return; }
    setShowCreate(false); setCreateForm({ login: '', display_name: '', role: 'manager', phone: '', password: '', position_id: '' });
    await loadStaff();
    setSelected(r.data.id);
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;

  if (role === '') return <div style={{ padding: 24, color: '#64748b', fontSize: 14 }}>Загрузка…</div>;

  return (
    <div style={{ ...S.root, flexDirection: isMobile ? 'column' : 'row' }}>
      {/* Left panel */}
      <div style={{ ...S.list, width: isMobile ? '100%' : 260, height: isMobile ? 'auto' : '100%', flexShrink: 0 }}>
        <div style={S.listHead}>
          <div style={S.listTitle}>Сотрудники</div>
          {isAdmin && (
            <div style={S.tabs}>
              <button style={{ ...S.tabBtn, background: activeTab === 'staff' ? '#02BDB6' : '#f1f5f9', color: activeTab === 'staff' ? '#fff' : '#374151' }}
                onClick={() => setActiveTab('staff')}>Сотрудники</button>
              <button style={{ ...S.tabBtn, background: activeTab === 'positions' ? '#02BDB6' : '#f1f5f9', color: activeTab === 'positions' ? '#fff' : '#374151' }}
                onClick={() => setActiveTab('positions')}>Должности</button>
            </div>
          )}
          <button style={{ ...S.addBtn, marginBottom: 8 }} onClick={() => activeTab === 'staff' ? setShowCreate(true) : setSelectedPos('new')}>
            {activeTab === 'staff' ? '+ Сотрудник' : '+ Должность'}
          </button>
          {activeTab === 'staff' && (
            <>
              <input style={{ ...S.search, marginBottom: 6 }} placeholder="Поиск…" value={staffSearch} onChange={e => setStaffSearch(e.target.value)} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b', cursor: 'pointer' }}>
                <input type="checkbox" checked={showFired} onChange={e => setShowFired(e.target.checked)} />
                Показать уволенных
              </label>
            </>
          )}
        </div>
        <div style={S.listItems}>
          {activeTab === 'staff' && visibleStaff.map(s => (
            <div key={s.id} style={{ ...S.listItem, ...(selected === s.id ? S.listItemActive : {}), opacity: s.is_active ? 1 : 0.5 }}
              onClick={() => { setSelected(s.id); setSelectedPos(null); }}>
              <div style={S.avatar}>{s.display_name[0]?.toUpperCase()}</div>
              <div style={{ overflow: 'hidden', flex: 1 }}>
                <div style={S.itemName}>{s.display_name}</div>
                <div style={S.itemSub}>{s.position_name || (s.role === 'admin' ? '⭐ Админ' : 'нет должности')}</div>
              </div>
            </div>
          ))}
          {activeTab === 'staff' && visibleStaff.length === 0 && (
            <div style={{ padding: '16px 14px', color: '#94a3b8', fontSize: 12 }}>Нет сотрудников</div>
          )}
          {activeTab === 'positions' && positions.map(p => (
            <div key={p.id} style={{ ...S.listItem, ...(selectedPos === p.id ? S.listItemActive : {}), opacity: p.is_archived ? 0.5 : 1 }}
              onClick={() => { setSelectedPos(p.id); setSelected(null); }}>
              <span style={{ fontSize: 20 }}>💼</span>
              <div style={{ overflow: 'hidden', flex: 1 }}>
                <div style={S.itemName}>{p.name}{p.code ? ' ★' : ''}</div>
                <div style={S.itemSub}>{p.employee_count} сотр.{p.is_archived ? ' · архив' : ''}</div>
              </div>
            </div>
          ))}
          {activeTab === 'positions' && positions.length === 0 && (
            <div style={{ padding: '16px 14px', color: '#94a3b8', fontSize: 12 }}>Нет должностей</div>
          )}
        </div>
      </div>

      {/* Right panel */}
      {activeTab === 'staff' && selectedMember && (
        <StaffDetail key={selectedMember.id} member={selectedMember} catalog={catalog} allStaff={staff}
          positions={positions} positionsLoaded={positionsLoaded} onRefresh={loadStaff} isAdmin={isAdmin} />
      )}
      {activeTab === 'staff' && !selectedMember && (
        <div style={S.empty}>Выберите сотрудника</div>
      )}
      {activeTab === 'positions' && selectedPosition && (
        <PositionDetail key={selectedPos ?? 'new'} pos={selectedPosition}
          catalog={catalog} allPositions={positions}
          onRefresh={async () => { await loadPositions(); }}
          onClose={selectedPos === 'new' ? () => setSelectedPos(null) : undefined} />
      )}
      {activeTab === 'positions' && !selectedPosition && (
        <div style={S.empty}>Выберите должность</div>
      )}

      {/* Create staff modal */}
      {showCreate && (
        <div style={S.overlay} onClick={() => setShowCreate(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Новый сотрудник</h3>
            {[
              ['Логин *', 'login', 'vera_ivanova', 'text'],
              ['Имя *', 'display_name', 'Вера', 'text'],
              ['Телефон', 'phone', '+7…', 'text'],
              ['Пароль *', 'password', '', 'password'],
            ].map(([lbl, fld, ph, tp]) => (
              <div key={fld} style={{ marginBottom: 8 }}>
                <label style={S.label}>{lbl}</label>
                <input style={S.input} type={tp as string} placeholder={ph as string}
                  value={(createForm as any)[fld as string]}
                  onChange={e => setCreateForm(f => ({ ...f, [fld as string]: e.target.value }))}
                  autoFocus={fld === 'login'} />
              </div>
            ))}
            {isAdmin && (
              <div style={{ marginBottom: 8 }}>
                <label style={S.label}>Роль</label>
                <select style={S.select} value={createForm.role} onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="manager">Сотрудник</option>
                  <option value="admin">Админ</option>
                </select>
              </div>
            )}
            {createForm.role !== 'admin' && (
              <div style={{ marginBottom: 8 }}>
                <label style={S.label}>Должность</label>
                <select style={S.select} value={createForm.position_id} onChange={e => setCreateForm(f => ({ ...f, position_id: e.target.value }))}>
                  <option value="">— не задана —</option>
                  {positions.filter(p => !p.is_archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {createErr && <div style={S.err}>{createErr}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button style={{ ...S.btn, ...S.btnSecondary }} onClick={() => setShowCreate(false)}>Отмена</button>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={doCreate} disabled={creating}>
                {creating ? 'Создаю…' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
