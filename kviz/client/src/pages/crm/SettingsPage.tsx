import { useState, useEffect, useRef, useCallback } from 'react';
import { parseLookinBodyCSV } from '../../utils/parseLookinBodyCSV';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DeviceType { code: string; name: string; sort: number }
interface Device { id: string; branch_id: string; type_code: string; number: string; default_phase: number | null; session_minutes: number | null; status: string; notes: string | null }
interface Plan { id: string; kind: string; name: string; description: string | null; price: number; is_promo: boolean; is_free_booking: boolean; validity_days: number | null; extra_days: number | null; freeze_days: number | null; guest_visits: number | null; auto_activate_days: number | null; max_deferred_start_days: number | null; is_active: boolean; sort: number }
interface PlanItem { id: string; plan_id: string; device_type_code: string; phase: number | null; sessions: number; sort: number }
interface Supplier { id: string; name: string; phone: string | null; notes: string | null; is_active: boolean }
interface Product { id: string; name: string; barcode: string | null; is_active: boolean; stock: number; retail_price: number | null }
interface Supply { id: string; product_id: string; supplier_id: string | null; quantity: number; remaining: number; purchase_price: number; retail_price: number | null; supplied_at: string; notes: string | null; created_by: string }
interface PromoCode { id: string; code: string; discount_type: string; discount_value: number; max_uses: number | null; max_uses_per_client: number | null; uses_count: number; expires_at: string | null; applies_to_all: boolean; is_active: boolean }
interface PaymentMethod { id: string; name: string; kind: string; is_system: boolean; is_active: boolean; sort: number }
interface AdSource { id: string; name: string; requires_referrer: boolean; is_active: boolean; sort: number }

type Section = 'devices' | 'abonements' | 'services' | 'products' | 'suppliers' | 'promos' | 'payments' | 'sources' | 'classes' | 'service';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}

function fmtPrice(n: number) { return n.toLocaleString('ru-RU') + ' ₸'; }

// ── Shared modal ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button style={S.iconBtn} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

// ── Device Types & Devices ─────────────────────────────────────────────────────

