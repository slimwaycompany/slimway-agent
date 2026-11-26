import { useState, useEffect } from 'react';
import Modal from '../../components/ui/Modal';
import { Icon } from '../../components/ui/Icon';
import { Banknote, CreditCard, Wallet, Gift, Snowflake, Play, Zap } from 'lucide-react';
import { formatPlanRestriction } from '../../lib/planRestriction';

// ── Shared types (mirrored from ClientsPage / SettingsPage) ──────────────────

interface ClientPlanItem {
  device_type_code: string | null;
  device_type_codes?: string[] | null;
  sessions_total: number;
  sessions_left: number;
  phase: string;
  is_unlimited?: boolean;
  daily_limit?: number | null;
}

export interface CPlan {
  id: string;
  plan_id: string | null;
  source?: string;
  name?: string | null;
  status: string;
  purchased_at: string;
  activated_at: string | null;
  valid_until: string | null;
  sessions_total?: number | null;
  sessions_left?: number | null;
  needs_split?: boolean;
  freeze_days_used?: number | null;
  allowed_weekdays?: number[] | null;
  time_from?: string | null;
  time_to?: string | null;
  price?: number | null;
  sale_id?: string | null;
  sold_by?: string | null;
  plan: { id: string; name: string; kind: string; freeze_days?: number | null; extra_days?: number | null } | null;
  crm_client_plan_items: ClientPlanItem[];
}

export interface TPlan {
  id: string;
  kind: string;
  name: string;
  price: number;
  is_promo: boolean;
  is_free_booking: boolean;
  is_active: boolean;
  is_system: boolean;
  validity_days: number | null;
  extra_days: number | null;
  freeze_days: number | null;
  guest_visits: number | null;
  auto_activate_days: number | null;
  max_deferred_start_days: number | null;
  items?: {
    id: string; plan_id: string; device_type_code: string | null;
    device_type_codes?: string[] | null; phase: string | null;
    sessions: number; is_unlimited?: boolean; daily_limit?: number | null; sort: number;
  }[];
  allowed_weekdays?: number[] | null;
  time_from?: string | null;
  time_to?: string | null;
}

interface PlanDetail {
  sale: {
    number: number | null;
    created_at: string;
    cashier: string | null;
    total: number;
    items_count: number;
    payments: { name: string; kind: string; amount: number }[];
  } | null;
  visits: { id: string; date: string | null; time: string | null; status: string; device: string | null; source: 'crm' | 'fitbase' }[];
  freezes: { at: string; kind: 'freeze' | 'unfreeze'; days: number | null; reason: string; author: string }[];
  counts: { attended: number; no_show: number; total: number };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().join('.');
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('ru-RU') + ' ₸';
}

const STATUS_MAP: Record<string, { text: string; cls: string }> = {
  not_activated: { text: 'Не активирован', cls: 'pw-status--pending' },
  active:        { text: 'Активен',         cls: 'pw-status--active'  },
  frozen:        { text: 'Заморожен',        cls: 'pw-status--frozen'  },
  expired:       { text: 'Истёк',            cls: 'pw-status--expired' },
  refunded:      { text: 'Возвращён',        cls: 'pw-status--muted'   },
  cancelled:     { text: 'Отменён',          cls: 'pw-status--muted'   },
};

const VISIT_COLOR: Record<string, string> = {
  attended: 'var(--success)', no_show: 'var(--danger)',
  late_cancel: 'var(--warning)', cancelled: 'var(--text-3)',
};
const VISIT_LABEL: Record<string, string> = {
  attended: 'Пришла', no_show: 'Не пришла', late_cancel: 'Поздняя отмена', cancelled: 'Отменена',
};
const PM_ICON: Record<string, typeof Banknote> = {
  cash: Banknote, cashless: CreditCard, deposit: Wallet, bonus: Gift,
};

// ── Inner components ──────────────────────────────────────────────────────────

