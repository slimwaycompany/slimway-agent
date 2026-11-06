import { useState, useEffect, useRef, useCallback } from 'react';
import { parseLookinBodyCSV } from '../../utils/parseLookinBodyCSV';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DeviceType { code: string; name: string; sort: number }
interface Device { id: string; branch_id: string; type_code: string; number: string; default_phase: string | null; session_minutes: number | null; status: string; notes: string | null }
interface Plan { id: string; kind: string; name: string; description: string | null; price: number; is_promo: boolean; is_free_booking: boolean; validity_days: number | null; extra_days: number | null; freeze_days: number | null; guest_visits: number | null; auto_activate_days: number | null; max_deferred_start_days: number | null; is_active: boolean; is_system: boolean; sort: number; items?: PlanItem[] }
interface PlanItem { id: string; plan_id: string; device_type_code: string; phase: string | null; sessions: number; sort: number }
interface Supplier { id: string; name: string; phone: string | null; link: string | null; notes: string | null; is_active: boolean }
interface Product { id: string; name: string; barcode: string | null; is_active: boolean; stock: number; retail_price: number | null }
interface Supply { id: string; product_id: string; supplier_id: string | null; quantity: number; remaining: number; purchase_price: number; retail_price: number | null; supplied_at: string; notes: string | null; created_by: string }
interface PromoCode { id: string; code: string; discount_type: string; discount_value: number; max_uses: number | null; max_uses_per_client: number | null; uses_count: number; expires_at: string | null; applies_to_all: boolean; is_active: boolean }
interface PaymentMethod { id: string; name: string; kind: string; is_system: boolean; is_active: boolean; sort: number }
interface AdSource { id: string; name: string; requires_referrer: boolean; is_active: boolean; sort: number }

type Section = 'devices' | 'abonements' | 'services' | 'products' | 'suppliers' | 'promos' | 'payments' | 'sources' | 'classes' | 'service' | 'finance' | 'funnels' | 'lead-tags' | 'task-types' | 'lost-reasons' | 'fb-users' | 'scriptolog' | 'control';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}

function fmtPrice(n: number) { return n.toLocaleString('ru-RU') + ' ₸'; }

const PHASE_LABELS: Record<string, string> = { active: 'Активная', finishing: 'Завершающая' };
const STATUS_LABELS: Record<string, string> = { working: 'Работает', repair: 'В ремонте', disabled: 'Отключен', broken: 'Неисправен' };
const STATUS_COLORS: Record<string, string> = { working: '#16a34a', repair: '#f59e0b', disabled: '#94a3b8', broken: '#ef4444' };
const PM_KIND_LABELS: Record<string, string> = { cash: 'нал', cashless: 'безнал', deposit: 'депозит', bonus: 'бонус' };

// ── Shared UI ──────────────────────────────────────────────────────────────────

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

