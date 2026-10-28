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
      <div style={S.sidebar}>
        <div style={S.sidebarTitle}>Настройки</div>
        {NAV.map(n => (
          <button key={n.id} style={{ ...S.navItem, ...(section === n.id ? S.navActive : {}) }} onClick={() => nav(n.id)}>
            <span style={{ marginRight: 8 }}>{n.icon}</span>{n.label}
          </button>
        ))}
      </div>
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