function CompClientItems({ items, dtNameMap }: { items: ClientPlanItem[]; dtNameMap: Record<string, string> }) {
  return (
    <>
      {items.map((it, i) => {
        const isPool = Array.isArray(it.device_type_codes) && it.device_type_codes.length > 0;
        const name = isPool
          ? 'Cross: ' + it.device_type_codes!.map(c => dtNameMap[c] ?? c).join(' / ')
          : (dtNameMap[it.device_type_code ?? ''] ?? it.device_type_code ?? '?');
        const phaseLbl = it.phase === 'finishing' ? 'Завершающая' : 'Активная';
        const total = it.sessions_total;
        const left = it.sessions_left;
        const pct = total > 0 ? Math.round((left / total) * 100) : 0;
        return (
          <div key={i} className="pw-comp-item">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{phaseLbl}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {it.is_unlimited ? (
                <div style={{ fontSize: 24, fontWeight: 700 }}>∞{it.daily_limit ? <span style={{ fontSize: 14 }}> (1 в день)</span> : null}</div>
              ) : (
                <>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {left} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)' }}>/ {total}</span>
                  </div>
                  <div style={{ width: 80, height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 4 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 2 }} />
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function CompTemplateItems({ items, dtNameMap }: { items: TPlan['items']; dtNameMap: Record<string, string> }) {
  if (!items?.length) return <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Состав не задан</div>;
  return (
    <>
      {items.map((it, i) => {
        const isPool = Array.isArray(it.device_type_codes) && it.device_type_codes.length > 0;
        const name = isPool
          ? 'Cross: ' + it.device_type_codes!.map(c => dtNameMap[c] ?? c).join(' / ')
          : (dtNameMap[it.device_type_code ?? ''] ?? it.device_type_code ?? '?');
        const phaseLbl = it.phase === 'finishing' ? 'Завершающая' : 'Активная';
        return (
          <div key={i} className="pw-comp-item">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{phaseLbl}</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {it.is_unlimited ? (
                <div style={{ fontSize: 24, fontWeight: 700 }}>∞{it.daily_limit ? <span style={{ fontSize: 14 }}> (1 в день)</span> : null}</div>
              ) : (
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {it.sessions} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)' }}>сеансов</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function VisitsContent({ detail }: { detail: PlanDetail | null }) {
  if (!detail) return <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Загрузка…</div>;
  const { visits, counts } = detail;
  return (
    <>
      <div style={{ display: 'flex', gap: 12, fontSize: 13, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ color: 'var(--success)' }}>Пришла {counts.attended}</span>
        <span style={{ color: 'var(--danger)' }}>Не пришла {counts.no_show}</span>
        <span style={{ color: 'var(--text-3)' }}>Всего {counts.total}</span>
      </div>
      {visits.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Посещений по этому абонементу нет</div>
      ) : (
        <div>
          {visits.map(v => (
            <div key={v.id} className="pw-visit-row">
              <span style={{ color: 'var(--text-3)', fontSize: 12, minWidth: 70, flexShrink: 0 }}>{fmtDate(v.date)}</span>
              {v.time && <span style={{ color: 'var(--text-2)', fontSize: 12, minWidth: 36, flexShrink: 0 }}>{v.time}</span>}
              <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.device ?? '—'}</span>
              <span style={{ color: VISIT_COLOR[v.status] ?? 'var(--text-2)', fontSize: 12, flexShrink: 0 }}>
                {VISIT_LABEL[v.status] ?? v.status}
              </span>
              {v.source === 'fitbase' && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, marginLeft: 4 }}>Fitbase</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── ClientPlanWindow ──────────────────────────────────────────────────────────

function ClientPlanWindow({ plan, dtNameMap, canEdit, onClose, onFreeze, onUnfreeze, onSplit }: {
  plan: CPlan; dtNameMap: Record<string, string>; canEdit: boolean;
  onClose: () => void; onFreeze: () => void; onUnfreeze: () => void; onSplit: () => void;
}) {
  const [detail, setDetail] = useState<PlanDetail | null>(null);

  useEffect(() => {
    setDetail(null);
    fetch(`/kviz/api/crm/client-plans/${plan.id}/detail`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setDetail(d))
      .catch(() => setDetail({ sale: null, visits: [], freezes: [], counts: { attended: 0, no_show: 0, total: 0 } }));
  }, [plan.id]);

  const planName = plan.plan?.name ?? plan.name ?? '—';
  const extraDays = plan.plan?.extra_days ?? 0;
  const freezeDays = plan.plan?.freeze_days ?? 0;
  const usedDays = plan.freeze_days_used ?? 0;
  const st = STATUS_MAP[plan.status] ?? { text: plan.status, cls: 'pw-status--muted' };

  const preEnd = plan.valid_until
    ? new Date(new Date(plan.valid_until).getTime() - 10 * 86400000).toISOString().slice(0, 10)
    : null;
  const endExtra = plan.valid_until && extraDays > 0
    ? new Date(new Date(plan.valid_until).getTime() + extraDays * 86400000).toISOString().slice(0, 10)
    : null;

  const restriction = formatPlanRestriction(plan);
  const totalVisits = detail?.counts.total ?? '…';

  return (
    <Modal title={planName} size="xl" onClose={onClose}>
      <div className="pw-cols">
        <div className="pw-col-left">
          {/* Status + Fitbase */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`pw-comp-badge ${st.cls}`} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 13 }}>{st.text}</span>
            {plan.source === 'fitbase' && (
              <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 7px', borderRadius: 20 }}>Fitbase</span>
            )}
          </div>

          {/* Price */}
          <div>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{fmtMoney(plan.price)}</div>
            {plan.sold_by && <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>Продавец: {plan.sold_by}</div>}
          </div>

          {/* Sale/payment */}
          <div>
            <div className="pw-section-title">Оплата</div>
            {!detail ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Загрузка…</div>
            ) : !detail.sale ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Вид оплаты: нет данных</div>
            ) : (
              <>
                {detail.sale.payments.map((p, i) => {
                  const Ic = PM_ICON[p.kind] ?? Banknote;
                  return (
                    <div key={i} className="pw-pay-row">
                      <Icon icon={Ic} size={16} />
                      <span style={{ flex: 1 }}>{p.name}</span>
                      <span style={{ fontWeight: 600 }}>{fmtMoney(p.amount)}</span>
                    </div>
                  );
                })}
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                  Чек №{detail.sale.number ?? '—'} от {fmtDate(detail.sale.created_at)}
                  {detail.sale.cashier ? ` · кассир ${detail.sale.cashier}` : ''}
                </div>
                {detail.sale.items_count > 1 && (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                    оплата за весь чек, сумма чека {fmtMoney(detail.sale.total)}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Composition */}
          <div>
            <div className="pw-section-title">Состав</div>
            {plan.crm_client_plan_items.length > 0 ? (
              <CompClientItems items={plan.crm_client_plan_items} dtNameMap={dtNameMap} />
            ) : plan.source === 'fitbase' && plan.sessions_left != null ? (
              <div className="pw-comp-item">
                <div style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Сеансы</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>
                  {plan.sessions_left}{' '}
                  <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)' }}>/ {plan.sessions_total ?? '?'}</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Состав не задан</div>
            )}
          </div>

          {/* Visits — mobile-only (between composition and dates) */}
          <div className="pw-visits-mobile">
            <div className="pw-section-title">Посещения · {totalVisits}</div>
            <VisitsContent detail={detail} />
          </div>

          {/* Dates */}
          <div>
            <div className="pw-section-title">Даты</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Куплен',           val: fmtDate(plan.purchased_at) },
                { label: 'Активирован',      val: fmtDate(plan.activated_at) },
                { label: 'Предв. окончание', val: fmtDate(preEnd) },
                { label: endExtra ? `Окончание (до ${fmtDate(endExtra)})` : 'Окончание', val: fmtDate(plan.valid_until) },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Restriction */}
          {restriction && (
            <div style={{ fontSize: 13, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 8, padding: '8px 12px' }}>
              Когда действует: {restriction}
            </div>
          )}

          {/* Freeze history */}
          <div>
            <div className="pw-section-title">Заморозка</div>
            {freezeDays > 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
                Использовано {usedDays} из {freezeDays} дн.
              </div>
            )}
            {!detail ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Загрузка…</div>
            ) : detail.freezes.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>История заморозок пуста</div>
            ) : (
              detail.freezes.map((f, i) => (
                <div key={i} className="pw-freeze-row">
                  <div className="pw-freeze-row-header">
                    <Icon icon={f.kind === 'freeze' ? Snowflake : Play} size={16} />
                    <span>{fmtDate(f.at)}</span>
                    <span>{f.kind === 'freeze' ? `Заморозка на ${f.days} дн.` : 'Разморозка'}</span>
                    <span style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 400, marginLeft: 'auto' }}>{f.author}</span>
                  </div>
                  {f.reason && <div className="pw-freeze-reason">{f.reason}</div>}
                </div>
              ))
            )}
          </div>

          {/* Action buttons */}
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {plan.status === 'active' && (
                <button className="cp-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => { onClose(); onFreeze(); }}>
                  <Icon icon={Snowflake} size={16} /> Заморозить
                </button>
              )}
              {plan.status === 'frozen' && (
                <button className="cp-btn" style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => { onClose(); onUnfreeze(); }}>
                  <Icon icon={Play} size={16} /> Разморозить
                </button>
              )}
              {plan.needs_split && (
                <button className="cp-btn" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--warning)' }}
                  onClick={() => { onClose(); onSplit(); }}>
                  <Icon icon={Zap} size={16} /> Распределить
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right column — visits (desktop) */}
        <div className="pw-col-right">
          <div className="pw-section-title" style={{ marginBottom: 0 }}>Посещения · {totalVisits}</div>
          <VisitsContent detail={detail} />
        </div>
      </div>
    </Modal>
  );
}

// ── TemplatePlanWindow ────────────────────────────────────────────────────────

function TemplatePlanWindow({ plan, dtNameMap, canEdit, onEdit, onClose }: {
  plan: TPlan; dtNameMap: Record<string, string>; canEdit: boolean;
  onEdit: () => void; onClose: () => void;
}) {
  const restriction = formatPlanRestriction(plan);

  return (
    <Modal title={plan.name} size="xl" onClose={onClose}>
      <div className="pw-cols">
        <div className="pw-col-left">
          {/* Badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {plan.is_promo && (
              <span style={{ fontSize: 12, background: 'var(--warning-soft)', color: 'var(--warning)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>Акция</span>
            )}
            {plan.is_system && (
              <span style={{ fontSize: 12, background: 'var(--accent-soft)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>Системный</span>
            )}
            {!plan.is_active && (
              <span style={{ fontSize: 12, background: 'var(--surface-2)', color: 'var(--text-3)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>В архиве</span>
            )}
            {plan.is_free_booking && (
              <span style={{ fontSize: 12, background: 'var(--primary-soft)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>Бесплатная запись</span>
            )}
          </div>

          {/* Price */}
          <div style={{ fontSize: 32, fontWeight: 700 }}>{fmtMoney(plan.price)}</div>

          {/* Composition */}
          <div>
            <div className="pw-section-title">Состав</div>
            <CompTemplateItems items={plan.items} dtNameMap={dtNameMap} />
          </div>

          {/* Restriction */}
          {restriction && (
            <div style={{ fontSize: 13, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 8, padding: '8px 12px' }}>
              Когда действует: {restriction}
            </div>
          )}

          {/* Edit button */}
          {canEdit && (
            <div style={{ marginTop: 'auto' }}>
              <button className="cp-btn cp-btn--primary" style={{ fontSize: 14 }}
                onClick={() => { onClose(); onEdit(); }}>
                ✎ Редактировать
              </button>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
                Изменения шаблона действуют только на новые продажи. Проданные абонементы клиентов не меняются.
              </div>
            </div>
          )}
        </div>

        {/* Right column — conditions */}
        <div className="pw-col-right">
          <div className="pw-section-title">Условия</div>
          {[
            { label: 'Срок действия',     val: plan.validity_days            ? `${plan.validity_days} дн.`            : '—' },
            { label: 'Доп. срок',         val: plan.extra_days               ? `${plan.extra_days} дн.`               : '—' },
            { label: 'Дней заморозки',    val: plan.freeze_days              ? `${plan.freeze_days} дн.`              : '—' },
            { label: 'Гостевых визитов',  val: plan.guest_visits != null && plan.guest_visits > 0 ? String(plan.guest_visits) : '—' },
            { label: 'Автоактивация через', val: plan.auto_activate_days     ? `${plan.auto_activate_days} дн.`     : '—' },
            { label: 'Отложенный старт до', val: plan.max_deferred_start_days ? `${plan.max_deferred_start_days} дн.` : '—' },
          ].map(({ label, val }) => (
            <div key={label} className="pw-cond-row">
              <span style={{ color: 'var(--text-2)', fontSize: 14 }}>{label}</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export type PlanWindowProps =
  | { mode: 'client'; plan: CPlan; dtNameMap: Record<string, string>; canEdit: boolean; onClose: () => void; onFreeze: () => void; onUnfreeze: () => void; onSplit: () => void; }
  | { mode: 'template'; plan: TPlan; dtNameMap: Record<string, string>; canEdit: boolean; onEdit: () => void; onClose: () => void; };

export default function PlanWindow(props: PlanWindowProps) {
  if (props.mode === 'client') return <ClientPlanWindow {...props} />;
  return <TemplatePlanWindow {...props} />;
}