function ConfirmModal({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 20, color: '#1a202c' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={S.cancelBtn} onClick={onClose}>Отмена</button>
          <button style={{ ...S.saveBtn, background: '#ef4444' }} onClick={onConfirm}>Удалить</button>
        </div>
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

function ArchiveToggle({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button style={{ ...S.csvBtn, fontSize: 12, padding: '4px 10px' }} onClick={onToggle}>
      {show ? 'Скрыть архив' : 'Показать архив'}
    </button>
  );
}

// ── Device Types & Devices ─────────────────────────────────────────────────────

function DevicesSection() {
  const [types, setTypes]     = useState<DeviceType[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [editType, setEditType]     = useState<DeviceType | null | 'new'>(null);
  const [editDevice, setEditDevice] = useState<Device | null | 'new'>(null);
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [nextNum, setNextNum] = useState<number | null>(null);
  const [err, setErr]     = useState('');
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

  async function fetchNextNum(typeCode: string) {
    if (!typeCode) { setNextNum(null); return; }
    const r = await fetch(`/kviz/api/crm/devices/next-number?type_code=${typeCode}`, { credentials: 'include' }).then(r => r.json());
    setNextNum(r.next ?? null);
  }

  async function saveType(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = { code: fd.get('code'), name: fd.get('name'), sort: Number(fd.get('sort') || 0) };
    const { ok, data } = await api(editType === 'new' ? 'POST' : 'PATCH',
      editType === 'new' ? '/kviz/api/crm/device-types' : `/kviz/api/crm/device-types/${(editType as DeviceType).code}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditType(null); load();
  }

  async function saveDevice(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      type_code: fd.get('type_code'), number: fd.get('number'),
      default_phase: fd.get('default_phase') || null,
      session_minutes: fd.get('session_minutes') || null,
      status: fd.get('status'), notes: fd.get('notes') || null,
    };
    const { ok, data } = await api(
      editDevice === 'new' ? 'POST' : 'PATCH',
      editDevice === 'new' ? '/kviz/api/crm/devices' : `/kviz/api/crm/devices/${(editDevice as Device).id}`,
      body,
    );
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditDevice(null); setNextNum(null); load();
  }

  async function doDelete(kind: 'type' | 'device', id: string) {
    const url = kind === 'type' ? `/kviz/api/crm/device-types/${id}` : `/kviz/api/crm/devices/${id}`;
    const { ok, data } = await api('DELETE', url);
    if (!ok) { alert(data.error || 'Ошибка'); } else load();
    setConfirm(null);
  }

  const visibleDevices = showArchived ? devices : devices.filter(d => d.status !== 'disabled');

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
            <span style={S.meta}>код: {t.code}</span>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEditType(t)}>✎</button>
              <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить тип «${t.name}» навсегда?`, action: () => doDelete('type', t.code) })}>Удалить</button>
            </div>
          </div>
        ))}
        {!types.length && <div style={S.empty}>Типы не добавлены</div>}
      </div>

      <div style={{ ...S.subheader, marginTop: 24 }}>
        <span style={S.subTitle}>Аппараты</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => { setNextNum(null); setEditDevice('new'); }}>+ Добавить</button>
        </div>
      </div>
      <div style={S.list}>
        {visibleDevices.map(d => {
          const typeName = types.find(t => t.code === d.type_code)?.name ?? d.type_code;
          const isArchived = d.status === 'disabled';
          return (
            <div key={d.id} style={{ ...S.row, opacity: isArchived ? 0.6 : 1 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{typeName} №{d.number}</span>
                <span style={S.meta}>
                  {d.default_phase ? PHASE_LABELS[d.default_phase] ?? d.default_phase : '—'}
                  {d.session_minutes ? ` · ${d.session_minutes} мин` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLORS[d.status] ?? '#94a3b8', padding: '2px 7px', borderRadius: 6, background: '#f8fafc', border: `1px solid ${STATUS_COLORS[d.status] ?? '#e2e8f0'}` }}>
                  {STATUS_LABELS[d.status] ?? d.status}
                </span>
                <div style={S.rowActions}>
                  <button style={S.editBtn} onClick={() => setEditDevice(d)}>✎</button>
                  {!isArchived
                    ? <button style={S.editBtn} onClick={() => api('PATCH', `/kviz/api/crm/devices/${d.id}`, { status: 'disabled' }).then(load)}>В архив</button>
                    : <button style={S.editBtn} onClick={() => api('PATCH', `/kviz/api/crm/devices/${d.id}`, { status: 'working' }).then(load)}>Вернуть</button>
                  }
                  <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить аппарат «${typeName} №${d.number}» навсегда?`, action: () => doDelete('device', d.id) })}>Удалить</button>
                </div>
              </div>
            </div>
          );
        })}
        {!visibleDevices.length && <div style={S.empty}>Аппараты не добавлены</div>}
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
        <Modal title={editDevice === 'new' ? 'Новый аппарат' : 'Редактировать аппарат'} onClose={() => { setEditDevice(null); setErr(''); setNextNum(null); }}>
          <form onSubmit={saveDevice}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Тип аппарата *">
              <select style={S.inp} name="type_code" required
                defaultValue={editDevice === 'new' ? '' : (editDevice as Device).type_code}
                onChange={e => { if (editDevice === 'new') fetchNextNum(e.target.value); }}>
                <option value="">— выбрать —</option>
                {types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
            </Field>
            <Field label={`Номер *${nextNum != null ? ` (следующий свободный: ${nextNum})` : ''}`}>
              <input style={S.inp} name="number" required
                defaultValue={editDevice === 'new' ? (nextNum ?? '') : (editDevice as Device).number}
                value={editDevice === 'new' && nextNum != null ? nextNum : undefined}
                onChange={() => {}} />
            </Field>
            <Field label="Фаза по умолчанию">
              <select style={S.inp} name="default_phase" defaultValue={editDevice === 'new' ? '' : ((editDevice as Device).default_phase ?? '')}>
                <option value="">— не указана —</option>
                <option value="active">Активная</option>
                <option value="finishing">Завершающая</option>
              </select>
            </Field>
            <Field label="Минут сеанса">
              <input style={S.inp} name="session_minutes" type="number" defaultValue={editDevice === 'new' ? '' : ((editDevice as Device).session_minutes ?? '')} />
            </Field>
            <Field label="Статус">
              <select style={S.inp} name="status" defaultValue={editDevice === 'new' ? 'working' : (editDevice as Device).status}>
                <option value="working">Работает</option>
                <option value="repair">В ремонте</option>
                <option value="disabled">Отключен</option>
                <option value="broken">Неисправен</option>
              </select>
            </Field>
            <Field label="Заметки">
              <input style={S.inp} name="notes" defaultValue={editDevice === 'new' ? '' : ((editDevice as Device).notes ?? '')} />
            </Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditDevice(null); setErr(''); setNextNum(null); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// ── Plans (abonements or services) ─────────────────────────────────────────────

function PlansSection({ kind }: { kind: 'abonement' | 'service' }) {
  const [plans, setPlans]     = useState<Plan[]>([]);
  const [types, setTypes]     = useState<DeviceType[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [editPlan, setEditPlan] = useState<Plan | null | 'new'>(null);
  const [localItems, setLocalItems] = useState<Array<{ device_type_code: string; phase: string; sessions: number }>>([]);
  const [confirm, setConfirm]  = useState<{ message: string; action: () => void } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [p, t, d] = await Promise.all([
      fetch(`/kviz/api/crm/plans?kind=${kind}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/kviz/api/crm/device-types', { credentials: 'include' }).then(r => r.json()),
      fetch('/kviz/api/crm/devices', { credentials: 'include' }).then(r => r.json()),
    ]);
    setPlans(Array.isArray(p) ? p : []);
    setTypes(Array.isArray(t) ? t : []);
    setDevices(Array.isArray(d) ? d : []);
  }, [kind]);
  useEffect(() => { load(); }, [load]);

  function openEdit(plan: Plan | 'new') {
    setErr('');
    if (plan === 'new') {
      setLocalItems([]);
    } else {
      setLocalItems((plan.items || []).map(it => ({ device_type_code: it.device_type_code, phase: it.phase || 'active', sessions: it.sessions })));
    }
    setEditPlan(plan);
  }

  function defaultPhaseForType(typeCode: string): string {
    const d = devices.find(dev => dev.type_code === typeCode && dev.default_phase);
    return d?.default_phase || 'active';
  }

  function addItem() {
    const firstType = types[0];
    if (!firstType) return;
    setLocalItems(prev => [...prev, { device_type_code: firstType.code, phase: defaultPhaseForType(firstType.code), sessions: 12 }]);
  }

  function updateItem(i: number, field: string, value: string | number) {
    setLocalItems(prev => {
      const next = [...prev];
      if (field === 'device_type_code') {
        next[i] = { ...next[i], device_type_code: String(value), phase: defaultPhaseForType(String(value)) };
      } else {
        next[i] = { ...next[i], [field]: value };
      }
      return next;
    });
  }

  function removeItem(i: number) {
    setLocalItems(prev => prev.filter((_, idx) => idx !== i));
  }

  async function savePlan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      kind, name: fd.get('name'), description: fd.get('description') || null,
      price: Number(fd.get('price') || 0),
      is_promo: fd.get('is_promo') === 'on', is_free_booking: fd.get('is_free_booking') === 'on',
      validity_days: fd.get('validity_days') || null,
      extra_days: Number(fd.get('extra_days') || 0),
      freeze_days: Number(fd.get('freeze_days') || 0),
      guest_visits: Number(fd.get('guest_visits') || 0),
      auto_activate_days: fd.get('auto_activate_days') || null,
      max_deferred_start_days: Number(fd.get('max_deferred_start_days') || 0),
      sort: Number(fd.get('sort') || 0),
      items: localItems,
    };
    if (editPlan !== 'new') body.is_active = fd.get('is_active') === 'on';
    const url    = editPlan === 'new' ? '/kviz/api/crm/plans' : `/kviz/api/crm/plans/${(editPlan as Plan).id}`;
    const method = editPlan === 'new' ? 'POST' : 'PATCH';
    const { ok, data } = await api(method, url, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditPlan(null); load();
  }

  async function doArchive(plan: Plan) {
    await api('PATCH', `/kviz/api/crm/plans/${plan.id}`, { is_active: !plan.is_active });
    load();
  }

  async function doDelete(plan: Plan) {
    const { ok, data } = await api('DELETE', `/kviz/api/crm/plans/${plan.id}`);
    if (!ok) alert(data.error || 'Ошибка'); else load();
    setConfirm(null);
  }

  const title = kind === 'abonement' ? 'Абонементы' : 'Услуги';
  const visible = showArchived ? plans : plans.filter(p => p.is_active);

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>{title}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => openEdit('new')}>+ Добавить</button>
        </div>
      </div>
      <div style={S.list}>
        {visible.map(p => {
          const compStr = (p.items || []).map(it => {
            const tn = types.find(t => t.code === it.device_type_code)?.name ?? it.device_type_code;
            const ph = it.phase === 'active' ? 'акт.' : it.phase === 'finishing' ? 'зав.' : (it.phase ?? '');
            return `${tn} ${it.sessions}${ph ? ` (${ph})` : ''}`;
          }).join(' · ');
          return (
            <div key={p.id} style={{ ...S.row, opacity: p.is_active ? 1 : 0.6, flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', width: '100%', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  {!p.is_active && <span style={S.badge}>архив</span>}
                  {p.is_promo  && <span style={{ ...S.badge, background: '#fef3c7', color: '#92400e' }}>Акция</span>}
                  <span style={S.meta}>{fmtPrice(p.price)}{p.validity_days ? ` · ${p.validity_days} дн` : ''}</span>
                </div>
                <div style={S.rowActions}>
                  {!p.is_system && <button style={S.editBtn} onClick={() => openEdit(p)}>✎</button>}
                  {!p.is_system && (
                    <button style={S.editBtn} onClick={() => doArchive(p)}>
                      {p.is_active ? 'В архив' : 'Восстановить'}
                    </button>
                  )}
                  {!p.is_system && (
                    <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить «${p.name}» навсегда?`, action: () => doDelete(p) })}>
                      Удалить
                    </button>
                  )}
                </div>
              </div>
              {compStr && <span style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{compStr}</span>}
            </div>
          );
        })}
        {!visible.length && <div style={S.empty}>Нет записей</div>}
      </div>

      {editPlan && (
        <Modal
          title={editPlan === 'new'
            ? (kind === 'abonement' ? 'Новый абонемент' : 'Новая услуга')
            : 'Редактировать'}
          onClose={() => { setEditPlan(null); setErr(''); }}
        >
          <form onSubmit={savePlan} style={{ maxHeight: '78vh', overflowY: 'auto', paddingRight: 4 }}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название *"><input style={S.inp} name="name" required defaultValue={editPlan === 'new' ? '' : (editPlan as Plan).name} /></Field>
            <Field label="Описание"><textarea style={{ ...S.inp, height: 56, resize: 'vertical' }} name="description" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).description ?? '')} /></Field>
            <Field label="Цена (₸) *"><input style={S.inp} name="price" type="number" min="0" required defaultValue={editPlan === 'new' ? 0 : (editPlan as Plan).price} /></Field>
            <Field label="Срок действия (дней)"><input style={S.inp} name="validity_days" type="number" min="1" placeholder="не ограничен" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).validity_days ?? '')} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Доп. срок (дней)"><input style={S.inp} name="extra_days" type="number" min="0" defaultValue={editPlan === 'new' ? 0 : ((editPlan as Plan).extra_days ?? 0)} /></Field>
              <Field label="Заморозка (дней)"><input style={S.inp} name="freeze_days" type="number" min="0" defaultValue={editPlan === 'new' ? 0 : ((editPlan as Plan).freeze_days ?? 0)} /></Field>
              <Field label="Гостевых визитов"><input style={S.inp} name="guest_visits" type="number" min="0" defaultValue={editPlan === 'new' ? 0 : ((editPlan as Plan).guest_visits ?? 0)} /></Field>
              <Field label="Макс. отложенный старт (дн)"><input style={S.inp} name="max_deferred_start_days" type="number" min="0" defaultValue={editPlan === 'new' ? 0 : ((editPlan as Plan).max_deferred_start_days ?? 0)} /></Field>
            </div>
            <Field label="Автоактивация через (дней, пусто = по первому посещению)">
              <input style={S.inp} name="auto_activate_days" type="number" min="0" placeholder="пусто" defaultValue={editPlan === 'new' ? '' : ((editPlan as Plan).auto_activate_days ?? '')} />
            </Field>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" name="is_promo" defaultChecked={editPlan !== 'new' && (editPlan as Plan).is_promo} /> Акция
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" name="is_free_booking" defaultChecked={editPlan !== 'new' && (editPlan as Plan).is_free_booking} /> Бесплатная — запись без кассы
              </label>
              {editPlan !== 'new' && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" name="is_active" defaultChecked={(editPlan as Plan).is_active} /> Активен
                </label>
              )}
            </div>
            <Field label="Порядок"><input style={S.inp} name="sort" type="number" defaultValue={editPlan === 'new' ? 0 : (editPlan as Plan).sort} /></Field>

            {/* Состав */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ ...S.label, margin: 0 }}>Состав{kind === 'abonement' ? ' *' : ''}</label>
                <button type="button" style={{ ...S.addBtn, fontSize: 12, padding: '3px 10px' }} onClick={addItem}>+ Аппарат</button>
              </div>
              {localItems.length === 0 && (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>
                  {kind === 'abonement' ? 'Добавьте хотя бы 1 аппарат' : 'Нет аппаратов (необязательно)'}
                </div>
              )}
              {localItems.map((it, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <select style={{ ...S.inp, padding: '7px 8px' }} value={it.device_type_code}
                    onChange={e => updateItem(i, 'device_type_code', e.target.value)}>
                    {types.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
                  </select>
                  <select style={{ ...S.inp, padding: '7px 8px', minWidth: 120 }} value={it.phase}
                    onChange={e => updateItem(i, 'phase', e.target.value)}>
                    <option value="active">Активная</option>
                    <option value="finishing">Завершающая</option>
                  </select>
                  <input style={{ ...S.inp, width: 64, padding: '7px 8px', textAlign: 'center' }} type="number" min="1"
                    value={it.sessions} onChange={e => updateItem(i, 'sessions', Number(e.target.value))} />
                  <button type="button" style={S.delBtn} onClick={() => removeItem(i)}>✕</button>
                </div>
              ))}
            </div>

            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditPlan(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// ── Suppliers ──────────────────────────────────────────────────────────────────

function SuppliersSection() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [edit, setEdit] = useState<Supplier | null | 'new'>(null);
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
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
    const body = { name: fd.get('name'), phone: fd.get('phone') || null, link: fd.get('link') || null, notes: fd.get('notes') || null };
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH',
      edit === 'new' ? '/kviz/api/crm/suppliers' : `/kviz/api/crm/suppliers/${(edit as Supplier).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  async function doDelete(id: string, name: string) {
    const { ok, data } = await api('DELETE', `/kviz/api/crm/suppliers/${id}`);
    if (!ok) alert(data.error || 'Ошибка'); else load();
    setConfirm(null);
  }

  const visible = showArchived ? rows : rows.filter(r => r.is_active);

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Поставщики</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
        </div>
      </div>
      <div style={S.list}>
        {visible.map(r => (
          <div key={r.id} style={{ ...S.row, opacity: r.is_active ? 1 : 0.6 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {!r.is_active && <span style={S.badge}>архив</span>}
              {r.phone && <span style={S.meta}>{r.phone}</span>}
              {r.link && (
                <span style={S.meta}>
                  <a href={r.link} target="_blank" rel="noopener noreferrer" style={{ color: '#02BDB6' }}>{r.link.length > 40 ? r.link.slice(0, 40) + '…' : r.link}</a>
                </span>
              )}
            </div>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>
              <button style={S.editBtn} onClick={() => api('PATCH', `/kviz/api/crm/suppliers/${r.id}`, { is_active: !r.is_active }).then(load)}>
                {r.is_active ? 'В архив' : 'Восстановить'}
              </button>
              <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить поставщика «${r.name}» навсегда?`, action: () => doDelete(r.id, r.name) })}>Удалить</button>
            </div>
          </div>
        ))}
        {!visible.length && <div style={S.empty}>Поставщики не добавлены</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый поставщик' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название *"><input style={S.inp} name="name" required defaultValue={edit === 'new' ? '' : (edit as Supplier).name} /></Field>
            <Field label="Телефон"><input style={S.inp} name="phone" defaultValue={edit === 'new' ? '' : ((edit as Supplier).phone ?? '')} /></Field>
            <Field label="Ссылка (сайт / Instagram / WhatsApp)"><input style={S.inp} name="link" placeholder="https://…" defaultValue={edit === 'new' ? '' : ((edit as Supplier).link ?? '')} /></Field>
            <Field label="Заметки"><textarea style={{ ...S.inp, height: 56, resize: 'vertical' }} name="notes" defaultValue={edit === 'new' ? '' : ((edit as Supplier).notes ?? '')} /></Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEdit(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
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
  const [confirm, setConfirm]     = useState<{ message: string; action: () => void } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // inline new supplier in supply modal
  const [supplySupId, setSupplySupId] = useState('');
  const [addingNewSup, setAddingNewSup] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupLink, setNewSupLink] = useState('');
  const [newSupSaving, setNewSupSaving] = useState(false);
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
    const { ok, data } = await api(editProd === 'new' ? 'POST' : 'PATCH',
      editProd === 'new' ? '/kviz/api/crm/products' : `/kviz/api/crm/products/${(editProd as Product).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditProd(null); load();
  }

  async function saveNewSupplier() {
    if (!newSupName.trim()) return;
    setNewSupSaving(true);
    const { ok, data } = await api('POST', '/kviz/api/crm/suppliers', { name: newSupName.trim(), phone: newSupPhone || null, link: newSupLink || null });
    setNewSupSaving(false);
    if (!ok) { alert(data.error || 'Ошибка'); return; }
    setSuppliers(prev => [...prev, data]);
    setSupplySupId(data.id);
    setAddingNewSup(false);
    setNewSupName(''); setNewSupPhone(''); setNewSupLink('');
  }

  async function saveSupply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supplyFor) return;
    setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      supplier_id: supplySupId || null,
      quantity: fd.get('quantity'), purchase_price: fd.get('purchase_price'),
      retail_price: fd.get('retail_price'), supplied_at: fd.get('supplied_at'),
      notes: fd.get('notes') || null,
    };
    const { ok, data } = await api('POST', `/kviz/api/crm/products/${supplyFor.id}/supplies`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setSupplyFor(null); setSupplySupId(''); load();
  }

  async function deleteSupply(id: string) {
    const { ok, data } = await api('DELETE', `/kviz/api/crm/product-supplies/${id}`);
    if (!ok) { alert(data.error || 'Ошибка'); return; }
    if (showSupplies) loadSupplies(showSupplies);
    setConfirm(null);
  }

  const visible = showArchived ? products : products.filter(p => p.is_active);

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Товары и склад</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => setEditProd('new')}>+ Товар</button>
        </div>
      </div>
      <div style={S.list}>
        {visible.map(p => (
          <div key={p.id}>
            <div style={{ ...S.row, opacity: p.is_active ? 1 : 0.6 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                {!p.is_active && <span style={S.badge}>архив</span>}
                <span style={S.meta}>склад: {p.stock} шт{p.retail_price ? ` · ${fmtPrice(p.retail_price)}` : ''}</span>
              </div>
              <div style={S.rowActions}>
                <button style={S.editBtn} onClick={() => { setSupplySupId(''); setSupplyFor(p); }}>+ Поставка</button>
                <button style={S.editBtn} onClick={() => showSupplies === p.id ? setShowSupplies(null) : loadSupplies(p.id)}>История</button>
                <button style={S.editBtn} onClick={() => setEditProd(p)}>✎</button>
                <button style={S.editBtn} onClick={() => api('PATCH', `/kviz/api/crm/products/${p.id}`, { is_active: !p.is_active }).then(load)}>
                  {p.is_active ? 'В архив' : 'Восстановить'}
                </button>
                <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить товар «${p.name}» навсегда?`, action: () => api('DELETE', `/kviz/api/crm/products/${p.id}`).then(r => { if (!r.ok) alert(r.data.error || 'Ошибка'); else load(); setConfirm(null); }) })}>Удалить</button>
              </div>
            </div>
            {showSupplies === p.id && (
              <div style={{ paddingLeft: 12, paddingBottom: 8, fontSize: 12, color: '#64748b' }}>
                {supplies.map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span>{s.supplied_at.slice(0, 10)} · {s.quantity} шт · {fmtPrice(s.purchase_price)}/шт · ост. {s.remaining}</span>
                    <button style={{ ...S.delBtn, fontSize: 11, padding: '2px 6px' }}
                      onClick={() => setConfirm({ message: `Удалить поставку от ${s.supplied_at.slice(0, 10)}?`, action: () => deleteSupply(s.id) })}>
                      Удалить
                    </button>
                  </div>
                ))}
                {!supplies.length && <div>Нет поставок</div>}
              </div>
            )}
          </div>
        ))}
        {!visible.length && <div style={S.empty}>Товары не добавлены</div>}
      </div>

      {editProd && (
        <Modal title={editProd === 'new' ? 'Новый товар' : 'Редактировать'} onClose={() => { setEditProd(null); setErr(''); }}>
          <form onSubmit={saveProd}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название *"><input style={S.inp} name="name" required defaultValue={editProd === 'new' ? '' : (editProd as Product).name} /></Field>
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
        <Modal title={`Поставка: ${supplyFor.name}`} onClose={() => { setSupplyFor(null); setErr(''); setAddingNewSup(false); }}>
          <form onSubmit={saveSupply}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Поставщик *">
              <select style={S.inp} value={supplySupId} required
                onChange={e => { if (e.target.value === '__new__') { setAddingNewSup(true); setSupplySupId(''); } else { setSupplySupId(e.target.value); setAddingNewSup(false); } }}>
                <option value="">— выбрать —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new__">+ Новый поставщик</option>
              </select>
            </Field>
            {addingNewSup && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Новый поставщик</div>
                <Field label="Название *"><input style={S.inp} value={newSupName} onChange={e => setNewSupName(e.target.value)} /></Field>
                <Field label="Телефон"><input style={S.inp} value={newSupPhone} onChange={e => setNewSupPhone(e.target.value)} /></Field>
                <Field label="Ссылка"><input style={S.inp} value={newSupLink} onChange={e => setNewSupLink(e.target.value)} /></Field>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" style={S.saveBtn} disabled={newSupSaving || !newSupName.trim()} onClick={saveNewSupplier}>{newSupSaving ? '…' : 'Добавить'}</button>
                  <button type="button" style={S.cancelBtn} onClick={() => setAddingNewSup(false)}>Отмена</button>
                </div>
              </div>
            )}
            <Field label="Количество *"><input style={S.inp} name="quantity" type="number" min="1" required /></Field>
            <Field label="Закупочная цена (₸) *"><input style={S.inp} name="purchase_price" type="number" min="0" required /></Field>
            <Field label="Розничная цена (₸) *"><input style={S.inp} name="retail_price" type="number" min="0" required /></Field>
            <Field label="Дата поставки *"><input style={S.inp} name="supplied_at" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Заметки"><input style={S.inp} name="notes" /></Field>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setSupplyFor(null); setErr(''); setAddingNewSup(false); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading || addingNewSup}>{loading ? '…' : 'Добавить'}</button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// ── Promo codes ────────────────────────────────────────────────────────────────

function PromoCodesSection() {
  const [rows, setRows]   = useState<PromoCode[]>([]);
  const [edit, setEdit]   = useState<PromoCode | null | 'new'>(null);
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr]     = useState('');
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
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH',
      edit === 'new' ? '/kviz/api/crm/promo-codes' : `/kviz/api/crm/promo-codes/${(edit as PromoCode).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  async function doDelete(id: string) {
    const { ok, data } = await api('DELETE', `/kviz/api/crm/promo-codes/${id}`);
    if (!ok) alert(data.error || 'Ошибка'); else load();
    setConfirm(null);
  }

  const visible = showArchived ? rows : rows.filter(r => r.is_active);

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Промокоды</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
        </div>
      </div>
      <div style={S.list}>
        {visible.map(r => (
          <div key={r.id} style={{ ...S.row, opacity: r.is_active ? 1 : 0.6 }}>
            <div>
              <span style={{ fontWeight: 700, letterSpacing: 1 }}>{r.code}</span>
              {!r.is_active && <span style={S.badge}>неактивен</span>}
              <span style={S.meta}>
                {r.discount_type === 'percent' ? `${r.discount_value}%` : fmtPrice(r.discount_value)}
                {r.uses_count > 0 ? ` · использован ${r.uses_count} раз` : ''}
                {r.expires_at ? ` · до ${r.expires_at.slice(0, 10)}` : ''}
              </span>
            </div>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>
              <button style={S.editBtn} onClick={() => api('PATCH', `/kviz/api/crm/promo-codes/${r.id}`, { is_active: !r.is_active }).then(load)}>
                {r.is_active ? 'В архив' : 'Восстановить'}
              </button>
              <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить промокод «${r.code}» навсегда?`, action: () => doDelete(r.id) })}>Удалить</button>
            </div>
          </div>
        ))}
        {!visible.length && <div style={S.empty}>Промокоды не добавлены</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый промокод' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            {edit === 'new' && <Field label="Код *"><input style={S.inp} name="code" required placeholder="PROMO2025" /></Field>}
            <Field label="Тип скидки">
              <select style={S.inp} name="discount_type" defaultValue={edit === 'new' ? 'percent' : (edit as PromoCode).discount_type}>
                <option value="percent">Процент (%)</option>
                <option value="fixed">Фиксированная (₸)</option>
              </select>
            </Field>
            <Field label="Размер скидки *"><input style={S.inp} name="discount_value" type="number" min="0" required defaultValue={edit === 'new' ? '' : (edit as PromoCode).discount_value} /></Field>
            <Field label="Макс. использований"><input style={S.inp} name="max_uses" type="number" defaultValue={edit === 'new' ? '' : ((edit as PromoCode).max_uses ?? '')} /></Field>
            <Field label="Макс. на клиента"><input style={S.inp} name="max_uses_per_client" type="number" defaultValue={edit === 'new' ? '' : ((edit as PromoCode).max_uses_per_client ?? '')} /></Field>
            <Field label="Действует до"><input style={S.inp} name="expires_at" type="date" defaultValue={edit === 'new' ? '' : ((edit as PromoCode).expires_at?.slice(0, 10) ?? '')} /></Field>
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
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// ── Payment methods ────────────────────────────────────────────────────────────

function PaymentMethodsSection() {
  const [rows, setRows] = useState<PaymentMethod[]>([]);
  const [edit, setEdit] = useState<PaymentMethod | null | 'new'>(null);
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
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
    const isSystem = edit !== 'new' && (edit as PaymentMethod).is_system;
    const body: Record<string, unknown> = isSystem
      ? { is_active: fd.get('is_active') === 'on' }
      : { name: fd.get('name'), kind: fd.get('kind'), sort: Number(fd.get('sort') || 0), is_active: fd.get('is_active') === 'on' };
    const url = edit === 'new' ? '/kviz/api/crm/payment-methods' : `/kviz/api/crm/payment-methods/${(edit as PaymentMethod).id}`;
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH', url, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  async function doDelete(id: string, name: string) {
    const { ok, data } = await api('DELETE', `/kviz/api/crm/payment-methods/${id}`);
    if (!ok) alert(data.error || 'Ошибка'); else load();
    setConfirm(null);
  }

  const visible = showArchived ? rows : rows.filter(r => r.is_active || r.is_system);

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Виды оплаты</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
        </div>
      </div>
      <div style={S.list}>
        {visible.map(r => (
          <div key={r.id} style={{ ...S.row, opacity: r.is_active ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {r.is_system && <span style={{ ...S.badge, background: '#dbeafe', color: '#1d4ed8' }}>системный</span>}
              {!r.is_active && !r.is_system && <span style={S.badge}>архив</span>}
              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 5, background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                {PM_KIND_LABELS[r.kind] ?? r.kind}
              </span>
            </div>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>
              {!r.is_system && (
                <>
                  <button style={S.editBtn} onClick={() => api('PATCH', `/kviz/api/crm/payment-methods/${r.id}`, { is_active: !r.is_active }).then(load)}>
                    {r.is_active ? 'В архив' : 'Восстановить'}
                  </button>
                  <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить вид оплаты «${r.name}» навсегда?`, action: () => doDelete(r.id, r.name) })}>Удалить</button>
                </>
              )}
            </div>
          </div>
        ))}
        {!visible.length && <div style={S.empty}>Нет записей</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый вид оплаты' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            {/* system entries: only toggle active */}
            {edit !== 'new' && (edit as PaymentMethod).is_system ? (
              <>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>Системный вид оплаты — можно только включить или отключить.</div>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 16 }}>
                  <input type="checkbox" name="is_active" defaultChecked={(edit as PaymentMethod).is_active} /> Активен
                </label>
              </>
            ) : (
              <>
                <Field label="Название *"><input style={S.inp} name="name" required defaultValue={edit === 'new' ? '' : (edit as PaymentMethod).name} /></Field>
                <Field label="Тип">
                  <select style={S.inp} name="kind" defaultValue={edit === 'new' ? 'cashless' : (edit as PaymentMethod).kind}>
                    <option value="cash">Наличные</option>
                    <option value="cashless">Безналичные</option>
                  </select>
                </Field>
                <Field label="Порядок"><input style={S.inp} name="sort" type="number" defaultValue={edit === 'new' ? 0 : (edit as PaymentMethod).sort} /></Field>
                {edit !== 'new' && (
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
                    <input type="checkbox" name="is_active" defaultChecked={(edit as PaymentMethod).is_active} /> Активен
                  </label>
                )}
              </>
            )}
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEdit(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// ── Ad sources ─────────────────────────────────────────────────────────────────

function AdSourcesSection() {
  const [rows, setRows] = useState<AdSource[]>([]);
  const [edit, setEdit] = useState<AdSource | null | 'new'>(null);
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
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
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PATCH',
      edit === 'new' ? '/kviz/api/crm/ad-sources' : `/kviz/api/crm/ad-sources/${(edit as AdSource).id}`, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEdit(null); load();
  }

  async function doDelete(id: string) {
    const { ok, data } = await api('DELETE', `/kviz/api/crm/ad-sources/${id}`);
    if (!ok) alert(data.error || 'Ошибка'); else load();
    setConfirm(null);
  }

  const visible = showArchived ? rows : rows.filter(r => r.is_active);

  return (
    <div style={S.section}>
      <div style={S.subheader}>
        <span style={S.subTitle}>Рекламные источники</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
        </div>
      </div>
      <div style={S.list}>
        {visible.map(r => (
          <div key={r.id} style={{ ...S.row, opacity: r.is_active ? 1 : 0.6 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {!r.is_active && <span style={S.badge}>архив</span>}
              {r.requires_referrer && <span style={{ ...S.badge, background: '#fef3c7', color: '#92400e' }}>с реферером</span>}
            </div>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => setEdit(r)}>✎</button>
              <button style={S.editBtn} onClick={() => api('PATCH', `/kviz/api/crm/ad-sources/${r.id}`, { is_active: !r.is_active }).then(load)}>
                {r.is_active ? 'В архив' : 'Восстановить'}
              </button>
              <button style={S.delBtn} onClick={() => setConfirm({ message: `Удалить источник «${r.name}» навсегда?`, action: () => doDelete(r.id) })}>Удалить</button>
            </div>
          </div>
        ))}
        {!visible.length && <div style={S.empty}>Источники не добавлены</div>}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Новый источник' : 'Редактировать'} onClose={() => { setEdit(null); setErr(''); }}>
          <form onSubmit={save}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название *"><input style={S.inp} name="name" required defaultValue={edit === 'new' ? '' : (edit as AdSource).name} /></Field>
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
      {confirm && <ConfirmModal message={confirm.message} onConfirm={confirm.action} onClose={() => setConfirm(null)} />}
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
    { id: 'inbody',   label: 'InBody: импорт, пересчёт' },
    { id: 'migrate',  label: 'Перенести клиентов InBody' },
    { id: 'bulk',     label: 'Выгрузить все результаты' },
    { id: 'mission',  label: 'Миссия студии' },
  ];
  return (
    <div style={S.section}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {subs.map(s => (
          <button key={s.id} style={{ ...S.subNavBtn, ...(sub === s.id ? S.subNavActive : {}) }} onClick={() => setSub(s.id)}>{s.label}</button>
        ))}
      </div>
      {sub === 'inbody'  && <InBodySettingsSection />}
      {sub === 'migrate' && <MigrateSection />}
      {sub === 'bulk'    && <BulkResultsSection />}
      {sub === 'mission' && <MissionSection />}
    </div>
  );
}

// ── Finance section ────────────────────────────────────────────────────────────

interface FinStaff { id: string; fitbase_name: string; display_name: string; hidden_in_reports: boolean; in_payroll: boolean; is_active: boolean }
interface ExpenseGroup { id: string; name: string; level: string; sort: number; is_active: boolean; items?: ExpenseItem[] }
interface ExpenseItem { id: string; group_id: string; name: string; kind: string; amount_month: number|null; pct: number|null; pct_base: string|null; sort: number; note: string|null; is_active: boolean }

function FinanceSection() {
  const [tab, setTab] = useState<'staff'|'expenses'|'norms'>('staff');
  const [tbu, setTbu] = useState<{ tbu_month: number | null; tbu_week: number | null } | null>(null);

  useEffect(() => {
    fetch('/kviz/api/fin/tbu-summary', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setTbu(d); }).catch(() => {});
  }, []);

  return (
    <div style={{ ...S.section, padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* TBU panel */}
      {tbu?.tbu_month != null && (
        <div style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#f0fdf4,#ecfdf5)', borderBottom: '1px solid #d1fae5', display: 'flex', gap: 24, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: '#065f46', fontWeight: 700 }}>ТБУ:</span>
          <span style={{ fontWeight: 800, fontSize: 16, color: '#059669' }}>{Math.round(tbu.tbu_month).toLocaleString('ru')} ₸/мес</span>
          {tbu.tbu_week != null && <span style={{ fontSize: 12, color: '#6b7280' }}>неделя: {Math.round(tbu.tbu_week).toLocaleString('ru')} ₸</span>}
        </div>
      )}
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', padding: '8px 20px 0', background: '#fff', flexShrink: 0 }}>
        {(['staff','expenses','norms'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...S.subNavBtn, ...(tab === t ? S.subNavActive : {}), marginRight: 6, borderRadius: '8px 8px 0 0', borderBottom: tab === t ? 'none' : undefined }}>
            {t === 'staff' ? 'Сотрудники' : t === 'expenses' ? 'Статьи расходов' : 'Нормативы'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {tab === 'staff'    && <FinStaffTab />}
        {tab === 'expenses' && <FinExpensesTab />}
        {tab === 'norms'    && (
          <div style={{ color: '#6b7280', fontSize: 14, paddingTop: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8, color: '#374151' }}>Нормативы</div>
            Плановые ставки для отчёта ТБУ. Будет добавлено позже.
          </div>
        )}
      </div>
    </div>
  );
}

function FinStaffTab() {
  const [rows, setRows] = useState<FinStaff[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [edit, setEdit] = useState<FinStaff | 'new' | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      fetch('/kviz/api/fin/staff', { credentials: 'include' }).then(r => r.json()),
      fetch('/kviz/api/fin/fitbase-names', { credentials: 'include' }).then(r => r.json()),
    ]);
    if (Array.isArray(r1)) setRows(r1 as FinStaff[]);
    const names = (r2 as Record<string,unknown>)?.all;
    if (Array.isArray(names)) setSuggestions(names as string[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const draft: FinStaff = { id: '', fitbase_name: '', display_name: '', hidden_in_reports: false, in_payroll: true, is_active: true };
  const cur = edit === 'new' ? draft : edit;

  async function save() {
    if (!cur) return;
    setErr('');
    const body = { fitbase_name: cur.fitbase_name.trim(), display_name: cur.display_name.trim(), hidden_in_reports: cur.hidden_in_reports, in_payroll: cur.in_payroll, is_active: cur.is_active };
    if (!body.fitbase_name || !body.display_name) { setErr('Заполните оба поля имени'); return; }
    const { ok, data } = await api(edit === 'new' ? 'POST' : 'PUT', edit === 'new' ? '/kviz/api/fin/staff' : `/kviz/api/fin/staff/${cur.id}`, body);
    if (!ok) { setErr((data as Record<string,string>).error ?? 'Ошибка'); return; }
    setEdit(null); load();
  }

  async function del(id: string) {
    const { ok, data } = await api('DELETE', `/kviz/api/fin/staff/${id}`);
    if (!ok) { setErr((data as Record<string,string>).error ?? 'Ошибка'); }
    setConfirm(null); load();
  }

  return (
    <>
      <div style={S.subheader}>
        <span style={S.subTitle}>Список сотрудников</span>
        <button style={S.addBtn} onClick={() => setEdit('new')}>+ Добавить</button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      <div style={S.list}>
        {rows.length === 0 && <div style={S.empty}>Нет сотрудников</div>}
        {rows.map(r => (
          <div key={r.id} style={S.row}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.display_name}</div>
              <span style={S.meta}>{r.fitbase_name}{r.hidden_in_reports ? ' · скрыт' : ''}{!r.in_payroll ? ' · без ЗП' : ''}{!r.is_active ? ' · неактивен' : ''}</span>
            </div>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => { setErr(''); setEdit(r); }}>Изм.</button>
              <button style={S.delBtn} onClick={() => setConfirm({ id: r.id, name: r.display_name })}>Удалить</button>
            </div>
          </div>
        ))}
      </div>

      {cur && (
        <Modal title={edit === 'new' ? 'Новый сотрудник' : 'Редактировать'} onClose={() => setEdit(null)}>
          {err && <div style={S.errBox}>{err}</div>}
          <Field label="Имя в Fitbase (кассир)">
            <input style={S.inp} value={cur.fitbase_name} onChange={e => setEdit({ ...cur, fitbase_name: e.target.value })}
              list="fb-names-list" placeholder="Как в Fitbase" />
            <datalist id="fb-names-list">{suggestions.map(s => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Отображаемое имя">
            <input style={S.inp} value={cur.display_name} onChange={e => setEdit({ ...cur, display_name: e.target.value })} placeholder="Как показывать в отчётах" />
          </Field>
          <Field label="">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={cur.in_payroll} onChange={e => setEdit({ ...cur, in_payroll: e.target.checked })} />
              Включить в расчёт зарплаты
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginTop: 6 }}>
              <input type="checkbox" checked={cur.hidden_in_reports} onChange={e => setEdit({ ...cur, hidden_in_reports: e.target.checked })} />
              Скрыть в метриках (итоги учитываются)
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginTop: 6 }}>
              <input type="checkbox" checked={cur.is_active} onChange={e => setEdit({ ...cur, is_active: e.target.checked })} />
              Активен
            </label>
          </Field>
          <div style={S.mBtns}>
            <button style={S.cancelBtn} onClick={() => setEdit(null)}>Отмена</button>
            <button style={S.saveBtn} onClick={save}>Сохранить</button>
          </div>
        </Modal>
      )}
      {confirm && (
        <ConfirmModal message={`Удалить сотрудника «${confirm.name}»?`} onConfirm={() => del(confirm.id)} onClose={() => setConfirm(null)} />
      )}
    </>
  );
}

function FinExpensesTab() {
  const [groups, setGroups] = useState<ExpenseGroup[]>([]);
  const [editGroup, setEditGroup] = useState<ExpenseGroup | 'new' | null>(null);
  const [editItem, setEditItem] = useState<{ item: ExpenseItem | 'new'; groupId: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ type: 'group'|'item'; id: string; name: string } | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/kviz/api/fin/expense-groups', { credentials: 'include' }).then(r => r.json());
    if (Array.isArray(r)) setGroups((r as ExpenseGroup[]).filter(g => g.is_active).sort((a, b) => a.sort - b.sort));
  }, []);
  useEffect(() => { load(); }, [load]);

  const LEVEL_LABELS: Record<string, string> = { revenue: 'Выручка', margin: 'Маржа', skd: 'СКД' };
  const KIND_LABELS: Record<string, string> = { fixed: 'фиксированная', pct: 'процент', manual: 'ручной ввод' };

  async function saveGroup() {
    setErr('');
    const cur = editGroup === 'new' ? { name: '', level: 'margin', sort: 0, id: '' } : editGroup!;
    const body = { name: (cur as ExpenseGroup).name?.trim(), level: (cur as ExpenseGroup).level, sort: (cur as ExpenseGroup).sort };
    if (!body.name) { setErr('Введите название группы'); return; }
    const { ok, data } = await api(editGroup === 'new' ? 'POST' : 'PUT', editGroup === 'new' ? '/kviz/api/fin/expense-groups' : `/kviz/api/fin/expense-groups/${(cur as ExpenseGroup).id}`, body);
    if (!ok) { setErr((data as Record<string,string>).error ?? 'Ошибка'); return; }
    setEditGroup(null); load();
  }

  async function saveItem() {
    if (!editItem) return;
    setErr('');
    const cur = editItem.item === 'new' ? { name: '', kind: 'fixed', amount_month: null, pct: null, pct_base: null, sort: 0, note: null, id: '', group_id: editItem.groupId } : editItem.item;
    const body = {
      group_id: editItem.groupId, name: (cur as ExpenseItem).name?.trim(), kind: (cur as ExpenseItem).kind,
      amount_month: (cur as ExpenseItem).amount_month || null, pct: (cur as ExpenseItem).pct || null,
      pct_base: (cur as ExpenseItem).pct_base || null, sort: (cur as ExpenseItem).sort,
      note: (cur as ExpenseItem).note || null,
    };
    if (!body.name) { setErr('Введите название статьи'); return; }
    const { ok, data } = await api(editItem.item === 'new' ? 'POST' : 'PUT', editItem.item === 'new' ? '/kviz/api/fin/expense-items' : `/kviz/api/fin/expense-items/${(cur as ExpenseItem).id}`, body);
    if (!ok) { setErr((data as Record<string,string>).error ?? 'Ошибка'); return; }
    setEditItem(null); load();
  }

  async function doDel() {
    if (!confirmDel) return;
    const url = confirmDel.type === 'group' ? `/kviz/api/fin/expense-groups/${confirmDel.id}` : `/kviz/api/fin/expense-items/${confirmDel.id}`;
    const { ok, data } = await api('DELETE', url);
    if (!ok) setErr((data as Record<string,string>).error ?? 'Ошибка');
    setConfirmDel(null); load();
  }

  const [gDraft, setGDraft] = useState<Partial<ExpenseGroup>>({});
  const [iDraft, setIDraft] = useState<Partial<ExpenseItem>>({});

  function openGroup(g: ExpenseGroup | 'new') { setEditGroup(g); setGDraft(g === 'new' ? { name: '', level: 'margin', sort: 0 } : { ...g }); }
  function openItem(item: ExpenseItem | 'new', groupId: string) {
    setEditItem({ item, groupId });
    setIDraft(item === 'new' ? { name: '', kind: 'fixed', sort: 0, group_id: groupId } : { ...item });
  }

  return (
    <>
      <div style={S.subheader}>
        <span style={S.subTitle}>Группы и статьи расходов</span>
        <button style={S.addBtn} onClick={() => openGroup('new')}>+ Группа</button>
      </div>
      {err && <div style={S.errBox}>{err}</div>}
      {groups.map(g => (
        <div key={g.id} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#374151' }}>{g.name}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', background: '#f1f5f9', borderRadius: 4, padding: '1px 6px' }}>{LEVEL_LABELS[g.level] ?? g.level}</span>
            <button style={S.editBtn} onClick={() => openGroup(g)}>Изм.</button>
            <button style={S.delBtn} onClick={() => setConfirmDel({ type: 'group', id: g.id, name: g.name })}>Удалить</button>
            <button style={{ ...S.addBtn, fontSize: 12, padding: '3px 10px' }} onClick={() => openItem('new', g.id)}>+ Статья</button>
          </div>
          <div style={{ ...S.list, marginBottom: 0 }}>
            {(g.items ?? []).length === 0 && <div style={S.empty}>Нет статей</div>}
            {(g.items ?? []).map(it => (
              <div key={it.id} style={S.row}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{it.name}</span>
                  <span style={S.meta}>
                    {KIND_LABELS[it.kind]}
                    {it.kind === 'fixed' && it.amount_month != null && ` · ${it.amount_month.toLocaleString('ru')} ₸/мес`}
                    {it.kind === 'pct' && it.pct != null && ` · ${it.pct}% от ${it.pct_base ?? '?'}`}
                    {it.note && ` · ${it.note}`}
                  </span>
                </div>
                <div style={S.rowActions}>
                  <button style={S.editBtn} onClick={() => openItem(it, g.id)}>Изм.</button>
                  <button style={S.delBtn} onClick={() => setConfirmDel({ type: 'item', id: it.id, name: it.name })}>Удалить</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Нет групп расходов</div>}

      {/* Group modal */}
      {editGroup !== null && (
        <Modal title={editGroup === 'new' ? 'Новая группа' : 'Редактировать группу'} onClose={() => setEditGroup(null)}>
          {err && <div style={S.errBox}>{err}</div>}
          <Field label="Название"><input style={S.inp} value={gDraft.name ?? ''} onChange={e => setGDraft(d => ({ ...d, name: e.target.value }))} /></Field>
          <Field label="Уровень">
            <select style={{ ...S.inp, padding: '9px 12px' }} value={gDraft.level ?? 'margin'} onChange={e => setGDraft(d => ({ ...d, level: e.target.value }))}>
              {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Порядок (sort)"><input type="number" style={S.inp} value={gDraft.sort ?? 0} onChange={e => setGDraft(d => ({ ...d, sort: Number(e.target.value) }))} /></Field>
          <div style={S.mBtns}>
            <button style={S.cancelBtn} onClick={() => setEditGroup(null)}>Отмена</button>
            <button style={S.saveBtn} onClick={() => {
              api(editGroup === 'new' ? 'POST' : 'PUT', editGroup === 'new' ? '/kviz/api/fin/expense-groups' : `/kviz/api/fin/expense-groups/${(editGroup as ExpenseGroup).id}`, { name: gDraft.name, level: gDraft.level ?? 'margin', sort: gDraft.sort ?? 0 })
                .then(({ ok, data }) => { if (!ok) { setErr((data as Record<string,string>).error ?? 'Ошибка'); return; } setEditGroup(null); load(); });
            }}>Сохранить</button>
          </div>
        </Modal>
      )}

      {/* Item modal */}
      {editItem !== null && (
        <Modal title={editItem.item === 'new' ? 'Новая статья' : 'Редактировать статью'} onClose={() => setEditItem(null)}>
          {err && <div style={S.errBox}>{err}</div>}
          <Field label="Название"><input style={S.inp} value={iDraft.name ?? ''} onChange={e => setIDraft(d => ({ ...d, name: e.target.value }))} /></Field>
          <Field label="Вид">
            <select style={{ ...S.inp, padding: '9px 12px' }} value={iDraft.kind ?? 'fixed'} onChange={e => setIDraft(d => ({ ...d, kind: e.target.value }))}>
              <option value="fixed">Фиксированная (₸/мес)</option>
              <option value="pct">Процент от базы</option>
              <option value="manual">Ручной ввод по неделям</option>
            </select>
          </Field>
          {iDraft.kind === 'fixed' && (
            <Field label="Сумма в месяц, ₸">
              <input type="number" style={S.inp} value={iDraft.amount_month ?? ''} onChange={e => setIDraft(d => ({ ...d, amount_month: e.target.value ? Number(e.target.value) : null }))} />
            </Field>
          )}
          {iDraft.kind === 'pct' && (
            <>
              <Field label="Процент (%)"><input type="number" style={S.inp} value={iDraft.pct ?? ''} onChange={e => setIDraft(d => ({ ...d, pct: e.target.value ? Number(e.target.value) : null }))} /></Field>
              <Field label="База">
                <select style={{ ...S.inp, padding: '9px 12px' }} value={iDraft.pct_base ?? 'revenue'} onChange={e => setIDraft(d => ({ ...d, pct_base: e.target.value }))}>
                  <option value="revenue">Выручка</option>
                  <option value="margin">Маржинальный доход</option>
                  <option value="skd">СКД</option>
                </select>
              </Field>
            </>
          )}
          <Field label="Порядок (sort)"><input type="number" style={S.inp} value={iDraft.sort ?? 0} onChange={e => setIDraft(d => ({ ...d, sort: Number(e.target.value) }))} /></Field>
          <Field label="Заметка (необязательно)"><input style={S.inp} value={iDraft.note ?? ''} onChange={e => setIDraft(d => ({ ...d, note: e.target.value || null }))} /></Field>
          <div style={S.mBtns}>
            <button style={S.cancelBtn} onClick={() => setEditItem(null)}>Отмена</button>
            <button style={S.saveBtn} onClick={() => {
              const url = editItem.item === 'new' ? '/kviz/api/fin/expense-items' : `/kviz/api/fin/expense-items/${(editItem.item as ExpenseItem).id}`;
              api(editItem.item === 'new' ? 'POST' : 'PUT', url, { group_id: editItem.groupId, name: iDraft.name, kind: iDraft.kind, amount_month: iDraft.amount_month ?? null, pct: iDraft.pct ?? null, pct_base: iDraft.pct_base ?? null, sort: iDraft.sort ?? 0, note: iDraft.note ?? null })
                .then(({ ok, data }) => { if (!ok) { setErr((data as Record<string,string>).error ?? 'Ошибка'); return; } setEditItem(null); load(); });
            }}>Сохранить</button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmModal message={`Удалить «${confirmDel.name}»? Это действие необратимо.`} onConfirm={doDel} onClose={() => setConfirmDel(null)} />
      )}
    </>
  );
}

// ── CRM: Funnels & Stages ─────────────────────────────────────────────────────

interface CrmStage  { id: string; name: string; kind: string; sort: number; is_archived: boolean; color: string | null; funnel_id: string | null }
interface CrmFunnel { id: string; name: string; sort: number; is_active: boolean; stages: CrmStage[] }

function FunnelsSection() {
  const [funnels, setFunnels] = useState<CrmFunnel[]>([]);
  const [err, setErr] = useState('');
  const [newFunnelName, setNewFunnelName] = useState('');
  const [newStageName, setNewStageName] = useState<Record<string, string>>({});

  async function load() {
    const { ok, data } = await api('GET', '/kviz/api/crm/funnels');
    if (ok && Array.isArray(data)) setFunnels(data);
  }
  useEffect(() => { load(); }, []);

  async function createFunnel() {
    if (!newFunnelName.trim()) return;
    const { ok, data } = await api('POST', '/kviz/api/crm/funnels', { name: newFunnelName.trim() });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    setNewFunnelName(''); load();
  }

  async function toggleFunnelActive(f: CrmFunnel) {
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnels/${f.id}`, { is_active: !f.is_active });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    load();
  }

  async function createStage(funnelId: string) {
    const name = (newStageName[funnelId] ?? '').trim();
    if (!name) return;
    const { ok, data } = await api('POST', '/kviz/api/crm/funnel-stages', { name, funnel_id: funnelId });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    setNewStageName(prev => ({ ...prev, [funnelId]: '' })); load();
  }

  async function toggleStageArchived(stage: CrmStage) {
    const { ok, data } = await api('PATCH', `/kviz/api/crm/funnel-stages/${stage.id}`, { is_archived: !stage.is_archived });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    load();
  }

  return (
    <div style={S.section}>
      {err && <div style={S.errBox}>{err}<button style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setErr('')}>✕</button></div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={{ ...S.inp, flex: 1 }} placeholder="Название новой воронки" value={newFunnelName} onChange={e => setNewFunnelName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createFunnel()} />
        <button style={S.addBtn} onClick={createFunnel}>+ Воронка</button>
      </div>
      {funnels.map(f => (
        <div key={f.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 8, background: '#f8fafc' }}>
            <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: '#1a202c' }}>{f.name}</span>
            <button style={{ ...S.editBtn, fontSize: 11 }} onClick={() => toggleFunnelActive(f)}>{f.is_active ? 'Активна' : 'Неактивна'}</button>
          </div>
          <div style={{ padding: '8px 14px' }}>
            {f.stages.sort((a, b) => a.sort - b.sort).map(s => (
              <div key={s.id} style={{ ...S.row, opacity: s.is_archived ? 0.5 : 1 }}>
                <span style={{ fontSize: 13, color: '#374151' }}>{s.name}</span>
                <div style={S.rowActions}>
                  <span style={{ fontSize: 11, color: '#94a3b8', padding: '2px 6px' }}>{s.kind}</span>
                  {s.kind === 'normal' && (
                    <button style={S.editBtn} onClick={() => toggleStageArchived(s)}>{s.is_archived ? 'Восстановить' : 'В архив'}</button>
                  )}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input style={{ ...S.inp, flex: 1, fontSize: 12 }} placeholder="Новый этап"
                value={newStageName[f.id] ?? ''} onChange={e => setNewStageName(prev => ({ ...prev, [f.id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && createStage(f.id)} />
              <button style={{ ...S.addBtn, fontSize: 12 }} onClick={() => createStage(f.id)}>+</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── CRM: Lead Tags ─────────────────────────────────────────────────────────────

interface LeadTag { id: string; name: string; color: string | null; is_system: boolean; is_active: boolean }

function LeadTagsSection() {
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');

  async function load() {
    const { ok, data } = await api('GET', '/kviz/api/crm/lead-tags');
    if (ok && Array.isArray(data)) setTags(data);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    const { ok, data } = await api('POST', '/kviz/api/crm/lead-tags', { name: newName.trim() });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    setNewName(''); load();
  }

  async function del(tag: LeadTag) {
    if (tag.is_system) { setErr('Системные теги нельзя удалить'); return; }
    if (!confirm(`Удалить тег «${tag.name}»?`)) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/lead-tags/${tag.id}`);
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    load();
  }

  return (
    <div style={S.section}>
      {err && <div style={S.errBox}>{err}<button style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setErr('')}>✕</button></div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={{ ...S.inp, flex: 1 }} placeholder="Название тега" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        <button style={S.addBtn} onClick={create}>+ Тег</button>
      </div>
      <div style={S.list}>
        {tags.map(t => (
          <div key={t.id} style={S.row}>
            <span style={{ fontSize: 13, color: '#374151' }}>{t.name}{t.is_system && <span style={S.badge}>системный</span>}</span>
            {!t.is_system && <button style={S.delBtn} onClick={() => del(t)}>Удалить</button>}
          </div>
        ))}
        {tags.length === 0 && <div style={S.empty}>Теги не созданы</div>}
      </div>
    </div>
  );
}

// ── CRM: Task Types ────────────────────────────────────────────────────────────

interface TaskTypeRow { id: string; name: string; is_active: boolean }

function TaskTypesSection() {
  const [types, setTypes] = useState<TaskTypeRow[]>([]);
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<TaskTypeRow | null>(null);
  const [editName, setEditName] = useState('');

  async function load() {
    const { ok, data } = await api('GET', '/kviz/api/crm/task-types');
    if (ok && Array.isArray(data)) setTypes(data);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    const { ok, data } = await api('POST', '/kviz/api/crm/task-types', { name: newName.trim() });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    setNewName(''); load();
  }

  async function save() {
    if (!editing) return;
    const { ok, data } = await api('PATCH', `/kviz/api/crm/task-types/${editing.id}`, { name: editName });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    setEditing(null); load();
  }

  async function del(id: string, name: string) {
    if (!confirm(`Удалить тип «${name}»?`)) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/task-types/${id}`);
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    load();
  }

  return (
    <div style={S.section}>
      {err && <div style={S.errBox}>{err}<button style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setErr('')}>✕</button></div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={{ ...S.inp, flex: 1 }} placeholder="Название типа задачи" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        <button style={S.addBtn} onClick={create}>+ Тип</button>
      </div>
      <div style={S.list}>
        {types.map(t => (
          <div key={t.id} style={S.row}>
            {editing?.id === t.id ? (
              <>
                <input style={{ ...S.inp, flex: 1 }} value={editName} onChange={e => setEditName(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && save()} />
                <div style={S.rowActions}>
                  <button style={S.editBtn} onClick={save}>Сохранить</button>
                  <button style={S.editBtn} onClick={() => setEditing(null)}>Отмена</button>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: 13, color: '#374151' }}>{t.name}</span>
                <div style={S.rowActions}>
                  <button style={S.editBtn} onClick={() => { setEditing(t); setEditName(t.name); }}>Изменить</button>
                  <button style={S.delBtn}  onClick={() => del(t.id, t.name)}>Удалить</button>
                </div>
              </>
            )}
          </div>
        ))}
        {types.length === 0 && <div style={S.empty}>Типы задач не созданы</div>}
      </div>
    </div>
  );
}

// ── CRM: Lost Reasons ──────────────────────────────────────────────────────────

interface LostReason { id: string; name: string; is_active: boolean }

function LostReasonsSection() {
  const [reasons, setReasons] = useState<LostReason[]>([]);
  const [err, setErr] = useState('');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<LostReason | null>(null);
  const [editName, setEditName] = useState('');

  async function load() {
    const { ok, data } = await api('GET', '/kviz/api/crm/lost-reasons');
    if (ok && Array.isArray(data)) setReasons(data);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    const { ok, data } = await api('POST', '/kviz/api/crm/lost-reasons', { name: newName.trim() });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    setNewName(''); load();
  }

  async function save() {
    if (!editing) return;
    const { ok, data } = await api('PATCH', `/kviz/api/crm/lost-reasons/${editing.id}`, { name: editName });
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    setEditing(null); load();
  }

  async function del(id: string, name: string) {
    if (!confirm(`Удалить причину «${name}»?`)) return;
    const { ok, data } = await api('DELETE', `/kviz/api/crm/lost-reasons/${id}`);
    if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    load();
  }

  return (
    <div style={S.section}>
      {err && <div style={S.errBox}>{err}<button style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setErr('')}>✕</button></div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input style={{ ...S.inp, flex: 1 }} placeholder="Причина отказа" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
        <button style={S.addBtn} onClick={create}>+ Причина</button>
      </div>
      <div style={S.list}>
        {reasons.map(r => (
          <div key={r.id} style={S.row}>
            {editing?.id === r.id ? (
              <>
                <input style={{ ...S.inp, flex: 1 }} value={editName} onChange={e => setEditName(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && save()} />
                <div style={S.rowActions}>
                  <button style={S.editBtn} onClick={save}>Сохранить</button>
                  <button style={S.editBtn} onClick={() => setEditing(null)}>Отмена</button>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: 13, color: '#374151' }}>{r.name}</span>
                <div style={S.rowActions}>
                  <button style={S.editBtn} onClick={() => { setEditing(r); setEditName(r.name); }}>Изменить</button>
                  <button style={S.delBtn}  onClick={() => del(r.id, r.name)}>Удалить</button>
                </div>
              </>
            )}
          </div>
        ))}
        {reasons.length === 0 && <div style={S.empty}>Причины не созданы</div>}
      </div>
    </div>
  );
}

// ── CRM: Fitbase User Mapping ──────────────────────────────────────────────────

interface FbUser { id?: string; fitbase_user_id: number | null; fitbase_full_name: string | null; user_id: string | null }
interface AppUser { id: string; display_name: string }

function FbUsersSection() {
  const [fbNames, setFbNames]   = useState<string[]>([]);
  const [mapping, setMapping]   = useState<FbUser[]>([]);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [err, setErr]           = useState('');

  async function load() {
    const [n, m, u] = await Promise.all([
      api('GET', '/kviz/api/crm/fitbase-users'),
      api('GET', '/kviz/api/crm/fitbase-user-map'),
      api('GET', '/kviz/api/crm/app-users'),
    ]);
    if (n.ok) setFbNames(Array.isArray(n.data) ? n.data.map((x: { name: string }) => x.name) : []);
    if (m.ok) setMapping(Array.isArray(m.data) ? m.data : []);
    if (u.ok) setAppUsers(Array.isArray(u.data) ? u.data : []);
  }
  useEffect(() => { load(); }, []);

  async function setMap(fbName: string, appUserId: string) {
    const existing = mapping.find(m => m.fitbase_full_name === fbName);
    if (existing?.id) {
      const { ok, data } = await api('PATCH', `/kviz/api/crm/fitbase-user-map/${existing.id}`, { user_id: appUserId || null });
      if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    } else {
      const { ok, data } = await api('POST', '/kviz/api/crm/fitbase-user-map', { fitbase_full_name: fbName, user_id: appUserId || null });
      if (!ok) { setErr(data?.error ?? 'Ошибка'); return; }
    }
    load();
  }

  return (
    <div style={S.section}>
      {err && <div style={S.errBox}>{err}<button style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setErr('')}>✕</button></div>}
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
        Сопоставьте менеджеров Fitbase с сотрудниками приложения.
      </div>
      <div style={S.list}>
        {fbNames.map(name => {
          const mapped = mapping.find(m => m.fitbase_full_name === name);
          return (
            <div key={name} style={S.row}>
              <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>{name}</span>
              <select
                style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}
                value={mapped?.user_id ?? ''}
                onChange={e => setMap(name, e.target.value)}
              >
                <option value="">— не назначен —</option>
                {appUsers.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
            </div>
          );
        })}
        {fbNames.length === 0 && <div style={S.empty}>Нет менеджеров из Fitbase (выполните синхронизацию)</div>}
      </div>
    </div>
  );
}

// ── Scriptolog Settings ────────────────────────────────────────────────────────

interface ScriptPromo { id: string; name: string; valid_from: string | null; valid_to: string | null; is_active: boolean; rule_text: string | null; credit_text: string | null }
interface ScriptPackage { id: string; name: string; short_text: string | null; client_name: string | null; kind: string; price: number; visits: number; sessions_per_visit: number; tempo: number; validity_days: number | null; freeze_days: number; main_phase: string; mechanism: string[]; includes: string[]; excludes: string[]; payment_methods: string[]; goals: string[]; show_in_chat: boolean; sort: number; is_archived: boolean }
interface ScriptMaterial { key: string; kind: string; url: string | null; label: string | null }

const MATERIAL_LABELS: Record<string, string> = {
  video_trial: 'Видео пробного занятия', video_inbody: 'Видео InBody', memo: 'Памятка клиентки',
  gis2: 'Ссылка 2ГИС', guide_newbie: 'Гайд новичка', menu_pdf: 'Меню / питание', nutrition_chat: 'Чат по питанию',
};
const PAYMENT_OPTS = [{ v: 'cash', l: 'Нал' }, { v: 'card', l: 'Карта' }, { v: 'installment', l: 'Рассрочка' }, { v: 'bonus', l: 'Бонусы' }];
const GOAL_OPTS = [{ v: 'lose_weight', l: 'Похудеть' }, { v: 'zones', l: 'Зоны' }, { v: 'tone', l: 'Тонус' }, { v: 'cellulite', l: 'Целлюлит' }];

function ScriptMaterialsSub() {
  const [items, setItems] = useState<ScriptMaterial[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ScriptMaterial>>({});
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    const r = await fetch('/api/scriptolog/settings/materials', { credentials: 'include' });
    if (r.ok) setItems(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editing) return;
    setErr('');
    const { ok, data } = await api('PATCH', `/api/scriptolog/settings/materials/${editing}`, draft);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditing(null); setDraft({}); load();
  }

  async function handleUpload(key: string, file: File) {
    setUploading(true); setErr('');
    try {
      const ab = await file.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const { ok, data } = await api('POST', `/api/scriptolog/settings/materials/${key}/upload`, {
        content_base64: btoa(binary), content_type: file.type, filename: file.name,
      });
      if (!ok) { setErr(data.error || 'Ошибка загрузки'); return; }
      load();
    } catch (e) { setErr(String(e)); } finally { setUploading(false); }
  }

  return (
    <div>
      {err && <div style={S.errBox}>{err}</div>}
      <div style={S.list}>
        {items.map(item => (
          <div key={item.key}>
            <div style={S.row}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{MATERIAL_LABELS[item.key] ?? item.key}</span>
                <span style={S.meta}>{item.kind}{item.url ? ' · ' + item.url.slice(0, 50) + (item.url.length > 50 ? '…' : '') : ' · не задан'}</span>
              </div>
              <div style={S.rowActions}>
                <button style={S.editBtn} onClick={() => { setEditing(item.key); setDraft({ kind: item.kind, url: item.url ?? '', label: item.label ?? MATERIAL_LABELS[item.key] }); }}>✎</button>
                <button style={{ ...S.editBtn, fontSize: 11 }} onClick={() => fileRefs.current[item.key]?.click()} disabled={uploading}>↑ Файл</button>
                <input ref={el => { fileRefs.current[item.key] = el; }} type="file" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(item.key, f); e.target.value = ''; }} />
              </div>
            </div>
            {editing === item.key && (
              <div style={{ padding: '10px 14px', background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <Field label="Тип">
                    <select style={{ ...S.inp, padding: '7px 8px' }} value={draft.kind ?? 'link'} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))}>
                      <option value="link">Ссылка</option>
                      <option value="file">Файл</option>
                      <option value="video">Видео</option>
                    </select>
                  </Field>
                  <Field label="Подпись">
                    <input style={S.inp} value={draft.label ?? ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
                  </Field>
                </div>
                <Field label="URL / ссылка">
                  <input style={S.inp} value={draft.url ?? ''} onChange={e => setDraft(d => ({ ...d, url: e.target.value }))} placeholder="https://…" />
                </Field>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button style={S.saveBtn} onClick={save}>Сохранить</button>
                  <button style={S.cancelBtn} onClick={() => { setEditing(null); setDraft({}); }}>Отмена</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!items.length && <div style={S.empty}>Загрузка…</div>}
      </div>
    </div>
  );
}

function ScriptPromoSub() {
  const [promo, setPromo] = useState<ScriptPromo | null>(null);
  const [pkgs, setPkgs]   = useState<ScriptPackage[]>([]);
  const [editPromo, setEditPromo] = useState(false);
  const [editPkg, setEditPkg]     = useState<ScriptPackage | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr]     = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { ok, data } = await api('GET', '/api/scriptolog/settings/promo');
    if (ok) { setPromo(data.promo); setPkgs(Array.isArray(data.packages) ? data.packages : []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function savePromo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      id: promo?.id,
      name: fd.get('name'), valid_from: fd.get('valid_from') || null, valid_to: fd.get('valid_to') || null,
      is_active: fd.get('is_active') === 'on', rule_text: fd.get('rule_text') || null, credit_text: fd.get('credit_text') || null,
    };
    const { ok, data } = await api('PUT', '/api/scriptolog/settings/promo', body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditPromo(false); load();
  }

  async function savePkg(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payments = PAYMENT_OPTS.map(o => o.v).filter(v => fd.get('pm_' + v) === 'on');
    const goals    = GOAL_OPTS.map(o => o.v).filter(v => fd.get('goal_' + v) === 'on');
    const toArr    = (s: FormDataEntryValue | null) => s ? String(s).split('\n').map(l => l.trim()).filter(Boolean) : [];
    const body = {
      name: fd.get('name'), short_text: fd.get('short_text') || null, client_name: fd.get('client_name') || null,
      kind: fd.get('kind'), price: fd.get('price'), visits: fd.get('visits'), sessions_per_visit: fd.get('sessions_per_visit'),
      tempo: fd.get('tempo'), validity_days: fd.get('validity_days') || null, freeze_days: fd.get('freeze_days') || 0,
      main_phase: fd.get('main_phase'),
      mechanism: toArr(fd.get('mechanism')), includes: toArr(fd.get('includes')), excludes: toArr(fd.get('excludes')),
      payment_methods: payments, goals, show_in_chat: fd.get('show_in_chat') === 'on', sort: fd.get('sort') || 0,
    };
    const isNew = editPkg === 'new';
    const url = isNew ? '/api/scriptolog/settings/packages' : `/api/scriptolog/settings/packages/${(editPkg as ScriptPackage).id}`;
    const { ok, data } = await api(isNew ? 'POST' : 'PATCH', url, body);
    setLoading(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setEditPkg(null); load();
  }

  const visiblePkgs = showArchived ? pkgs : pkgs.filter(p => !p.is_archived);

  return (
    <div>
      <div style={{ ...S.subheader, marginBottom: 10 }}>
        <span style={S.subTitle}>Текущая акция</span>
        <button style={S.editBtn} onClick={() => { setEditPromo(true); setErr(''); }}>✎ Изменить</button>
      </div>
      {promo ? (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{promo.name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            {promo.valid_from ? promo.valid_from.slice(0, 10) : '—'} → {promo.valid_to ? promo.valid_to.slice(0, 10) : '∞'}
            {' · '}{promo.is_active ? <span style={{ color: '#16a34a', fontWeight: 600 }}>Активна</span> : <span style={{ color: '#94a3b8' }}>Неактивна</span>}
          </div>
          {promo.rule_text && <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>{promo.rule_text}</div>}
        </div>
      ) : (
        <div style={{ ...S.empty, marginBottom: 16, background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0' }}>Акция не настроена</div>
      )}

      <div style={{ ...S.subheader, marginTop: 16 }}>
        <span style={S.subTitle}>Пакеты</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <ArchiveToggle show={showArchived} onToggle={() => setShowArchived(p => !p)} />
          <button style={S.addBtn} onClick={() => { setEditPkg('new'); setErr(''); }}>+ Добавить</button>
        </div>
      </div>
      <div style={S.list}>
        {visiblePkgs.map(p => (
          <div key={p.id} style={{ ...S.row, opacity: p.is_archived ? 0.6 : 1 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
              {p.is_archived && <span style={S.badge}>архив</span>}
              <span style={S.meta}>{p.kind.toUpperCase()} · {p.price.toLocaleString('ru')} ₸ · {p.visits} виз.</span>
            </div>
            <div style={S.rowActions}>
              <button style={S.editBtn} onClick={() => { setEditPkg(p); setErr(''); }}>✎</button>
              {!p.is_archived && <button style={S.editBtn} onClick={() => api('PATCH', `/api/scriptolog/settings/packages/${p.id}/archive`, {}).then(load)}>В архив</button>}
            </div>
          </div>
        ))}
        {!visiblePkgs.length && <div style={S.empty}>Нет пакетов</div>}
      </div>

      {editPromo && (
        <Modal title="Редактировать акцию" onClose={() => { setEditPromo(false); setErr(''); }}>
          <form onSubmit={savePromo}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название акции *"><input style={S.inp} name="name" required defaultValue={promo?.name ?? ''} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Начало"><input style={S.inp} name="valid_from" type="date" defaultValue={promo?.valid_from?.slice(0, 10) ?? ''} /></Field>
              <Field label="Конец"><input style={S.inp} name="valid_to" type="date" defaultValue={promo?.valid_to?.slice(0, 10) ?? ''} /></Field>
            </div>
            <Field label="Текст правил"><textarea style={{ ...S.inp, height: 60, resize: 'vertical' }} name="rule_text" defaultValue={promo?.rule_text ?? ''} /></Field>
            <Field label="Текст рассрочки"><textarea style={{ ...S.inp, height: 60, resize: 'vertical' }} name="credit_text" defaultValue={promo?.credit_text ?? ''} /></Field>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 16 }}>
              <input type="checkbox" name="is_active" defaultChecked={promo?.is_active ?? true} /> Активна
            </label>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditPromo(false); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}

      {editPkg && (
        <Modal title={editPkg === 'new' ? 'Новый пакет' : 'Редактировать пакет'} onClose={() => { setEditPkg(null); setErr(''); }}>
          <form onSubmit={savePkg} style={{ maxHeight: '78vh', overflowY: 'auto', paddingRight: 4 }}>
            {err && <div style={S.errBox}>{err}</div>}
            <Field label="Название *"><input style={S.inp} name="name" required defaultValue={editPkg === 'new' ? '' : (editPkg as ScriptPackage).name} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Короткая строка"><input style={S.inp} name="short_text" defaultValue={editPkg === 'new' ? '' : ((editPkg as ScriptPackage).short_text ?? '')} /></Field>
              <Field label="Название для клиента"><input style={S.inp} name="client_name" defaultValue={editPkg === 'new' ? '' : ((editPkg as ScriptPackage).client_name ?? '')} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Тип">
                <select style={{ ...S.inp, padding: '9px 8px' }} name="kind" defaultValue={editPkg === 'new' ? 'vacu' : (editPkg as ScriptPackage).kind}>
                  <option value="vacu">VACU</option>
                  <option value="cross">CROSS</option>
                </select>
              </Field>
              <Field label="Основная фаза">
                <select style={{ ...S.inp, padding: '9px 8px' }} name="main_phase" defaultValue={editPkg === 'new' ? 'vacu_fixed' : (editPkg as ScriptPackage).main_phase}>
                  <option value="vacu_fixed">Фиксированная VACU</option>
                  <option value="choice">Выбор клиентки</option>
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Field label="Цена ₸ *"><input style={S.inp} name="price" type="number" min="0" required defaultValue={editPkg === 'new' ? '' : (editPkg as ScriptPackage).price} /></Field>
              <Field label="Визитов"><input style={S.inp} name="visits" type="number" min="0" defaultValue={editPkg === 'new' ? '' : (editPkg as ScriptPackage).visits} /></Field>
              <Field label="Сеансов/визит"><input style={S.inp} name="sessions_per_visit" type="number" min="0" defaultValue={editPkg === 'new' ? '' : (editPkg as ScriptPackage).sessions_per_visit} /></Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Field label="Темп (нед)">
                <select style={{ ...S.inp, padding: '9px 8px' }} name="tempo" defaultValue={editPkg === 'new' ? '2' : String((editPkg as ScriptPackage).tempo)}>
                  <option value="2">2/нед</option>
                  <option value="3">3/нед</option>
                </select>
              </Field>
              <Field label="Срок (дн)"><input style={S.inp} name="validity_days" type="number" min="1" defaultValue={editPkg === 'new' ? '' : ((editPkg as ScriptPackage).validity_days ?? '')} /></Field>
              <Field label="Заморозка (дн)"><input style={S.inp} name="freeze_days" type="number" min="0" defaultValue={editPkg === 'new' ? '0' : (editPkg as ScriptPackage).freeze_days} /></Field>
            </div>
            <Field label="Механизм (каждое по новой строке)"><textarea style={{ ...S.inp, height: 56, resize: 'vertical' }} name="mechanism" defaultValue={editPkg === 'new' ? '' : (editPkg as ScriptPackage).mechanism.join('\n')} /></Field>
            <Field label="Что включено"><textarea style={{ ...S.inp, height: 56, resize: 'vertical' }} name="includes" defaultValue={editPkg === 'new' ? '' : (editPkg as ScriptPackage).includes.join('\n')} /></Field>
            <Field label="Что нельзя"><textarea style={{ ...S.inp, height: 56, resize: 'vertical' }} name="excludes" defaultValue={editPkg === 'new' ? '' : (editPkg as ScriptPackage).excludes.join('\n')} /></Field>
            <Field label="Оплата">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                {PAYMENT_OPTS.map(o => (
                  <label key={o.v} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" name={'pm_' + o.v} defaultChecked={editPkg !== 'new' && (editPkg as ScriptPackage).payment_methods.includes(o.v)} /> {o.l}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Цели">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' as const }}>
                {GOAL_OPTS.map(o => (
                  <label key={o.v} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" name={'goal_' + o.v} defaultChecked={editPkg !== 'new' && (editPkg as ScriptPackage).goals.includes(o.v)} /> {o.l}
                  </label>
                ))}
              </div>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Порядок"><input style={S.inp} name="sort" type="number" defaultValue={editPkg === 'new' ? '0' : (editPkg as ScriptPackage).sort} /></Field>
              <div style={{ paddingTop: 20 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" name="show_in_chat" defaultChecked={editPkg === 'new' ? true : (editPkg as ScriptPackage).show_in_chat} /> Показывать в чате
                </label>
              </div>
            </div>
            <div style={S.mBtns}>
              <button type="button" style={S.cancelBtn} onClick={() => { setEditPkg(null); setErr(''); }}>Отмена</button>
              <button type="submit" style={S.saveBtn} disabled={loading}>{loading ? '…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ScriptologSection() {
  type Sub = 'promo' | 'materials';
  const [sub, setSub] = useState<Sub>('promo');
  return (
    <div style={S.section}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button style={{ ...S.subNavBtn, ...(sub === 'promo' ? S.subNavActive : {}) }} onClick={() => setSub('promo')}>Акция и пакеты</button>
        <button style={{ ...S.subNavBtn, ...(sub === 'materials' ? S.subNavActive : {}) }} onClick={() => setSub('materials')}>Материалы</button>
      </div>
      {sub === 'promo'     && <ScriptPromoSub />}
      {sub === 'materials' && <ScriptMaterialsSub />}
    </div>
  );
}

// ── Control Settings ───────────────────────────────────────────────────────────

interface ControlCfg {
  enabled: boolean; alerts_to_agent: boolean; show_to_managers: boolean;
  fix_rate: number; standard_price: number;
  open_time: string; close_time_weekday: string; close_time_weekend: string; fix_deadline_time: string;
  s1_enabled: boolean; s1_contact_minutes: number; s1_grace_count: number; s1_grace_max_minutes: number;
  s2_enabled: boolean; s2_random_per_shift: number; s2_unreviewed_counts: boolean;
  s3_enabled: boolean; s3_task_max_days: number; s3_booked_stage_ids: string[]; s3_checks: string[];
  staff_name_map: Record<string, string>; name_stop_words: string[];
  session_minutes: number; s3_after_minutes: number;
  s4_enabled: boolean; s4_sessions_left: number; s4_ended_contact_days: number; s4_no_visit_days: number; s4_retry_days: number; s4_checks: string[];
  s5_enabled: boolean; s5_mark_minutes: number; s5_checks: string[];
}

const S3_CHECKS = ['s3_no_source','s3_no_manager','s3_no_task','s3_no_lost_reason','s3_bad_comment','s3_no_client_card','s3_no_booking','s3_no_next_step','s3_client_fields','s3_bad_name'];
const S3_LABELS: Record<string,string> = {
  s3_no_source: 'Нет источника', s3_no_manager: 'Нет менеджера',
  s3_no_task: 'Нет задачи', s3_no_lost_reason: 'Нет причины отказа', s3_bad_comment: 'Комментарий не по шаблону',
  s3_no_client_card: 'Нет карточки клиента в Fitbase', s3_no_booking: 'Нет записи и нет задачи',
  s3_no_next_step: 'Нет шага после пробного', s3_client_fields: 'Неполная карточка после покупки',
  s3_bad_name: 'Служебное/неполное имя',
};
const S4_CHECKS = ['s4_ending','s4_ended','s4_no_visits','s4_task_overdue'];
const S4_LABELS: Record<string,string> = {
  s4_ending: 'Заканчивается абонемент', s4_ended: 'Истёк абонемент',
  s4_no_visits: 'Нет визитов N дней', s4_task_overdue: 'Просроченные задачи',
};
const S5_CHECKS = ['s5_unmarked','s5_no_abonement','s5_expired_abonement'];
const S5_LABELS: Record<string,string> = {
  s5_unmarked: 'Не отмечены вовремя', s5_no_abonement: 'Без абонемента',
  s5_expired_abonement: 'По истёкшему абонементу',
};

function CheckList({ checks, labels, value, onChange }: {
  checks: string[]; labels: Record<string,string>; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {checks.map(c => (
        <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={value.includes(c)} onChange={e => {
            onChange(e.target.checked ? [...value, c] : value.filter(x => x !== c));
          }} />
          {labels[c] ?? c}
        </label>
      ))}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16 }} />
      {label}
    </label>
  );
}

function NumField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 3 }}>{label}</label>
      <input type="number" value={value} min={min} max={max}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 3 }}>{label}</label>
      <input type="time" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}

function ControlSettingsSection() {
  const [cfg, setCfg] = useState<ControlCfg | null>(null);
  const [stages, setStages] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/kviz/api/control/settings', { credentials: 'include' }).then(r => r.json()),
      fetch('/kviz/api/control/funnel-stages', { credentials: 'include' }).then(r => r.json()),
    ]).then(([c, s]) => {
      setCfg(c as ControlCfg);
      setStages(Array.isArray(s) ? s : []);
    });
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true); setErr(''); setOk(false);
    const { ok: success, data } = await api('PUT', '/kviz/api/control/settings', cfg);
    setSaving(false);
    if (!success) { setErr(data.error || 'Ошибка'); } else setOk(true);
  }

  if (!cfg) return <div style={S.section}><div style={{ color: '#94a3b8', padding: 24 }}>Загрузка…</div></div>;

  function patch(p: Partial<ControlCfg>) { setCfg(prev => prev ? { ...prev, ...p } : prev); setOk(false); }

  const grpStyle: React.CSSProperties = { background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px 16px', marginBottom: 16 };
  const grpTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 12 };
  const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' };

  return (
    <div style={{ ...S.section, maxWidth: 640 }}>
      {err && <div style={S.errBox}>{err}</div>}
      {ok  && <div style={{ ...S.errBox, background: '#f0fdf4', color: '#16a34a' }}>Сохранено</div>}

      {/* General */}
      <div style={grpStyle}>
        <div style={grpTitle}>Общие</div>
        <ToggleRow label="Включено" checked={cfg.enabled} onChange={v => patch({ enabled: v })} />
        <ToggleRow label="Тревоги в овчарку (сейчас выкл)" checked={cfg.alerts_to_agent} onChange={v => patch({ alerts_to_agent: v })} />
        <ToggleRow label="Показывать результаты менеджерам (сейчас выкл)" checked={cfg.show_to_managers} onChange={v => patch({ show_to_managers: v })} />
        <div style={twoCol}>
          <NumField label="Фикс за смену ₸" value={cfg.fix_rate} onChange={v => patch({ fix_rate: v })} min={0} max={1000000} />
          <NumField label="Цена стандарта ₸" value={cfg.standard_price} onChange={v => patch({ standard_price: v })} min={0} max={100000} />
        </div>
        <div style={twoCol}>
          <TimeField label="Открытие" value={cfg.open_time} onChange={v => patch({ open_time: v })} />
          <TimeField label="Срок исправления" value={cfg.fix_deadline_time} onChange={v => patch({ fix_deadline_time: v })} />
        </div>
        <div style={twoCol}>
          <TimeField label="Закрытие пн–пт" value={cfg.close_time_weekday} onChange={v => patch({ close_time_weekday: v })} />
          <TimeField label="Закрытие сб–вс" value={cfg.close_time_weekend} onChange={v => patch({ close_time_weekend: v })} />
        </div>
      </div>

      {/* S1 */}
      <div style={grpStyle}>
        <div style={grpTitle}>№1 Скорость первого контакта</div>
        <ToggleRow label="Включён" checked={cfg.s1_enabled} onChange={v => patch({ s1_enabled: v })} />
        <div style={twoCol}>
          <NumField label="Минут на первый контакт" value={cfg.s1_contact_minutes} onChange={v => patch({ s1_contact_minutes: v })} min={1} max={240} />
          <NumField label="Опозданий прощается за смену" value={cfg.s1_grace_count} onChange={v => patch({ s1_grace_count: v })} min={0} max={10} />
        </div>
        <NumField label="Макс. мин. прощаемого опоздания" value={cfg.s1_grace_max_minutes} onChange={v => patch({ s1_grace_max_minutes: v })} min={1} max={240} />
      </div>

      {/* S2 */}
      <div style={grpStyle}>
        <div style={grpTitle}>№2 Качество диалога</div>
        <ToggleRow label="Включён" checked={cfg.s2_enabled} onChange={v => patch({ s2_enabled: v })} />
        <NumField label="Случайных диалогов за смену" value={cfg.s2_random_per_shift} onChange={v => patch({ s2_random_per_shift: v })} min={0} max={20} />
        <ToggleRow label="Не проверено = выполнено" checked={cfg.s2_unreviewed_counts} onChange={v => patch({ s2_unreviewed_counts: v })} />
      </div>

      {/* S3 */}
      <div style={grpStyle}>
        <div style={grpTitle}>№3 Карточка заявки</div>
        <ToggleRow label="Включён" checked={cfg.s3_enabled} onChange={v => patch({ s3_enabled: v })} />
        <NumField label="Макс. дней до срока задачи" value={cfg.s3_task_max_days} onChange={v => patch({ s3_task_max_days: v })} min={1} max={30} />
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Этапы «Записан» (мультивыбор)</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stages.map(st => (
              <label key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox"
                  checked={cfg.s3_booked_stage_ids.includes(st.id)}
                  onChange={e => patch({ s3_booked_stage_ids: e.target.checked ? [...cfg.s3_booked_stage_ids, st.id] : cfg.s3_booked_stage_ids.filter(x => x !== st.id) })}
                />
                {st.name}
              </label>
            ))}
            {!stages.length && <span style={{ fontSize: 12, color: '#94a3b8' }}>Этапы не загружены</span>}
          </div>
        </div>
        <div style={twoCol}>
          <NumField label="Минут сеанса (session_minutes)" value={cfg.session_minutes ?? 30} onChange={v => patch({ session_minutes: v })} min={5} max={240} />
          <NumField label="Минут после пробного (s3_after)" value={cfg.s3_after_minutes ?? 30} onChange={v => patch({ s3_after_minutes: v })} min={1} max={120} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Стоп-слова в именах (через запятую)</label>
          <input style={{ width: '100%', padding: '6px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }}
            value={(cfg.name_stop_words ?? []).join(', ')}
            onChange={e => patch({ name_stop_words: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
        </div>
        <div style={{ marginBottom: 4, fontSize: 12, fontWeight: 600, color: '#64748b' }}>Проверки</div>
        <CheckList checks={S3_CHECKS} labels={S3_LABELS} value={cfg.s3_checks} onChange={v => patch({ s3_checks: v })} />
      </div>

      {/* S4 */}
      <div style={grpStyle}>
        <div style={grpTitle}>№4 База клиентов</div>
        <ToggleRow label="Включён" checked={cfg.s4_enabled} onChange={v => patch({ s4_enabled: v })} />
        <div style={twoCol}>
          <NumField label="Визитов осталось (порог)" value={cfg.s4_sessions_left} onChange={v => patch({ s4_sessions_left: v })} min={1} max={20} />
          <NumField label="Дней без контакта (истёк)" value={cfg.s4_ended_contact_days} onChange={v => patch({ s4_ended_contact_days: v })} min={1} max={30} />
        </div>
        <div style={twoCol}>
          <NumField label="Дней без визитов" value={cfg.s4_no_visit_days} onChange={v => patch({ s4_no_visit_days: v })} min={1} max={60} />
          <NumField label="Дней до повторной проверки" value={cfg.s4_retry_days} onChange={v => patch({ s4_retry_days: v })} min={1} max={30} />
        </div>
        <div style={{ marginBottom: 4, fontSize: 12, fontWeight: 600, color: '#64748b' }}>Проверки</div>
        <CheckList checks={S4_CHECKS} labels={S4_LABELS} value={cfg.s4_checks} onChange={v => patch({ s4_checks: v })} />
      </div>

      {/* S5 */}
      <div style={grpStyle}>
        <div style={grpTitle}>№5 Посещения</div>
        <ToggleRow label="Включён" checked={cfg.s5_enabled} onChange={v => patch({ s5_enabled: v })} />
        <NumField label="Минут на отметку после начала сеанса" value={cfg.s5_mark_minutes} onChange={v => patch({ s5_mark_minutes: v })} min={5} max={240} />
        <div style={{ marginBottom: 4, fontSize: 12, fontWeight: 600, color: '#64748b' }}>Проверки</div>
        <CheckList checks={S5_CHECKS} labels={S5_LABELS} value={cfg.s5_checks} onChange={v => patch({ s5_checks: v })} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={S.saveBtn} onClick={save} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

// ── Main SettingsPage ──────────────────────────────────────────────────────────

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'devices',    label: 'Аппараты',           icon: '⚙️' },
  { id: 'abonements', label: 'Абонементы',          icon: '📋' },
  { id: 'services',   label: 'Услуги',              icon: '🛎️' },
  { id: 'products',   label: 'Товары и склад',       icon: '📦' },
  { id: 'suppliers',  label: 'Поставщики',           icon: '🏭' },
  { id: 'promos',     label: 'Промокоды',            icon: '🎁' },
  { id: 'payments',   label: 'Виды оплаты',          icon: '💳' },
  { id: 'sources',    label: 'Рекламные источники',  icon: '📣' },
  { id: 'classes',    label: 'Занятия',              icon: '🏃' },
  { id: 'service',    label: 'Сервис',               icon: '🔧' },
  { id: 'finance',      label: 'Финансы',              icon: '💰' },
  { id: 'funnels',      label: 'Воронки CRM',          icon: '🔀' },
  { id: 'lead-tags',    label: 'Теги заявок',          icon: '🏷️' },
  { id: 'task-types',   label: 'Типы задач',           icon: '✅' },
  { id: 'lost-reasons', label: 'Причины отказа',       icon: '❌' },
  { id: 'fb-users',     label: 'Сопоставление FB',     icon: '👤' },
  { id: 'scriptolog',   label: 'Скриптолог',           icon: '📝' },
  { id: 'control',      label: 'Контроль менеджеров',  icon: '📊' },
];

export default function SettingsPage() {
  const [section, setSection] = useState<Section>(() => {
    try { return (sessionStorage.getItem('crm-settings-section') as Section) || 'devices'; } catch { return 'devices'; }
  });
  const [mobileContent, setMobileContent] = useState(false);

  function nav(s: Section) {
    setSection(s);
    setMobileContent(true);
    try { sessionStorage.setItem('crm-settings-section', s); } catch {}
  }

  return (
    <div className="settings-wrap" style={{ display: 'flex', height: '100vh', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc' }}>
      <div className={`settings-sidebar${mobileContent ? ' settings-sidebar--hidden' : ''}`} style={S.sidebar}>
        <div style={S.sidebarTitle}>Настройки</div>
        {NAV.map(n => (
          <button key={n.id} style={{ ...S.navItem, ...(section === n.id ? S.navActive : {}) }} onClick={() => nav(n.id)}>
            <span style={{ marginRight: 8 }}>{n.icon}</span>{n.label}
          </button>
        ))}
      </div>
      <div className={`settings-content${!mobileContent ? ' settings-content--hidden' : ''}`} style={S.content}>
        <div style={S.contentHeader}>
          <button className="settings-back-btn" style={{ background: 'none', border: 'none', color: '#263CD9', cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: '0 12px 0 0', fontFamily: 'inherit' }}
            onClick={() => setMobileContent(false)}>← Назад</button>
          {NAV.find(n => n.id === section)?.label}
        </div>
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
        {section === 'finance'    && <FinanceSection />}
        {section === 'funnels'    && <FunnelsSection />}
        {section === 'lead-tags'  && <LeadTagsSection />}
        {section === 'task-types' && <TaskTypesSection />}
        {section === 'lost-reasons' && <LostReasonsSection />}
        {section === 'fb-users'   && <FbUsersSection />}
        {section === 'scriptolog' && <ScriptologSection />}
        {section === 'control'    && <ControlSettingsSection />}
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
  rowActions:    { display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' as const },
  meta:          { display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 },
  badge:         { display: 'inline-block', marginLeft: 6, padding: '1px 6px', fontSize: 11, borderRadius: 6, background: '#fee2e2', color: '#ef4444' },
  empty:         { padding: '12px 14px', color: '#94a3b8', fontSize: 13 },
  addBtn:        { padding: '6px 14px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  editBtn:       { padding: '4px 10px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' },
  delBtn:        { padding: '4px 10px', background: 'none', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#ef4444' },
  iconBtn:       { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#64748b', padding: '2px 6px' },
  overlay:       { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal:         { background: '#fff', borderRadius: 16, padding: 24, width: 'min(480px,96vw)', maxHeight: '90vh', overflow: 'auto' },
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