function DevicesSection() {
  const [types, setTypes]   = useState<DeviceType[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [editType, setEditType]   = useState<DeviceType | null | 'new'>(null);
  const [editDevice, setEditDevice] = useState<Device | null | 'new'>(null);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [t, d] = await Promise.all([
      fetch('/kviz/api/crm/device-types', { credentials: 'include' }).then(r => r.json()),
      fetch('/kviz/api/crm/devices', { credentials: 'include' }).then(r => r.json()),
    ]);
    setTypes(Array.isArray(t) ? t : []);
    setDevices(Array.isArray(d) ? d : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveType(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = { code: fd.get('code'), name: fd.get('name'), sort: Number(fd.get('sort') || 0) };
    const url = editType === 'new' ? '/kviz/api/crm/device-types' : `/kviz/api/crm/device-types/${(editType as DeviceType).code}`;
    const method = editType === 'new' ? 'POST' : 'PATCH';
    const { ok, data } = await api(method, url, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditType(null); load();
  }

  async function deleteType(code: string) {
    if (!confirm('Удалить тип аппарата?')) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/device-types/${code}`);
    if (!ok) { alert(data.error || 'Ошибка'); return; }
    load();
  }

  async function saveDevice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = { type_code: fd.get('type_code'), number: fd.get('number'), default_phase: fd.get('default_phase') || null, session_minutes: fd.get('session_minutes') || null, status: fd.get('status'), notes: fd.get('notes') || null };
    const url = editDevice === 'new' ? '/kviz/api/crm/devices' : `/kviz/api/crm/devices/${(editDevice as Device).id}`;
    const method = editDevice === 'new' ? 'POST' : 'PATCH';
    const { ok, data } = await api(method, url, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditDevice(null); load();
  }

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Типы аппаратов</span>
        <button style={S.addBtn} onClick={() => setEditType('new')}>+ Добавить</button>
      </div>
      <div style={S.list}>
        {types.map(t => (
          <div key={t.code} style={S.row}>
            <span style={{ fontWeight: 600 }}>{t.name}</span>
            <span style={S.meta}>код: {t.code} · порядок: {t.sort}</span>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEditType(t)}>✎</button>
              <button style={S.delBtn} onClick={() => deleteType(t.code)}>✕</button>
            </div>
          </div>
        ))}
        {!types.length && <div style={S.empty}>Типы не добавлены</div>}
      </div>

      <div style={{ ...S.subheader, marginTop: 24 }}>
        <span style={S.subTitle}>Аппараты</span>
        <button style={S.addBtn} onClick={() => setEditDevice('new')}>+ Добавить</button>
      </div>
      <div style={S.list}>
        {devices.map(d => (
          <div key={d.id} style={S.row}>
            <span style={{ fontWeight: 600 }}>#{d.number}</span>
            <span style={S.meta}>{d.type_code}{d.session_minutes ? ` · ${d.session_minutes} мин` : ''} · {d.status}</span>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEditDevice(d)}>✎</button>
            </div>
          </div>
        ))}
        {!devices.length && <div style={S.empty}>Аппараты не добавлены</div>}
      </div>

      {editType && (
        <Modal title={editType === 'new' ? 'Новый тип' : 'Редактировать тип'} onClose={() => { setEditType(null); setErr(''); }}>
          <form onSubmit={saveType}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Код (уникальный)">
              <input style={S.inp} name="code" required defaultValue={editType === 'new' ? '' : (editType as DeviceType).code} readOnly={editType !== 'new'} />
            </Field>
            <Field label="Название">
              <input style={S.inp} name="name" required defaultValue={editType === 'new' ? '' : (editType as DeviceType).name} />
            </Field>
            <Field label="Порядок">
              <input style={S.inp} name="sort" type="number" defaultValue={editType === 'new' ? 0 : (editType as DeviceType).sort} />
            </Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditType(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}

      {editDevice && (
        <Modal title={editDevice === 'new' ? 'Новый аппарат' : 'Редактировать аппарат'} onClose={() => { setEditDevice(null); setErr(''); }}>
          <form onSubmit={saveDevice}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Тип">
              <select style={S.inp} name="type_code" required defaultValue={editDevice === 'new' ? '' : (editDevice as Device).type_code}>
                <option value="">— выбрать —</option>
                {types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Номер">
              <input style={S.inp} name="number" required defaultValue={editDevice === 'new' ? '' : (editDevice as Device).number} />
            </Field>
            <Field label="Фаза по умолчанию">
              <input style={S.inp} name="default_phase" type="number" defaultValue={editDevice === 'new' ? '' : ((editDevice as Device).default_phase ?? '')} />
            </Field>
            <Field label="Минут сеанса">
              <input style={S.inp} name="session_minutes" type="number" defaultValue={editDevice === 'new' ? '' : ((editDevice as Device).session_minutes ?? '')} />
            </Field>
            <Field label="Статус">
              <select style={S.inp} name="status" defaultValue={editDevice === 'new' ? 'active' : (editDevice as Device).status}>
                <option value="active">Активен</option>
                <option value="inactive">Неактивен</option>
                <option value="maintenance">На обслуживании</option>
              </select>
            </Field>
            <Field label="Заметки">
              <input style={S.inp} name="notes" defaultValue={editDevice === 'new' ? '' : ((editDevice as Device).notes ?? '')} />
            </Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditDevice(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Plans (abonements or services) ─────────────────────────────────────────────

function PlansSection({ kind }: { kind: 'abonement' | 'service' }) {
  const [plans, setPlans]   = useState<Plan[]>([]);
  const [items, setItems]   = useState<Record<string, PlanItem[]>>({});
  const [types, setTypes]   = useState<DeviceType[]>([]);
  const [editPlan, setEditPlan]   = useState<Plan | null | 'new'>(null);
  const [editItem, setEditItem]   = useState<{ planId: string; item: PlanItem | 'new' } | null>(null);
  const [openItems, setOpenItems] = useState<string | null>(null);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([
      fetch(`/kviz/api/crm/plans?kind=${kind}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/kviz/api/crm/device-types', { credentials: 'include' }).then(r => r.json()),
    ]);
    setPlans(Array.isArray(p) ? p : []);
    setTypes(Array.isArray(t) ? t : []);
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  async function loadItems(planId: string) {
    const d = await fetch(`/kviz/api/crm/plans/${planId}/items`, { credentials: 'include' }).then(r => r.json());
    setItems(prev => ({ ...prev, [planId]: Array.isArray(d) ? d : [] }));
  }

  async function toggleItems(planId: string) {
    if (openItems === planId) { setOpenItems(null); return; }
    setOpenItems(planId);
    if (!items[planId]) await loadItems(planId);
  }

  async function savePlan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      kind, name: fd.get('name'), description: fd.get('description') || null,
      price: Number(fd.get('price') || 0), is_promo: fd.get('is_promo') === 'on',
      is_free_booking: fd.get('is_free_booking') === 'on',
      validity_days: fd.get('validity_days') || null, extra_days: fd.get('extra_days') || null,
      freeze_days: fd.get('freeze_days') || null, guest_visits: fd.get('guest_visits') || null,
      sort: Number(fd.get('sort') || 0),
    };
    if (editPlan !== 'new') body.is_active = fd.get('is_active') === 'on';
    const url = editPlan === 'new' ? '/kviz/api/crm/plans' : `/kviz/api/crm/plans/${(editPlan as Plan).id}`;
    const method = editPlan === 'new' ? 'POST' : 'PATCH';
    const { ok, data } = await api(method, url, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditPlan(null); load();
  }

  async function saveItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editItem) return;
    setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = { device_type_code: fd.get('device_type_code'), phase: fd.get('phase') || null, sessions: Number(fd.get('sessions') || 0), sort: Number(fd.get('sort') || 0) };
    let ok: boolean, data: Record<string, unknown>;
    if (editItem.item === 'new') {
      ({ ok, data } = await api('POST', `/kviz/api/crm/plans/${editItem.planId}/items`, body));
    } else {
      ({ ok, data } = await api('PATCH', `/kviz/api/crm/plan-items/${(editItem.item as PlanItem).id}`, body));
    }
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditItem(null); loadItems(editItem.planId);
  }

  async function deleteItem(planId: string, itemId: string) {
    if (!confirm('Удалить позицию?')) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/plan-items/${itemId}`);
    if (!ok) { alert(data.error || 'Ошибка'); return; }
    loadItems(planId);
  }

  const title = kind === 'abonement' ? 'Абонементы' : 'Услуги';

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>{title}</span>
        <button style={S.addBtn} onClick={() => setEditPlan('new')}>+ Добавить</button>
      </div>
      <div style={S.list}>
        {plans.map(p => (
          <div key={p.id}>
            <div style={S.row}>
              <div>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {!p.is_active && <span style={S.badge}>архив</span>}
                <span style={S.meta}>{fmtPrice(p.price)}{p.validity_days ? ` · ${p.validity_days} дн` : ''}</span>
              </div>
              <div style={S.rowActions}>
                {kind === 'abonement' && (
                  <button style={S.editBtn} onClick={() => toggleItems(p.id)}>
                    {openItems === p.id ? '▲' : '▼'} позиции
                  </button>
                )}
                <button style={S.editBtn} onClick={() => setEditPlan(p)}>✎</button>
              </div>
            </div>
            {openItems === p.id && kind === 'abonement' && (
              <div style={{ paddingLeft: 16, paddingBottom: 8, background: '#f8fafc', borderRadius: 8, marginBottom: 4 }}>
                {(items[p.id] || []).map(it => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <span>{types.find(t => t.code === it.device_type_code)?.name ?? it.device_type_code}</span>
                    {it.phase != null && <span style={S.meta}>фаза {it.phase}</span>}
                    <span style={S.meta}>{it.sessions} сеансов</span>
                    <button style={S.editBtn} onClick={() => setEditItem({ planId: p.id, item: it })}>✎</button>
                    <button style={S.delBtn} onClick={() => deleteItem(p.id, it.id)}>✕</button>
                  </div>
                ))}
                {!(items[p.id] || []).length && <div style={S.empty}>Нет позиций</div>}
                <button style={{ ...S.addBtn, marginTop: 6 }} onClick={() => setEditItem({ planId: p.id, item: 'new' })}>+ Позиция</button>
              </div>
            )}
          </div>
        ))}
        {!plans.length && <div style={S.empty}>Нет записей</div>}
      </div>

      {editPlan && (
        <Modal title={editPlan === 'new' ? `Новый ${title.slice(0, -1).toLowerCase()}` : 'Редактировать'} onClose={() => { setEditPlan(null); setErr(''); }}>
          <form onSubmit={savePlan} style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название"><input style={S.inp} name="name" required defaultValue={editPlan === 'new' ? '' : (editPlan as Plan).name} /></Field>
            <Field label="Описание"><textarea style={{ ...S.inp, height: 60, resize: 'vertical' }} name="description" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).description ?? '')} /></Field>
            <Field label="Цена (₸)"><input style={S.inp} name="price" type="number" min="0" defaultValue={editPlan === 'new' ? 0 : (editPlan as Plan).price} /></Field>
            {kind === 'abonement' && <>
              <Field label="Дней действия"><input style={S.inp} name="validity_days" type="number" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).validity_days ?? '')} /></Field>
              <Field label="Бонусных дней"><input style={S.inp} name="extra_days" type="number" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).extra_days ?? '')} /></Field>
              <Field label="Заморозка (дней)"><input style={S.inp} name="freeze_days" type="number" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).freeze_days ?? '')} /></Field>
              <Field label="Гостевых визитов"><input style={S.inp} name="guest_visits" type="number" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).guest_visits ?? '')} /></Field>
            </>}
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" name="is_promo" defaultChecked={editPlan !== 'new' && (editPlan as Plan).is_promo} /> Акционный
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" name="is_free_booking" defaultChecked={editPlan !== 'new' && (editPlan as Plan).is_free_booking} /> Бесплатная запись
              </label>
              {editPlan !== 'new' && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" name="is_active" defaultChecked={(editPlan as Plan).is_active} /> Активен
                </label>
              )}
            </div>
            <Field label="Порядок"><input style={S.inp} name="sort" type="number" defaultValue={editPlan === 'new' ? 0 : (editPlan as Plan).sort} /></Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditPlan(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}

      {editItem && (
        <Modal title={editItem.item === 'new' ? 'Новая позиция' : 'Редактировать позицию'} onClose={() => { setEditItem(null); setErr(''); }}>
          <form onSubmit={saveItem}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Тип аппарата">
              <select style={S.inp} name="device_type_code" required defaultValue={editItem.item === 'new' ? '' : (editItem.item as PlanItem).device_type_code}>
                <option value="">— выбрать —</option>
                {types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Фаза"><input style={S.inp} name="phase" type="number" defaultValue={editItem.item === 'new' ? '' : ((editItem.item as PlanItem).phase ?? '')} /></Field>
            <Field label="Сеансов"><input style={S.inp} name="sessions" type="number" required min="1" defaultValue={editItem.item === 'new' ? '' : (editItem.item as PlanItem).sessions} /></Field>
            <Field label="Порядок"><input style={S.inp} name="sort" type="number" defaultValue={editItem.item === 'new' ? 0 : (editItem.item as PlanItem).sort} /></Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditItem(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Suppliers ──────────────────────────────────────────────────────────────────

function SuppliersSection() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [edit, setEdit] = useState<Supplier | null | 'new'>(null);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/kviz/api/crm/suppliers', { credentials: 'include' }).then(r => r.json());
    setRows(Array.isArray(d) ? d : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = { name: fd.get('name'), phone: fd.get('phone') || null, notes: fd.get('notes') || null };
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH', edit === 'new' ? '/kviz/api/crm/suppliers' : `/kviz/api/crm/suppliers/${(edit as Supplier).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  async function toggle(id: string, active: boolean) {
    await api('PATCH', `/kviz/api/crm/suppliers/${id}`, { is_active: !active });
    load();
  }

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Поставщики</span>
        <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
      </div>
      <div style={S.list}>
        {rows.map(r => (
          <div key={r.id} style={S.row}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {!r.is_active && <span style={S.badge}>неактивен</span>}
              {r.phone && <span style={S.meta}>{r.phone}</span>}
            </div>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>
              <button style={S.editBtn} onClick={() => toggle(r.id, r.is_active)}>{r.is_active ? 'Архив' : 'Вернуть'}</button>
            </div>
          </div>
        ))}
        {!rows.length && <div style={S.empty}>Поставщики не добавлены</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый поставщик' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название"><input style={S.inp} name="name" required defaultValue={edit === 'new' ? '' : (edit as Supplier).name} /></Field>
            <Field label="Телефон"><input style={S.inp} name="phone" defaultValue={edit === 'new' ? '' : ((edit as Supplier).phone ?? '')} /></Field>
            <Field label="Заметки"><textarea style={{ ...S.inp, height: 60, resize: 'vertical' }} name="notes" defaultValue={edit === 'new' ? '' : ((edit as Supplier).notes ?? '')} /></Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEdit(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Products & Stock ───────────────────────────────────────────────────────────

function ProductsSection() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editProd, setEditProd]   = useState<Product | null | 'new'>(null);
  const [supplyFor, setSupplyFor] = useState<Product | null>(null);
  const [supplies, setSupplies]   = useState<Supply[]>([]);
  const [showSupplies, setShowSupplies] = useState<string | null>(null);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      fetch('/kviz/api/crm/products', { credentials: 'include' }).then(r => r.json()),
      fetch('/kviz/api/crm/suppliers', { credentials: 'include' }).then(r => r.json()),
    ]);
    setProducts(Array.isArray(p) ? p : []);
    setSuppliers(Array.isArray(s) ? s.filter((x: Supplier) => x.is_active) : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function loadSupplies(id: string) {
    const d = await fetch(`/kviz/api/crm/products/${id}/supplies`, { credentials: 'include' }).then(r => r.json());
    setSupplies(Array.isArray(d) ? d : []);
    setShowSupplies(id);
  }

  async function saveProd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = { name: fd.get('name'), barcode: fd.get('barcode') || null, is_active: fd.get('is_active') === 'on' };
    const { ok, data } = await api(editProd === 'new' ? 'POST' : 'PATCH', editProd === 'new' ? '/kviz/api/crm/products' : `/kviz/api/crm/products/${(editProd as Product).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditProd(null); load();
  }

  async function saveSupply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supplyFor) return;
    setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = { supplier_id: fd.get('supplier_id') || null, quantity: fd.get('quantity'), purchase_price: fd.get('purchase_price'), retail_price: fd.get('retail_price') || null, supplied_at: fd.get('supplied_at') || null, notes: fd.get('notes') || null };
    const { ok, data } = await api('POST', `/kviz/api/crm/products/${supplyFor.id}/supplies`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setSupplyFor(null); load();
  }

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Товары и склад</span>
        <button style={S.addBtn} onClick={() => setEditProd('new')}>+ Товар</button>
      </div>
      <div style={S.list}>
        {products.map(p => (
          <div key={p.id}>
            <div style={S.row}>
              <div>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {!p.is_active && <span style={S.badge}>архив</span>}
                <span style={S.meta}>склад: {p.stock} шт{p.retail_price ? ` · ${fmtPrice(p.retail_price)}` : ''}</span>
                {p.barcode && <span style={S.meta}>штрих: {p.barcode}</span>}
              </div>
              <div style={S.rowActions}>
                <button style={S.editBtn} onClick={() => setSupplyFor(p)}>+ Поступление</button>
                <button style={S.editBtn} onClick={() => showSupplies === p.id ? setShowSupplies(null) : loadSupplies(p.id)}>История</button>
                <button style={S.editBtn} onClick={() => setEditProd(p)}>✎</button>
              </div>
            </div>
            {showSupplies === p.id && (
              <div style={{ paddingLeft: 12, paddingBottom: 8, fontSize: 12, color: '#64748b' }}>
                {supplies.map(s => (
                  <div key={s.id} style={{ padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
                    {s.supplied_at.slice(0, 10)} · {s.quantity} шт · {fmtPrice(s.purchase_price)}/шт · остаток {s.remaining}
                  </div>
                ))}
                {!supplies.length && <div>Нет поступлений</div>}
              </div>
            )}
          </div>
        ))}
        {!products.length && <div style={S.empty}>Товары не добавлены</div>}
      </div>

      {editProd && (
        <Modal title={editProd === 'new' ? 'Новый товар' : 'Редактировать'} onClose={() => { setEditProd(null); setErr(''); }}>
          <form onSubmit={saveProd}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название"><input style={S.inp} name="name" required defaultValue={editProd === 'new' ? '' : (editProd as Product).name} /></Field>
            <Field label="Штрих-код"><input style={S.inp} name="barcode" defaultValue={editProd === 'new' ? '' : ((editProd as Product).barcode ?? '')} /></Field>
            {editProd !== 'new' && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
                <input type="checkbox" name="is_active" defaultChecked={(editProd as Product).is_active} /> Активен
              </label>
            )}
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditProd(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}

      {supplyFor && (
        <Modal title={`Поступление: ${supplyFor.name}`} onClose={() => { setSupplyFor(null); setErr(''); }}>
          <form onSubmit={saveSupply}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Поставщик">
              <select style={S.inp} name="supplier_id">
                <option value="">— без поставщика —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Количество"><input style={S.inp} name="quantity" type="number" min="1" required /></Field>
            <Field label="Закупочная цена (₸)"><input style={S.inp} name="purchase_price" type="number" min="0" required /></Field>
            <Field label="Розничная цена (₸)"><input style={S.inp} name="retail_price" type="number" min="0" /></Field>
            <Field label="Дата поставки"><input style={S.inp} name="supplied_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Заметки"><input style={S.inp} name="notes" /></Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setSupplyFor(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Добавить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Promo codes ────────────────────────────────────────────────────────────────

function PromoCodesSection() {
  const [rows, setRows] = useState<PromoCode[]>([]);
  const [edit, setEdit] = useState<PromoCode | null | 'new'>(null);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/kviz/api/crm/promo-codes', { credentials: 'include' }).then(r => r.json());
    setRows(Array.isArray(d) ? d : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      code: fd.get('code'), discount_type: fd.get('discount_type'),
      discount_value: Number(fd.get('discount_value') || 0),
      max_uses: fd.get('max_uses') || null, max_uses_per_client: fd.get('max_uses_per_client') || null,
      expires_at: fd.get('expires_at') || null, applies_to_all: fd.get('applies_to_all') === 'on',
    };
    if (edit !== 'new') body.is_active = fd.get('is_active') === 'on';
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH', edit === 'new' ? '/kviz/api/crm/promo-codes' : `/kviz/api/crm/promo-codes/${(edit as PromoCode).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Промокоды</span>
        <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
      </div>
      <div style={S.list}>
        {rows.map(r => (
          <div key={r.id} style={S.row}>
            <div>
              <span style={{ fontWeight: 700, letterSpacing: 1 }}>{r.code}</span>
              {!r.is_active && <span style={S.badge}>неактивен</span>}
              <span style={S.meta}>
                {r.discount_type === 'percent' ? `${r.discount_value}%` : fmtPrice(r.discount_value)}
                {r.uses_count > 0 ? ` · использован ${r.uses_count} раз` : ''}
                {r.expires_at ? ` · до ${r.expires_at.slice(0, 10)}` : ''}
              </span>
            </div>
            <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>
          </div>
        ))}
        {!rows.length && <div style={S.empty}>Промокоды не добавлены</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый промокод' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            {edit === 'new' && <Field label="Код"><input style={S.inp} name="code" required placeholder="PROMO2025" /></Field>}
            <Field label="Тип скидки">
              <select style={S.inp} name="discount_type" defaultValue={edit === 'new' ? 'percent' : (edit as PromoCode).discount_type}>
                <option value="percent">Процент (%)</option>
                <option value="fixed">Фиксированная (₸)</option>
              </select>
            </Field>
            <Field label="Размер скидки"><input style={S.inp} name="discount_value" type="number" min="0" required defaultValue={edit === 'new' ? '' : (edit as PromoCode).discount_value} /></Field>
            <Field label="Макс. использований"><input style={S.inp} name="max_uses" type="number" defaultValue={edit === 'new' ? '' : ((edit as PromoCode).max_uses ?? '')} /></Field>
            <Field label="Макс. на клиента"><input style={S.inp} name="max_uses_per_client" type="number" defaultValue={edit === 'new' ? '' : ((edit as PromoCode).max_uses_per_client ?? '')} /></Field>
            <Field label="Дата окончания"><input style={S.inp} name="expires_at" type="date" defaultValue={edit === 'new' ? '' : ((edit as PromoCode).expires_at?.slice(0, 10) ?? '')} /></Field>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" name="applies_to_all" defaultChecked={edit === 'new' ? true : (edit as PromoCode).applies_to_all} /> На все планы
              </label>
              {edit !== 'new' && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" name="is_active" defaultChecked={(edit as PromoCode).is_active} /> Активен
                </label>
              )}
            </div>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEdit(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Payment methods ────────────────────────────────────────────────────────────

function PaymentMethodsSection() {
  const [rows, setRows] = useState<PaymentMethod[]>([]);
  const [edit, setEdit] = useState<PaymentMethod | null | 'new'>(null);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/kviz/api/crm/payment-methods', { credentials: 'include' }).then(r => r.json());
    setRows(Array.isArray(d) ? d : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { name: fd.get('name'), kind: fd.get('kind'), sort: Number(fd.get('sort') || 0) };
    if (edit !== 'new') body.is_active = fd.get('is_active') === 'on';
    const url = edit === 'new' ? '/kviz/api/crm/payment-methods' : `/kviz/api/crm/payment-methods/${(edit as PaymentMethod).id}`;
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH', url, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Виды оплаты</span>
        <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
      </div>
      <div style={S.list}>
        {rows.map(r => (
          <div key={r.id} style={S.row}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {r.is_system && <span style={{ ...S.badge, background: '#dbeafe', color: '#1d4ed8' }}>системный</span>}
              {!r.is_active && <span style={S.badge}>архив</span>}
              <span style={S.meta}>{r.kind} · порядок {r.sort}</span>
            </div>
            {!r.is_system && <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>}
          </div>
        ))}
        {!rows.length && <div style={S.empty}>Нет записей</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый вид оплаты' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название"><input style={S.inp} name="name" required defaultValue={edit === 'new' ? '' : (edit as PaymentMethod).name} /></Field>
            <Field label="Тип">
              <select style={S.inp} name="kind" defaultValue={edit === 'new' ? 'other' : (edit as PaymentMethod).kind}>
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="other">Другое</option>
              </select>
            </Field>
            <Field label="Порядок"><input style={S.inp} name="sort" type="number" defaultValue={edit === 'new' ? 0 : (edit as PaymentMethod).sort} /></Field>
            {edit !== 'new' && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
                <input type="checkbox" name="is_active" defaultChecked={(edit as PaymentMethod).is_active} /> Активен
              </label>
            )}
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEdit(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Ad sources ─────────────────────────────────────────────────────────────────

function AdSourcesSection() {
  const [rows, setRows] = useState<AdSource[]>([]);
  const [edit, setEdit] = useState<AdSource | null | 'new'>(null);
  const [err, setErr]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/kviz/api/crm/ad-sources', { credentials: 'include' }).then(r => r.json());
    setRows(Array.isArray(d) ? d : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { name: fd.get('name'), requires_referrer: fd.get('requires_referrer') === 'on', sort: Number(fd.get('sort') || 0) };
    if (edit !== 'new') body.is_active = fd.get('is_active') === 'on';
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH', edit === 'new' ? '/kviz/api/crm/ad-sources' : `/kviz/api/crm/ad-sources/${(edit as AdSource).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Рекламные источники</span>
        <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
      </div>
      <div style={S.list}>
        {rows.map(r => (
          <div key={r.id} style={S.row}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {!r.is_active && <span style={S.badge}>архив</span>}
              {r.requires_referrer && <span style={{ ...S.badge, background: '#fef3c7', color: '#92400e' }}>с реферером</span>}
              <span style={S.meta}>порядок {r.sort}</span>
            </div>
            <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>
          </div>
        ))}
        {!rows.length && <div style={S.empty}>Источники не добавлены</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый источник' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название"><input style={S.inp} name="name" required defaultValue={edit === 'new' ? '' : (edit as AdSource).name} /></Field>
            <Field label="Порядок"><input style={S.inp} name="sort" type="number" defaultValue={edit === 'new' ? 0 : (edit as AdSource).sort} /></Field>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" name="requires_referrer" defaultChecked={edit !== 'new' && (edit as AdSource).requires_referrer} /> Требует реферера
              </label>
              {edit !== 'new' && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" name="is_active" defaultChecked={(edit as AdSource).is_active} /> Активен
                </label>
              )}
            </div>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEdit(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Сервис (moved from Reports) ────────────────────────────────────────────────

async function safePost(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data: Record<string, unknown> = {};
  try { data = await r.json(); } catch { data = { error: `HTTP ${r.status}` }; }
  return { ok: r.ok, data };
}

interface IbPreview { total: number; new: number; duplicates: number; linked: number; unlinked: number; unlinked_ids: string[] }
interface IbImportResult { added: number; skipped: number; without_client: number }
interface IbTest { id: string; inbody_id: string; tested_at: string; phone: string | null; weight: number | null }

function InBodySettingsSection() {
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
      if (!ok) { setError(String(data.error || 'Ошибка')); return; }
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
        if (!ok) { setError(String(data.error || 'Ошибка')); return; }
        added += Number(data.added ?? 0); skipped += Number(data.skipped ?? 0); without_client += Number(data.without_client ?? 0);
      }
      setResult({ added, skipped, without_client });
    } catch (e2) { setError(String(e2)); }
    finally { setLoading(false); }
  }

  async function doRecalculate() {
    setLoading(true); setError(''); setRecalc(null);
    try {
      const { ok, data } = await safePost('/kviz/api/inbody/recalculate', {});
      if (!ok) { setError(String(data.error || 'Ошибка')); return; }
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
    block: { background: '#fff', borderRadius: 12, padding: '16px 20px', marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
    title: { fontWeight: 700, fontSize: 15, marginBottom: 12, color: '#1a202c' },
    btn: { padding: '10px 20px', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit', border: 'none', opacity: loading ? 0.7 : 1, width: '100%', marginBottom: 8 },
    tblKey: { padding: '4px 0', color: '#6b7280', fontSize: 13 },
    tblVal: { padding: '4px 0', fontWeight: 700, fontSize: 13 },
  };

  return (
    <div style={{ ...S.section, maxWidth: 560 }}>
      {error && <div style={{ ...S.errBox, marginBottom: 16 }}>{error}</div>}
      <div style={SS.block}>
        <div style={SS.title}>Импорт InBody CSV</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>Загрузите <b>inbody270_data.csv</b> из LookinBody Web.</div>
        <button style={{ ...SS.btn, background: '#02BDB6', color: '#fff' }} onClick={() => fileRef.current?.click()} disabled={loading}>
          {loading && !preview && !result ? 'Обработка…' : 'Выбрать файл CSV…'}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />
        {preview && !result && (
          <div style={{ marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[['Всего строк', preview.total, '#374151'], ['Новых', preview.new, '#16a34a'], ['Дублей', preview.duplicates, '#9ca3af'], ['С клиентом', preview.linked, '#2563eb'], ['Без клиента', preview.unlinked, preview.unlinked > 0 ? '#f59e0b' : '#9ca3af']].map(([label, val, color]) => (
                  <tr key={String(label)}><td style={SS.tblKey}>{label}</td><td style={{ ...SS.tblVal, color: String(color) }}>{val}</td></tr>
                ))}
              </tbody>
            </table>
            {preview.new > 0 && (
              <button style={{ ...SS.btn, background: '#263CD9', color: '#fff', marginTop: 12 }} onClick={doImport} disabled={loading}>
                {loading ? 'Импорт…' : `Импортировать ${preview.new} новых`}
              </button>
            )}
          </div>
        )}
        {result && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 16px', marginTop: 12 }}>
            <div style={{ fontWeight: 700, color: '#166534', marginBottom: 8 }}>✓ Импорт завершён</div>
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {[['Добавлено', result.added, '#16a34a'], ['Пропущено', result.skipped, '#9ca3af'], ['Без клиента', result.without_client, '#f59e0b']].map(([l, v, c]) => (
                  <tr key={String(l)}><td style={SS.tblKey}>{l}</td><td style={{ ...SS.tblVal, color: String(c) }}>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <button style={{ ...SS.btn, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', marginTop: 12 }} onClick={() => { setRows(null); setPreview(null); setResult(null); }}>Загрузить ещё</button>
          </div>
        )}
      </div>
      <div style={SS.block}>
        <div style={SS.title}>Пересчёт InBody</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>Пересчитывает числовые поля из raw CSV для всех тестов.</div>
        <button style={{ ...SS.btn, background: '#f8fafc', color: '#374151', border: '1px solid #e2e6ea' }} onClick={doRecalculate} disabled={loading}>Пересчитать InBody</button>
        {recalc && <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '8px 14px', fontSize: 14, color: '#166534' }}>✓ Пересчитано: <b>{recalc.updated}</b></div>}
      </div>
      <div style={SS.block}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={SS.title}>InBody без клиента</div>
          <button style={{ padding: '6px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e6ea', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }} onClick={loadUnlinked} disabled={loading}>{unlinked === null ? 'Загрузить' : '↺ Обновить'}</button>
        </div>
        {unlinked !== null && unlinked.length > 0 && unlinked.map(t => (
          <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: '#263CD9' }}>{t.inbody_id}</span>
            <span style={{ color: '#6b7280', marginLeft: 10 }}>{t.tested_at?.slice(0, 10)}</span>
            {t.phone && <span style={{ color: '#64748b', marginLeft: 10 }}>{t.phone}</span>}
          </div>
        ))}
        {unlinked !== null && !unlinked.length && <div style={{ color: '#94a3b8', fontSize: 13 }}>Все тесты привязаны</div>}
      </div>
    </div>
  );
}

function MigrateSection() {
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
    <div style={{ ...S.section, maxWidth: 480 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Перенести клиентов InBody в отчёт</div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>Для каждого телефона из inbody_tests: если клиент уже есть — пропустить; если нет — создать.</div>
      {error && <div style={S.errBox}>{error}</div>}
      {result && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14 }}>Добавлено: <b>{result.added}</b> · Уже были: <b>{result.already}</b></div>}
      <button style={S.saveBtn} onClick={migrate} disabled={loading}>{loading ? 'Переносим…' : 'Перенести клиентов InBody'}</button>
    </div>
  );
}

function BulkResultsSection() {
  const [preview, setPreview]     = useState<{ will_add: number; will_update: number } | null>(null);
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
    <div style={{ ...S.section, maxWidth: 520 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Выгрузить все результаты в общий</div>
      {error && <div style={S.errBox}>{error}</div>}
      {result && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14 }}>Добавлено: <b>{result.added}</b> · Обновлено: <b>{result.updated}</b></div>}
      {preview && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Предпросмотр</div>
          <div style={{ fontSize: 13 }}>Добавится: <b>{preview.will_add}</b> · Обновится: <b>{preview.will_update}</b></div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button style={S.saveBtn} onClick={confirm} disabled={confirming}>{confirming ? 'Выгружаем…' : 'Подтвердить'}</button>
            <button style={S.cancelBtn} onClick={() => setPreview(null)}>Отмена</button>
          </div>
        </div>
      )}
      {!preview && !result && <button style={S.csvBtn} onClick={loadPreview} disabled={loading}>{loading ? '…' : 'Предпросмотр'}</button>}
    </div>
  );
}

function MissionSection() {
  const [mission, setMission] = useState('');
  const [tvUrl, setTvUrl]     = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);
  useEffect(() => {
    fetch('/kviz/api/results/mission', { credentials: 'include' })
      .then(r => r.ok ? r.json() : {})
      .then(d => { setMission(d.mission ?? ''); if (d.display_url) setTvUrl(window.location.origin + d.display_url); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const r = await fetch('/kviz/api/results/mission', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission }) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Ошибка'); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  return (
    <div style={{ ...S.section, maxWidth: 480 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Миссия студии</div>
      {loading && <div style={{ color: '#94a3b8', fontSize: 13 }}>Загрузка…</div>}
      {!loading && <>
        {error && <div style={S.errBox}>{error}</div>}
        <textarea style={{ ...S.inp, height: 120, resize: 'vertical', marginBottom: 12 }} value={mission} maxLength={500} onChange={e => setMission(e.target.value)} placeholder="Текст миссии студии (до 500 символов)" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={S.saveBtn} onClick={save} disabled={saving}>{saving ? '…' : saved ? '✓ Сохранено' : 'Сохранить'}</button>
          {tvUrl && <button style={S.csvBtn} onClick={async () => { await navigator.clipboard.writeText(tvUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? '✓ Скопировано' : 'Скопировать ссылку ТВ'}</button>}
        </div>
      </>}
    </div>
  );
}

function ServiceSection() {
  type Sub = 'inbody' | 'migrate' | 'bulk' | 'mission';
  const [sub, setSub] = useState<Sub>('inbody');
  const subs: { id: Sub; label: string }[] = [
    { id: 'inbody', label: 'InBody: импорт, пересчёт' },
    { id: 'migrate', label: 'Перенести клиентов InBody' },
    { id: 'bulk', label: 'Выгрузить все результаты' },
    { id: 'mission', label: 'Миссия студии' },
  ];
  return (
    <div style={S.section}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {subs.map(s => (
          <button key={s.id} style={{ ...S.subNavBtn, ...(sub === s.id ? S.subNavActive : {}) }} onClick={() => setSub(s.id)}>{s.label}</button>
        ))}
      </div>
      {sub === 'inbody' && <InBodySettingsSection />}
      {sub === 'migrate' && <MigrateSection />}
      {sub === 'bulk' && <BulkResultsSection />}
      {sub === 'mission' && <MissionSection />}
    </div>
  );
}

// ── Main SettingsPage ──────────────────────────────────────────────────────────

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'devices',   label: 'Аппараты',           icon: '⚙️' },
  { id: 'abonements', label: 'Абонементы',         icon: '📋' },
  { id: 'services',  label: 'Услуги',              icon: '🛎️' },
  { id: 'products',  label: 'Товары и склад',       icon: '📦' },
  { id: 'suppliers', label: 'Поставщики',           icon: '🏭' },
  { id: 'promos',    label: 'Промокоды',            icon: '🎁' },
  { id: 'payments',  label: 'Виды оплаты',          icon: '💳' },
  { id: 'sources',   label: 'Рекламные источники',  icon: '📣' },
  { id: 'classes',   label: 'Занятия',              icon: '🏃' },
  { id: 'service',   label: 'Сервис',               icon: '🔧' },
];

export default function SettingsPage() {
  const [section, setSection] = useState<Section>(() => {
    try { return (sessionStorage.getItem('crm-settings-section') as Section) || 'devices'; } catch { return 'devices'; }
  });

  function nav(s: Section) {
    setSection(s);
    try { sessionStorage.setItem('crm-settings-section', s); } catch {}
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc' }}>
      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.sidebarTitle}>Настройки</div>
        {NAV.map(n => (
          <button key={n.id} style={{ ...S.navItem, ...(section === n.id ? S.navActive : {}) }} onClick={() => nav(n.id)}>
            <span style={{ marginRight: 8 }}>{n.icon}</span>{n.label}
          </button>
        ))}
      </div>
      {/* Content */}
      <div style={S.content}>
        <div style={S.contentHeader}>{NAV.find(n => n.id === section)?.label}</div>
        {section === 'devices'    && <DevicesSection />}
        {section === 'abonements' && <PlansSection kind="abonement" />}
        {section === 'services'   && <PlansSection kind="service" />}
        {section === 'products'   && <ProductsSection />}
        {section === 'suppliers'  && <SuppliersSection />}
        {section === 'promos'     && <PromoCodesSection />}
        {section === 'payments'   && <PaymentMethodsSection />}
        {section === 'sources'    && <AdSourcesSection />}
        {section === 'classes'    && (
          <div style={S.section}>
            <div style={{ textAlign: 'center', color: '#94a3b8', paddingTop: 40 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🚧</div>
              <div style={{ fontSize: 15, color: '#64748b' }}>В разработке</div>
            </div>
          </div>
        )}
        {section === 'service'    && <ServiceSection />}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  sidebar:       { width: 220, flexShrink: 0, background: '#fff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  sidebarTitle:  { padding: '16px 16px 8px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  navItem:       { display: 'flex', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: '10px 16px', fontSize: 13, fontWeight: 500, color: '#374151', cursor: 'pointer', textAlign: 'left' as const, fontFamily: 'inherit', borderRadius: 0 },
  navActive:     { background: 'rgba(2,189,182,0.1)', color: '#02BDB6', fontWeight: 700 },
  content:       { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' },
  contentHeader: { padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0', fontSize: 16, fontWeight: 700, flexShrink: 0, position: 'sticky' as const, top: 0, zIndex: 1 },
  section:       { padding: '16px 20px 40px', flexGrow: 1 },
  subheader:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  subTitle:      { fontSize: 14, fontWeight: 700, color: '#1a202c' },
  list:          { background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 8 },
  row:           { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', gap: 8 },
  rowActions:    { display: 'flex', gap: 6, flexShrink: 0 },
  meta:          { display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 },
  badge:         { display: 'inline-block', marginLeft: 6, padding: '1px 6px', fontSize: 11, borderRadius: 6, background: '#fee2e2', color: '#ef4444' },
  empty:         { padding: '12px 14px', color: '#94a3b8', fontSize: 13 },
  addBtn:        { padding: '6px 14px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  editBtn:       { padding: '4px 10px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' },
  delBtn:        { padding: '4px 8px', background: 'none', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#ef4444' },
  iconBtn:       { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#64748b', padding: '2px 6px' },
  overlay:       { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:         { background: '#fff', borderRadius: 16, padding: 24, width: 'min(440px,96vw)', maxHeight: '90vh', overflow: 'auto' },
  label:         { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 },
  inp:           { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const },
  mBtns:         { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' },
  cancelBtn:     { padding: '8px 16px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn:       { padding: '8px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' },
  csvBtn:        { padding: '8px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  errBox:        { background: '#fef2f2', color: '#ef4444', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
  subNavBtn:     { padding: '6px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#374151', fontWeight: 500 },
  subNavActive:  { background: '#02BDB6', color: '#fff', borderColor: '#02BDB6' },
};
