import { useState, useEffect, useCallback } from 'react';
import LeadDrawer from '../crm/LeadDrawer';
import { getMotivation } from './motivation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalDay { date: string; planned: boolean; worked: boolean; is_today: boolean; is_day_off: boolean }
interface OverdueTask { id: string; description: string; due_at: string | null; lead_id: string | null; lead_name: string }
interface ToCallItem { name: string; end_date: string; phone: string | null }
interface NoShowItem { visit_date: string; client_name: string | null; client_fitbase_id: number | null }

interface MyMonthData {
  no_mapping?: boolean;
  closed: boolean;
  header:       { display_name: string; month: string; closed: boolean };
  plan:         { plan_amount: number | null; fact_sales: number; plan_pct: number | null };
  pace:         { shifts_left: number; per_shift_needed: number; done: boolean } | null;
  studio_bonus: { overall_plan_fact: number; overall_plan_amount: number | null; pct: number | null; plan_bonus_on: boolean; plan_bonus: number; achieved: boolean };
  sales:        { new_count: number; new_amount: number; renewal_count: number; renewal_amount: number; goods_amount: number; order_count: number; avg_check: number; refund_count: number; refund_amount: number };
  earnings:     { shifts_amt: number; new_pct_amt: number; renewal_pct_amt: number; goods_pct_amt: number; plan_bonus_amt: number; premium: number; deduction: number; total_earned: number; advance: number; to_pay: number; is_draft: boolean };
  forecast:     { forecast_sales: number; forecast_earned: number; if_plan_earned: number } | null;
  shifts:       { planned: number; worked: number; schedule: CalDay[] };
  tasks:        { checklist_planned: number; checklist_done: number; shared_done: number; lead_total: number; lead_done: number; overdue: OverdueTask[] };
  clients:      { active_count: number; to_call: ToCallItem[] };
  conversion:   { leads: number; booked: number; visited: number; sold: number; booked_pct: number | null; visited_pct: number | null; sold_pct: number | null };
  no_show:      { count: number; items: NoShowItem[] };
  prev_month:   { fact_sales: number; total_earned: number; diff_sales_pct: number | null; diff_earned_pct: number | null };
}

interface MappedStaff { user_id: string; fitbase_full_name: string; display_name: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DOW_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function fmtMonth(m: string): string {
  const [yr, mo] = m.split('-').map(Number);
  return `${MONTHS_RU[mo - 1]} ${yr}`;
}

function prevMonth(m: string): string {
  const [yr, mo] = m.split('-').map(Number);
  return mo === 1 ? `${yr - 1}-12` : `${yr}-${String(mo - 1).padStart(2, '0')}`;
}

function nextMonth(m: string): string {
  const [yr, mo] = m.split('-').map(Number);
  return mo === 12 ? `${yr + 1}-01` : `${yr}-${String(mo + 1).padStart(2, '0')}`;
}

function curMonth(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
}

function fmt(n: number): string {
  return n.toLocaleString('ru-RU') + ' ₸';
}

function fmtDate(d: string): string {
  return d.slice(0, 10).split('-').reverse().join('.');
}

function planColor(pct: number | null): string {
  if (pct == null) return 'var(--text-3)';
  if (pct >= 100) return 'var(--success)';
  if (pct >= 50)  return 'var(--warning)';
  return 'var(--text-3)';
}

function diffArrow(pct: number | null): string | null {
  if (pct == null) return null;
  return pct > 0 ? `↑${pct}%` : pct < 0 ? `↓${Math.abs(pct)}%` : '=';
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, badge, badgeRed, children }: { title: string; badge?: number; badgeRed?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={() => setOpen(o => !o)} style={s.sectionHead}>
        <span>{title}</span>
        {badge != null && badge > 0 && (
          <span style={{ ...s.badge, background: badgeRed ? 'var(--danger)' : 'var(--text-3)' }}>{badge}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--text-3)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ paddingTop: 6 }}>{children}</div>}
    </div>
  );
}

// ── Tile ──────────────────────────────────────────────────────────────────────

function Tile({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ ...s.tile, gridColumn: wide ? 'span 2' : undefined }}>
      <div style={s.tileTitle}>{title}</div>
      {children}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number | null; color: string }) {
  const val = Math.min(pct ?? 0, 100);
  return (
    <div style={{ background: 'var(--border)', borderRadius: 6, height: 8, marginTop: 6, overflow: 'hidden' }}>
      <div style={{ width: `${val}%`, background: color, height: '100%', borderRadius: 6, transition: 'width .3s' }} />
    </div>
  );
}

// ── Shift calendar ────────────────────────────────────────────────────────────

function ShiftCalendar({ schedule, month }: { schedule: CalDay[]; month: string }) {
  const [, mo] = month.split('-').map(Number);
  const firstDay = new Date(`${month}-01T00:00:00Z`).getUTCDay(); // 0=Sun
  const offset = firstDay === 0 ? 6 : firstDay - 1; // 0=Mon start
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DOW_SHORT.slice(1).map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
        {schedule.map(d => {
          const dayNum = Number(d.date.slice(8));
          let bg = 'var(--surface-2)', color_ = 'var(--text)', border = '1px solid var(--border)';
          if (d.is_day_off) { bg = 'var(--surface-2)'; color_ = 'var(--text-3)'; }
          if (d.planned) { bg = '#e0f2fe'; border = '1px solid #93c5fd'; }
          if (d.worked)  { bg = '#d1fae5'; border = '1px solid #6ee7b7'; color_ = '#065f46'; }
          if (d.is_today) { border = '2px solid var(--primary)'; }
          return (
            <div key={d.date} style={{ aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: bg, border, borderRadius: 6, fontSize: 11, fontWeight: d.is_today ? 700 : 400, color: color_ }}>
              <span>{dayNum}</span>
              {d.worked && <span style={{ fontSize: 9, lineHeight: 1 }}>✓</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' as const }}>
        <span style={s.legendItem}><span style={{ ...s.legendDot, background: '#e0f2fe', border: '1px solid #93c5fd' }} />Запланировано</span>
        <span style={s.legendItem}><span style={{ ...s.legendDot, background: 'var(--success-soft)', border: '1px solid #6ee7b7' }} />Отработано</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MyMonthPage({ role, sessionUserId }: { role: string; sessionUserId: string }) {
  const [month, setMonth] = useState(curMonth);
  const [userId, setUserId] = useState(sessionUserId);
  const [data, setData] = useState<MyMonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<MappedStaff[]>([]);
  const [motivation, setMotivation] = useState('');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [openOverdue, setOpenOverdue] = useState(true);
  const [openToCall, setOpenToCall] = useState(true);
  const [openNoShow, setOpenNoShow] = useState(true);

  const isAdmin = role === 'admin';
  const isCurrent = month === curMonth();

  useEffect(() => {
    if (isAdmin) {
      fetch('/kviz/api/manager/mapped-staff', { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(d => { if (Array.isArray(d)) setStaff(d); })
        .catch(() => {});
    }
  }, [isAdmin]);

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ month });
      if (isAdmin && userId !== sessionUserId) params.set('user_id', userId);
      if (fresh) params.set('fresh', '1');
      const r = await fetch(`/kviz/api/manager/my-month?${params}`, { credentials: 'include' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      const d: MyMonthData = await r.json();
      setData(d);
      if (!d.no_mapping) {
        setMotivation(getMotivation(d.plan?.plan_pct ?? null, d.tasks?.overdue?.length ?? 0));
      }
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [month, userId, isAdmin, sessionUserId]);

  useEffect(() => { load(); }, [load]);

  const canGoNext = nextMonth(month) <= curMonth();

  if (loading) return <div style={s.center}>Загрузка...</div>;
  if (error)   return <div style={s.center}>Ошибка: {error}</div>;
  if (!data)   return null;

  if (data.no_mapping) {
    return (
      <div style={s.center}>
        <div style={{ maxWidth: 360, textAlign: 'center', color: 'var(--text-2)', fontSize: 14, lineHeight: 1.6 }}>
          Ваш логин не связан с сотрудником Fitbase.<br />
          Обратитесь к администратору для настройки.
        </div>
      </div>
    );
  }

  const { plan, pace, studio_bonus, sales, earnings, forecast, shifts, tasks, clients, conversion, no_show, prev_month } = data;
  const planPct = plan.plan_pct;
  const color = planColor(planPct);

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{data.header.display_name}</div>
          {motivation && <div style={{ fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic' }}>{motivation}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setMonth(prevMonth(month))} style={s.navBtn}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minWidth: 120, textAlign: 'center' as const }}>
            {fmtMonth(month)}{data.closed ? ' 🔒' : ''}
          </span>
          <button onClick={() => setMonth(nextMonth(month))} style={{ ...s.navBtn, opacity: canGoNext ? 1 : 0.3, pointerEvents: canGoNext ? 'auto' : 'none' }}>›</button>
          <button onClick={() => load(true)} style={s.refreshBtn} title="Обновить">↺</button>
        </div>
        {isAdmin && staff.length > 0 && (
          <div style={{ width: '100%', marginTop: 8 }}>
            <select value={userId} onChange={e => setUserId(e.target.value)} style={s.staffSelect}>
              <option value={sessionUserId}>— Я —</option>
              {staff.filter(s => s.user_id !== sessionUserId).map(s => (
                <option key={s.user_id} value={s.user_id}>{s.display_name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div style={s.content}>
        {/* Row 1: Plan, Pace, Studio bonus, Earnings */}
        <div style={s.tileGrid}>
          {/* Plan tile */}
          <Tile title="План">
            {plan.plan_amount ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{fmt(plan.fact_sales)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>из {fmt(plan.plan_amount)} · {planPct ?? '—'}%</div>
                <ProgressBar pct={planPct} color={color} />
                {prev_month.diff_sales_pct != null && (
                  <div style={{ fontSize: 11, color: (prev_month.diff_sales_pct ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: 4 }}>
                    {diffArrow(prev_month.diff_sales_pct)} к прошлому месяцу
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{fmt(plan.fact_sales)}</div>
            )}
          </Tile>

          {/* Pace tile (current month only) */}
          {isCurrent && pace ? (
            <Tile title="Темп">
              {pace.done ? (
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>План закрыт 🎉</div>
              ) : plan.plan_amount ? (
                <>
                  <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>
                    Нужно ≈ <strong>{fmt(pace.per_shift_needed)}</strong> за смену
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Осталось смен: {pace.shifts_left}</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Нет плана</div>
              )}
            </Tile>
          ) : !isCurrent ? (
            <Tile title="Итог месяца">
              <div style={{ fontSize: 20, fontWeight: 700, color }}>{planPct != null ? `${planPct}%` : '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>от плана</div>
            </Tile>
          ) : (
            <Tile title="Темп"><div style={{ fontSize: 12, color: 'var(--text-3)' }}>Нет данных</div></Tile>
          )}

          {/* Studio bonus tile */}
          <Tile title="Студия">
            {studio_bonus.overall_plan_amount ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 700, color: studio_bonus.achieved ? 'var(--success)' : 'var(--warning)' }}>
                  {studio_bonus.pct ?? '—'}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                  {fmt(studio_bonus.overall_plan_fact)} / {fmt(studio_bonus.overall_plan_amount)}
                </div>
                <ProgressBar pct={studio_bonus.pct} color={studio_bonus.achieved ? 'var(--success)' : 'var(--warning)'} />
                {studio_bonus.plan_bonus_on && (
                  <div style={{ fontSize: 11, marginTop: 4, color: studio_bonus.achieved ? 'var(--success)' : 'var(--text-3)' }}>
                    {studio_bonus.achieved ? `Бонус включён +${fmt(studio_bonus.plan_bonus)}` : `Бонус пока не включён (${fmt(studio_bonus.plan_bonus)})`}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Нет плана студии</div>
            )}
          </Tile>

          {/* Earnings tile */}
          <Tile title="Заработок">
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{fmt(earnings.total_earned)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>к выплате: {fmt(earnings.to_pay)}</div>
            {earnings.is_draft && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>предварительно</div>}
            {forecast && isCurrent && (
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>
                прогноз: {fmt(forecast.forecast_earned)}
                {plan.plan_amount && <> · если план: {fmt(forecast.if_plan_earned)}</>}
              </div>
            )}
            {prev_month.diff_earned_pct != null && (
              <div style={{ fontSize: 11, color: (prev_month.diff_earned_pct ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: 2 }}>
                {diffArrow(prev_month.diff_earned_pct)} к прошлому месяцу
              </div>
            )}
          </Tile>
        </div>

        {/* Row 2: Sales, Shifts, Tasks, Conversion */}
        <div style={s.tileGrid}>
          {/* Sales tile */}
          <Tile title="Продажи">
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div>Новые: <strong>{sales.new_count}</strong> · {fmt(sales.new_amount)}</div>
              <div>Продления: <strong>{sales.renewal_count}</strong> · {fmt(sales.renewal_amount)}</div>
              {sales.goods_amount > 0 && <div>Товары: {fmt(sales.goods_amount)}</div>}
              <div style={{ color: 'var(--text-2)' }}>Чеков: {sales.order_count} · ср. {fmt(sales.avg_check)}</div>
              {sales.refund_count > 0 && <div style={{ color: 'var(--danger)' }}>Возвраты: {sales.refund_count} · -{fmt(sales.refund_amount)}</div>}
            </div>
          </Tile>

          {/* Shifts tile */}
          <Tile title="Смены">
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{shifts.worked}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-2)' }}> / {shifts.planned}</span></div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>отработано / по плану</div>
          </Tile>

          {/* Tasks tile */}
          <Tile title="Задачи">
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div>Чек-лист: <strong>{tasks.checklist_done}</strong> / {tasks.checklist_planned}</div>
              <div>Общих: {tasks.shared_done}</div>
              {tasks.lead_total > 0 && <div>Заявки: <strong>{tasks.lead_done}</strong> / {tasks.lead_total}</div>}
              {tasks.overdue.length > 0 && (
                <div style={{ color: 'var(--danger)', fontWeight: 600 }}>Просрочено: {tasks.overdue.length}</div>
              )}
            </div>
          </Tile>

          {/* Conversion tile */}
          <Tile title="Конверсия">
            <div style={{ fontSize: 12, lineHeight: 1.9 }}>
              <ConvStep label="Заявки" count={conversion.leads} />
              <ConvStep label="Записаны" count={conversion.booked} pct={conversion.booked_pct} />
              <ConvStep label="Пришли" count={conversion.visited} pct={conversion.visited_pct} />
              <ConvStep label="Купили" count={conversion.sold} pct={conversion.sold_pct} />
            </div>
          </Tile>
        </div>

        {/* Earnings breakdown */}
        <div style={s.earningsBreak}>
          <div style={s.earningsTitle}>Начисления</div>
          <div style={s.earningsRow}><span>Смены</span><span>{fmt(earnings.shifts_amt)}</span></div>
          {earnings.new_pct_amt > 0 && <div style={s.earningsRow}><span>% с новых</span><span>{fmt(earnings.new_pct_amt)}</span></div>}
          {earnings.renewal_pct_amt > 0 && <div style={s.earningsRow}><span>% с продлений</span><span>{fmt(earnings.renewal_pct_amt)}</span></div>}
          {earnings.goods_pct_amt > 0 && <div style={s.earningsRow}><span>% с товаров</span><span>{fmt(earnings.goods_pct_amt)}</span></div>}
          {earnings.plan_bonus_amt > 0 && <div style={s.earningsRow}><span>Бонус за план</span><span style={{ color: 'var(--success)' }}>{fmt(earnings.plan_bonus_amt)}</span></div>}
          {earnings.premium > 0 && <div style={s.earningsRow}><span>Премия</span><span style={{ color: 'var(--success)' }}>{fmt(earnings.premium)}</span></div>}
          {earnings.deduction > 0 && <div style={s.earningsRow}><span>Удержание</span><span style={{ color: 'var(--danger)' }}>-{fmt(earnings.deduction)}</span></div>}
          <div style={{ ...s.earningsRow, fontWeight: 700, borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
            <span>Итого</span><span>{fmt(earnings.total_earned)}</span>
          </div>
          {earnings.advance > 0 && <div style={{ ...s.earningsRow, color: 'var(--text-2)' }}><span>Аванс</span><span>-{fmt(earnings.advance)}</span></div>}
          {earnings.to_pay !== earnings.total_earned && (
            <div style={{ ...s.earningsRow, fontWeight: 600, color: 'var(--primary)' }}><span>К выплате</span><span>{fmt(earnings.to_pay)}</span></div>
          )}
        </div>

        {/* Shift calendar */}
        <div style={s.calCard}>
          <div style={s.cardTitle}>Календарь смен</div>
          <ShiftCalendar schedule={shifts.schedule} month={month} />
        </div>

        {/* Overdue lead tasks */}
        {tasks.overdue.length > 0 && (
          <Collapsible title="Просроченные задачи" badge={tasks.overdue.length} badgeRed open={openOverdue} setOpen={setOpenOverdue}>
            {tasks.overdue.map(t => (
              <div key={t.id} style={s.listRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{t.description}</div>
                  {t.lead_name && (
                    <div style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => t.lead_id && setOpenLeadId(t.lead_id)}>
                      {t.lead_name}
                    </div>
                  )}
                  {t.due_at && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{fmtDate(t.due_at)}</div>}
                </div>
              </div>
            ))}
          </Collapsible>
        )}
        {tasks.overdue.length === 0 && (
          <div style={{ ...s.listRow, color: 'var(--success)', fontSize: 12 }}>Просроченных задач нет — так держать!</div>
        )}

        {/* To call */}
        {clients.to_call.length > 0 ? (
          <Collapsible title="Позвонить клиентам" badge={clients.to_call.length} open={openToCall} setOpen={setOpenToCall}>
            {clients.to_call.map((c, i) => (
              <div key={i} style={s.listRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: c.end_date < new Date(Date.now() + 5*3600_000).toISOString().slice(0,10) ? 'var(--danger)' : 'var(--text-2)' }}>
                    до {fmtDate(c.end_date)}
                  </div>
                </div>
                {c.phone && (
                  <a href={`tel:${c.phone}`} style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>
                    Позвонить
                  </a>
                )}
              </div>
            ))}
          </Collapsible>
        ) : (
          <div style={{ ...s.listRow, color: 'var(--success)', fontSize: 12 }}>Нет клиентов для звонка — так держать!</div>
        )}

        {/* No-shows */}
        {no_show.count > 0 && (
          <Collapsible title="Не пришли на пробное" badge={no_show.count} open={openNoShow} setOpen={setOpenNoShow}>
            {no_show.items.map((v, i) => (
              <div key={i} style={s.listRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)' }}>{v.client_name ?? '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{fmtDate(v.visit_date)}</div>
                </div>
              </div>
            ))}
          </Collapsible>
        )}

        {/* Active clients count */}
        <div style={{ padding: '8px 0', fontSize: 13, color: 'var(--text-2)' }}>
          Активных клиентов: <strong style={{ color: 'var(--text)' }}>{clients.active_count}</strong>
        </div>
      </div>

      {openLeadId && (
        <LeadDrawer
          leadId={openLeadId}
          funnels={[]}
          onClose={() => setOpenLeadId(null)}
          onSaved={() => setOpenLeadId(null)}
          onDeleted={() => setOpenLeadId(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConvStep({ label, count, pct }: { label: string; count: number; pct?: number | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 70, color: 'var(--text-2)' }}>{label}</span>
      <strong>{count}</strong>
      {pct != null && <span style={{ color: pct >= 50 ? 'var(--success)' : 'var(--warning)', fontSize: 11 }}>{pct}%</span>}
    </div>
  );
}

function Collapsible({ title, badge, badgeRed, open, setOpen, children }: { title: string; badge?: number; badgeRed?: boolean; open: boolean; setOpen: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(!open)} style={s.sectionHead}>
        <span>{title}</span>
        {badge != null && badge > 0 && (
          <span style={{ ...s.badge, background: badgeRed ? 'var(--danger)' : 'var(--text-3)' }}>{badge}</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--text-3)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root:        { minHeight: '100dvh', overflow: 'auto', background: 'var(--surface-2)', fontFamily: "'Manrope',system-ui,sans-serif" },
  center:      { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-2)', fontFamily: 'system-ui,sans-serif' },
  header:      { background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '12px 16px', display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 10 },
  navBtn:      { width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', flexShrink: 0 },
  refreshBtn:  { width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' },
  staffSelect: { width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)' },
  content:     { padding: '12px 12px 32px' },
  tileGrid:    { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 12 },
  tile:        { background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tileTitle:   { fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 6 },
  badge:       { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, minWidth: 20, height: 20, padding: '0 6px', fontSize: 11, fontWeight: 700, color: 'var(--surface)', marginLeft: 6 },
  sectionHead: { display: 'flex', alignItems: 'center', width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'inherit', marginBottom: 2, gap: 4 },
  calCard:     { background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTitle:   { fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 10 },
  listRow:     { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' },
  earningsBreak: { background: 'var(--surface)', borderRadius: 12, padding: '12px 14px', marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  earningsTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 8 },
  earningsRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0', color: 'var(--text)' },
  legendItem:  { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-2)' },
  legendDot:   { width: 12, height: 12, borderRadius: 3, display: 'inline-block', flexShrink: 0 },
};
