import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Shift {
  id: string; number: number; opened_by: string; opened_at: string;
  opening_cash: number; status: string; shift_date: string;
}
interface Movement {
  id: string; type: 'in' | 'out'; amount: number;
  comment: string; created_by: string; created_at: string;
}
interface SaleRow {
  id: string; number: number; cashier: string; manager: string | null;
  total: number; discount_kind: string; status: string; created_at: string;
  client_id: string | null;
  crm_sale_payments: { payment_method_id: string; amount: number }[];
}
interface SaleFull extends SaleRow {
  crm_sale_items: { id: string; item_type: string; price: number; qty: number; plan_id: string | null; product_id: string | null; amount: number }[];
}
interface PM { id: string; name: string; kind: string; is_active: boolean }
interface Plan {
  id: string; name: string; kind: string; price: number; is_active: boolean;
  validity_days: number | null; max_deferred_start_days: number;
  auto_activate_days: number | null;
  items: { device_type_code: string; phase: string; sessions: number }[];
}
interface Product { id: string; name: string; stock: number; retail_price: number | null; is_active: boolean }
interface AppUser { display_name: string }
interface ClientSearch { id: string; full_name: string; phone: string | null; profile_complete: boolean }
interface PromoData { id: string; discount_type: 'percent' | 'fixed'; discount_value: number; applies_to_all: boolean }

type CartItem =
  | { key: string; type: 'plan'; plan: Plan; price: number; startMode: 'first_visit' | 'date'; startDate: string }
  | { key: string; type: 'product'; product: Product; qty: number; price: number }
  | { key: string; type: 'deposit'; price: number };

interface PayEntry { methodId: string; amount: string }

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMoney(n: number) { return n.toLocaleString('ru-RU') + ' ₸'; }

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function api(method: string, url: string, body?: unknown) {
  const opts: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, data: d };
}

function cartItemTotal(item: CartItem): number {
  if (item.type === 'product') return item.price * item.qty;
  return item.price;
}

// ── MovementModal ──────────────────────────────────────────────────────────────

function MovementModal({ shiftId, onDone, onClose }: { shiftId: string; onDone: () => void; onClose: () => void }) {
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setSaving(true);
    const { ok, data } = await api('POST', `/kviz/api/crm/shifts/${shiftId}/movements`, {
      type: dir, amount: Number(amount), comment,
    });
    setSaving(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    onDone();
  }

  return (
    <div style={S.overlay}>
      <form style={S.modal} onSubmit={submit}>
        <h3 style={S.modalTitle}>{dir === 'in' ? 'Внесение наличных' : 'Изъятие / расход'}</h3>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button type="button" style={{ ...S.tabBtn, ...(dir === 'in' ? S.tabBtnActive : {}) }} onClick={() => setDir('in')}>Внесение</button>
          <button type="button" style={{ ...S.tabBtn, ...(dir === 'out' ? S.tabBtnActive : {}) }} onClick={() => setDir('out')}>Изъятие / расход</button>
        </div>
        <label style={S.label}>Сумма, ₸ *</label>
        <input style={S.inp} type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} required />
        <label style={S.label}>Комментарий *</label>
        <input style={S.inp} value={comment} onChange={e => setComment(e.target.value)} required placeholder="Укажите назначение" />
        {err && <div style={S.err}>{err}</div>}
        <div style={S.modalBtns}>
          <button type="button" style={S.cancelBtn} onClick={onClose}>Отмена</button>
          <button type="submit" style={S.saveBtn} disabled={saving}>{saving ? '…' : 'Сохранить'}</button>
        </div>
      </form>
    </div>
  );
}

// ── CloseShiftModal ────────────────────────────────────────────────────────────

function CloseShiftModal({ shift, onDone, onClose }: { shift: Shift; onDone: () => void; onClose: () => void }) {
  const [expected, setExpected] = useState<number | null>(null);
  const [counted, setCounted] = useState('');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('GET', `/kviz/api/crm/shifts/${shift.id}/expected-cash`).then(({ data }) => {
      if (data.expected_cash !== undefined) setExpected(Number(data.expected_cash));
    });
  }, [shift.id]);

  const countedNum = Number(counted) || 0;
  const diff = expected !== null ? countedNum - expected : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setSaving(true);
    const { ok, data } = await api('PATCH', `/kviz/api/crm/shifts/${shift.id}/close`, {
      counted_cash: countedNum, comment: comment || null,
    });
    setSaving(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    onDone();
  }

  return (
    <div style={S.overlay}>
      <form style={S.modal} onSubmit={submit}>
        <h3 style={S.modalTitle}>Закрытие смены</h3>
        <div style={S.infoRow}><span style={S.infoKey}>Открыта</span><span>{shift.opened_by}, {fmtDT(shift.opened_at)}</span></div>
        <div style={S.infoRow}><span style={S.infoKey}>Ожидаемые наличные</span><span>{expected === null ? '…' : fmtMoney(expected)}</span></div>
        <label style={{ ...S.label, marginTop: 12 }}>Фактически в кассе, ₸ *</label>
        <input style={S.inp} type="number" min="0" value={counted} onChange={e => setCounted(e.target.value)} required />
        {diff !== null && counted !== '' && (
          <div style={{ fontSize: 13, marginTop: 4, color: diff >= 0 ? '#16a34a' : '#ef4444' }}>
            {diff >= 0 ? `Излишек +${fmtMoney(diff)}` : `Недостача ${fmtMoney(-diff)}`}
          </div>
        )}
        <label style={S.label}>Комментарий</label>
        <input style={S.inp} value={comment} onChange={e => setComment(e.target.value)} />
        {err && <div style={S.err}>{err}</div>}
        <div style={S.modalBtns}>
          <button type="button" style={S.cancelBtn} onClick={onClose}>Отмена</button>
          <button type="submit" style={{ ...S.saveBtn, background: '#ef4444' }} disabled={saving}>{saving ? '…' : 'Закрыть смену'}</button>
        </div>
      </form>
    </div>
  );
}

// ── RefundDialog ───────────────────────────────────────────────────────────────

function RefundDialog({ sale, payMethods, onDone, onClose }: {
  sale: SaleFull; payMethods: PM[]; onDone: () => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [refundPay, setRefundPay] = useState<PayEntry[]>([{ methodId: '', amount: '' }]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const totalRefund = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setSaving(true);
    const items = sale.crm_sale_items
      .filter(it => Number(amounts[it.id]) > 0)
      .map(it => ({ sale_item_id: it.id, qty: it.qty, amount: Number(amounts[it.id]) }));
    const payments = refundPay
      .filter(p => p.methodId && Number(p.amount) > 0)
      .map(p => ({ method_id: p.methodId, amount: Number(p.amount) }));
    const { ok, data } = await api('POST', '/kviz/api/crm/refund', { sale_id: sale.id, reason, items, payments });
    setSaving(false);
    if (!ok) { setErr(data.error || 'Ошибка возврата'); return; }
    onDone();
  }

  return (
    <div style={S.overlay}>
      <form style={{ ...S.modal, maxWidth: 520 }} onSubmit={submit}>
        <h3 style={S.modalTitle}>Возврат по продаже #{sale.number}</h3>
        <label style={S.label}>Причина *</label>
        <input style={S.inp} value={reason} onChange={e => setReason(e.target.value)} required />
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 12, marginBottom: 6 }}>Позиции для возврата:</div>
        {sale.crm_sale_items.map(it => (
          <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 13 }}>{it.item_type} — {fmtMoney(it.amount)}</span>
            <input style={{ ...S.inp, width: 110 }} type="number" min="0" max={it.amount}
              placeholder="0" value={amounts[it.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [it.id]: e.target.value }))} />
          </div>
        ))}
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 12, marginBottom: 6 }}>
          Итого к возврату: {fmtMoney(totalRefund)}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Как вернуть деньги:</div>
        {refundPay.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <select style={{ ...S.inp, flex: 2 }} value={p.methodId} onChange={e => setRefundPay(rp => rp.map((x, j) => j === i ? { ...x, methodId: e.target.value } : x))}>
              <option value="">— способ —</option>
              {payMethods.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input style={{ ...S.inp, flex: 1 }} type="number" min="0" placeholder="₸"
              value={p.amount} onChange={e => setRefundPay(rp => rp.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
          </div>
        ))}
        <button type="button" style={S.linkBtn} onClick={() => setRefundPay(rp => [...rp, { methodId: '', amount: '' }])}>+ ещё способ</button>
        {err && <div style={S.err}>{err}</div>}
        <div style={S.modalBtns}>
          <button type="button" style={S.cancelBtn} onClick={onClose}>Отмена</button>
          <button type="submit" style={{ ...S.saveBtn, background: '#ef4444' }} disabled={saving || !reason}>
            {saving ? '…' : 'Оформить возврат'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── SaleScreen ─────────────────────────────────────────────────────────────────

function SaleScreen({ shift, role, displayName, payMethods, users, onCancel, onDone }: {
  shift: Shift; role: string; displayName: string;
  payMethods: PM[]; users: AppUser[]; onCancel: () => void; onDone: (num: number) => void;
}) {
  const [tab, setTab] = useState<'abonement' | 'service' | 'product' | 'deposit' | 'bonus'>('abonement');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [client, setClient] = useState<ClientSearch | null | 'guest'>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<ClientSearch[]>([]);
  const [manager, setManager] = useState(displayName);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountKind, setDiscountKind] = useState<'none' | 'promo' | 'admin'>('none');
  const [promoCode, setPromoCode] = useState('');
  const [promoData, setPromoData] = useState<PromoData | null>(null);
  const [promoErr, setPromoErr] = useState('');
  const [adminDiscType, setAdminDiscType] = useState<'percent' | 'fixed'>('percent');
  const [adminDiscVal, setAdminDiscVal] = useState('');
  const [payments, setPayments] = useState<PayEntry[]>([{ methodId: '', amount: '' }]);
  const [bonusWallet, setBonusWallet] = useState<'bonus' | 'deposit'>('bonus');
  const [bonusDir, setBonusDir] = useState<'in' | 'out'>('in');
  const [bonusAmt, setBonusAmt] = useState('');
  const [bonusReason, setBonusReason] = useState('');
  const [balanceInfo, setBalanceInfo] = useState<{ deposit: number; bonus: number } | null>(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [bonusSaving, setBonusSaving] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clientId = client !== null && client !== 'guest' ? client.id : null;

  // Load plans and products
  useEffect(() => {
    api('GET', '/kviz/api/crm/plans').then(({ data }) => { if (Array.isArray(data)) setPlans(data); });
    api('GET', '/kviz/api/crm/products').then(({ data }) => { if (Array.isArray(data)) setProducts(data); });
  }, []);

  // Load balance when client selected
  useEffect(() => {
    if (!clientId) { setBalanceInfo(null); return; }
    api('GET', `/kviz/api/crm/clients/${clientId}/balance`).then(({ data }) => setBalanceInfo(data));
  }, [clientId]);

  const doClientSearch = useCallback((q: string) => {
    if (q.length < 2) { setClientResults([]); return; }
    fetch(`/kviz/api/crm/clients?search=${encodeURIComponent(q)}&limit=8`, { credentials: 'include' })
      .then(r => r.json()).then(d => { if (d?.items) setClientResults(d.items); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doClientSearch(clientSearch), 250);
  }, [clientSearch, doClientSearch]);

  // Cart totals
  const subtotal = cart.reduce((s, it) => s + cartItemTotal(it), 0);
  const depositItems = cart.filter(it => it.type === 'deposit');
  const nonDepositTotal = cart.filter(it => it.type !== 'deposit').reduce((s, it) => s + cartItemTotal(it), 0);

  let discount = 0;
  if (discountKind === 'admin' && adminDiscVal) {
    const v = Number(adminDiscVal);
    if (adminDiscType === 'percent') discount = Math.round(nonDepositTotal * v / 100);
    else discount = Math.min(v, nonDepositTotal);
  } else if (discountKind === 'promo' && promoData) {
    const v = promoData.discount_value;
    if (promoData.discount_type === 'percent') discount = Math.round(nonDepositTotal * v / 100);
    else discount = Math.min(v, nonDepositTotal);
  }
  const total = subtotal - discount;
  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = total - paidTotal;

  function addPlan(plan: Plan) {
    if (cart.some(it => it.type === 'plan' && it.plan.id === plan.id)) return;
    setCart(c => [...c, { key: plan.id, type: 'plan', plan, price: plan.price, startMode: 'first_visit', startDate: '' }]);
  }

  function addProduct(product: Product) {
    const existing = cart.find(it => it.type === 'product' && it.product.id === product.id);
    if (existing) {
      setCart(c => c.map(it => it.key === existing.key && it.type === 'product' ? { ...it, qty: it.qty + 1 } : it));
    } else {
      setCart(c => [...c, { key: product.id, type: 'product', product, qty: 1, price: product.retail_price ?? 0 }]);
    }
  }

  function removeItem(key: string) { setCart(c => c.filter(it => it.key !== key)); }

  function setItemPrice(key: string, price: number) {
    if (role !== 'admin') return;
    setCart(c => c.map(it => it.key === key ? { ...it, price } as CartItem : it));
  }

  function setProductQty(key: string, qty: number) {
    if (qty < 1) { removeItem(key); return; }
    setCart(c => c.map(it => it.key === key && it.type === 'product' ? { ...it, qty } : it));
  }

  function setStartMode(key: string, startMode: 'first_visit' | 'date') {
    setCart(c => c.map(it => it.key === key && it.type === 'plan' ? { ...it, startMode, startDate: '' } as CartItem : it));
  }

  function setStartDate(key: string, startDate: string) {
    setCart(c => c.map(it => it.key === key && it.type === 'plan' ? { ...it, startDate } as CartItem : it));
  }

  async function validatePromo() {
    setPromoErr(''); setPromoData(null);
    const { ok, data } = await api('POST', '/kviz/api/crm/promo-codes/validate', { code: promoCode, client_id: clientId });
    if (!ok) { setPromoErr(data.error || 'Ошибка'); return; }
    setPromoData(data);
  }

  async function submitBonusOp() {
    if (!clientId) return;
    setBonusSaving(true);
    const { ok, data } = await api('POST', `/kviz/api/crm/clients/${clientId}/balance-ops`, {
      wallet: bonusWallet, direction: bonusDir, amount: Number(bonusAmt), reason: bonusReason,
    });
    setBonusSaving(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    setBonusAmt(''); setBonusReason('');
    // refresh balance
    api('GET', `/kviz/api/crm/clients/${clientId}/balance`).then(({ data: d }) => setBalanceInfo(d));
  }

  async function submit() {
    setErr(''); setSaving(true);
    if (cart.length === 0) { setErr('Корзина пуста'); setSaving(false); return; }
    if (Math.abs(remaining) > 1) { setErr(`Сумма оплат (${fmtMoney(paidTotal)}) не совпадает с итогом (${fmtMoney(total)})`); setSaving(false); return; }

    const items = cart.map(it => {
      if (it.type === 'plan') {
        return { item_type: 'plan', plan_id: it.plan.id, qty: 1, price: it.price, start_mode: it.startMode, start_date: it.startDate || null };
      } else if (it.type === 'product') {
        return { item_type: 'product', product_id: it.product.id, qty: it.qty, price: it.price };
      } else {
        return { item_type: 'deposit', qty: 1, price: it.price };
      }
    });
    const pays = payments.filter(p => p.methodId && Number(p.amount) > 0).map(p => ({ method_id: p.methodId, amount: Number(p.amount) }));

    const payload: Record<string, unknown> = {
      shift_id: shift.id, client_id: clientId, manager, items, payments: pays,
      discount_kind: discountKind,
    };
    if (discountKind === 'promo' && promoData) { payload.promo_code_id = promoData.id; }
    if (discountKind === 'admin') { payload.admin_discount_type = adminDiscType; payload.admin_discount_value = Number(adminDiscVal); }

    const { ok, data } = await api('POST', '/kviz/api/crm/checkout', payload);
    setSaving(false);
    if (!ok) { setErr(data.error || 'Ошибка оформления'); return; }
    onDone(data.number as number);
  }

  const activePlans = plans.filter(p => p.is_active && p.kind === (tab === 'abonement' ? 'abonement' : 'service'));
  const activeProducts = products.filter(p => p.is_active);
  const isGuest = client === 'guest';
  const noClient = client === null;
  const showProfileWarn = client !== null && client !== 'guest' && !client.profile_complete;

  const TABS: { key: typeof tab; label: string; disabled: boolean }[] = [
    { key: 'abonement', label: 'Абонементы', disabled: isGuest },
    { key: 'service',   label: 'Услуги',     disabled: isGuest },
    { key: 'product',   label: 'Товары',     disabled: false },
    { key: 'deposit',   label: 'Депозит',    disabled: isGuest },
    { key: 'bonus',     label: 'Бонусы',     disabled: role !== 'admin' || isGuest || noClient },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc' }}>
      {/* Header */}
      <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={S.cancelBtn} onClick={onCancel}>← Назад</button>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Новая продажа</span>
        {/* Client picker */}
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
          {client === null || client === 'guest' ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...S.inp, flex: 1 }} placeholder="Поиск клиента..." value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setClient(null); }}
              />
              {client !== 'guest' && <button type="button" style={S.outlineBtn} onClick={() => { setClient('guest'); setClientSearch('Гость'); setClientResults([]); }}>Гость</button>}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1a202c' }}>{client.full_name}</span>
              <button type="button" style={S.linkBtn} onClick={() => { setClient(null); setClientSearch(''); }}>✕</button>
            </div>
          )}
          {clientResults.length > 0 && client === null && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20 }}>
              {clientResults.map(c => (
                <div key={c.id} style={{ padding: '7px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}
                  onMouseDown={() => { setClient(c); setClientSearch(''); setClientResults([]); }}>
                  {c.full_name} {c.phone && <span style={{ color: '#64748b' }}>{c.phone}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Balance */}
        {balanceInfo && (
          <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
            <span style={{ color: '#64748b' }}>Депозит: <b style={{ color: '#02BDB6' }}>{fmtMoney(balanceInfo.deposit)}</b></span>
            <span style={{ color: '#64748b' }}>Бонусы: <b style={{ color: '#263CD9' }}>{balanceInfo.bonus} б</b></span>
          </div>
        )}
        {showProfileWarn && <span style={{ fontSize: 12, color: '#f59e0b', background: '#fffbeb', padding: '2px 8px', borderRadius: 4 }}>⚠ Анкета не заполнена</span>}
        {/* Manager */}
        <select style={{ ...S.inp, width: 160 }} value={manager} onChange={e => setManager(e.target.value)}>
          {users.map(u => <option key={u.display_name} value={u.display_name}>{u.display_name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: catalog */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '8px 12px', background: '#fff', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
            {TABS.map(t => (
              <button key={t.key} type="button" disabled={t.disabled}
                style={{ ...S.tabBtn, ...(tab === t.key ? S.tabBtnActive : {}), opacity: t.disabled ? 0.4 : 1 }}
                onClick={() => { if (!t.disabled) setTab(t.key); }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {(tab === 'abonement' || tab === 'service') && activePlans.map(p => (
              <div key={p.id} style={S.catalogCard}
                onClick={() => { if (!isGuest && client !== null) addPlan(p); }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {p.validity_days ? `${p.validity_days} дн.` : '∞'} · {p.items.map(i => `${i.device_type_code} ×${i.sessions}`).join(', ')}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#02BDB6', marginTop: 4 }}>{fmtMoney(p.price)}</div>
                {(isGuest || client === null) && <div style={{ fontSize: 11, color: '#94a3b8' }}>Нужен клиент</div>}
              </div>
            ))}
            {tab === 'product' && activeProducts.map(p => (
              <div key={p.id} style={{ ...S.catalogCard, opacity: p.stock <= 0 ? 0.5 : 1 }}
                onClick={() => { if (p.stock > 0) addProduct(p); }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: p.stock <= 0 ? '#ef4444' : '#64748b' }}>На складе: {p.stock}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#02BDB6', marginTop: 4 }}>{p.retail_price !== null ? fmtMoney(p.retail_price) : '—'}</div>
              </div>
            ))}
            {tab === 'deposit' && !isGuest && client !== null && (
              <div style={S.catalogCard}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Пополнение депозита</div>
                <input style={S.inp} type="number" min="1" placeholder="Сумма, ₸"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = Number((e.target as HTMLInputElement).value);
                      if (v > 0) { setCart(c => [...c.filter(it => it.type !== 'deposit'), { key: 'deposit', type: 'deposit', price: v }]); (e.target as HTMLInputElement).value = ''; }
                    }
                  }}
                />
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Нажмите Enter для добавления</div>
              </div>
            )}
            {tab === 'bonus' && role === 'admin' && clientId && (
              <div style={S.catalogCard}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Бонусы клиента</div>
                {balanceInfo && <div style={{ fontSize: 13, marginBottom: 8 }}>Остаток: <b>{balanceInfo.bonus} б.</b></div>}
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button type="button" style={{ ...S.tabBtn, ...(bonusWallet === 'bonus' ? S.tabBtnActive : {}) }} onClick={() => setBonusWallet('bonus')}>Бонусы</button>
                  <button type="button" style={{ ...S.tabBtn, ...(bonusWallet === 'deposit' ? S.tabBtnActive : {}) }} onClick={() => setBonusWallet('deposit')}>Депозит</button>
                  <button type="button" style={{ ...S.tabBtn, ...(bonusDir === 'in' ? S.tabBtnActive : {}) }} onClick={() => setBonusDir('in')}>+</button>
                  <button type="button" style={{ ...S.tabBtn, ...(bonusDir === 'out' ? S.tabBtnActive : {}) }} onClick={() => setBonusDir('out')}>−</button>
                </div>
                <input style={S.inp} type="number" min="1" placeholder="Сумма" value={bonusAmt} onChange={e => setBonusAmt(e.target.value)} />
                <input style={{ ...S.inp, marginTop: 6 }} placeholder="Причина *" value={bonusReason} onChange={e => setBonusReason(e.target.value)} />
                <button type="button" style={{ ...S.saveBtn, marginTop: 8, width: '100%' }} disabled={bonusSaving || !bonusAmt || !bonusReason} onClick={submitBonusOp}>
                  {bonusSaving ? '…' : 'Сохранить'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: cart + payments */}
        <div style={{ width: 380, display: 'flex', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Корзина</div>
            {cart.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Добавьте товары или абонементы</div>}
            {cart.map(item => (
              <div key={item.key} style={{ marginBottom: 8, padding: 8, background: '#f8fafc', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                    {item.type === 'plan' ? item.plan.name : item.type === 'product' ? item.product.name : 'Пополнение депозита'}
                  </span>
                  <button style={S.removeBtn} onClick={() => removeItem(item.key)}>✕</button>
                </div>
                {item.type === 'product' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    <button style={S.qtyBtn} onClick={() => setProductQty(item.key, item.qty - 1)}>−</button>
                    <span style={{ fontSize: 13, minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                    <button style={S.qtyBtn} onClick={() => setProductQty(item.key, item.qty + 1)}>+</button>
                    <span style={{ fontSize: 13, color: '#64748b', marginLeft: 4 }}>× {fmtMoney(item.price)}</span>
                  </div>
                )}
                {item.type === 'plan' && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ display: 'flex', gap: 6, fontSize: 12 }}>
                      <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="radio" checked={item.startMode === 'first_visit'} onChange={() => setStartMode(item.key, 'first_visit')} />
                        С первого визита
                      </label>
                      <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="radio" checked={item.startMode === 'date'} onChange={() => setStartMode(item.key, 'date')} />
                        С даты
                      </label>
                    </div>
                    {item.startMode === 'date' && (
                      <input style={{ ...S.inp, marginTop: 4 }} type="date" value={item.startDate} onChange={e => setStartDate(item.key, e.target.value)} />
                    )}
                  </div>
                )}
                <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#02BDB6', marginTop: 4 }}>
                  {fmtMoney(cartItemTotal(item))}
                </div>
              </div>
            ))}
          </div>

          {/* Discount */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Скидка</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {(['none', 'promo', ...(role === 'admin' ? ['admin'] : [])] as typeof discountKind[]).map(k => (
                <button key={k} type="button" style={{ ...S.tabBtn, ...(discountKind === k ? S.tabBtnActive : {}) }}
                  onClick={() => { setDiscountKind(k); setPromoData(null); setPromoErr(''); }}>
                  {k === 'none' ? 'Нет' : k === 'promo' ? 'Промокод' : 'Скидка адм.'}
                </button>
              ))}
            </div>
            {discountKind === 'promo' && (
              <div style={{ display: 'flex', gap: 4 }}>
                <input style={{ ...S.inp, flex: 1 }} placeholder="ПРОМОКОД" value={promoCode}
                  onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoData(null); setPromoErr(''); }} />
                <button type="button" style={S.saveBtn} onClick={validatePromo}>Проверить</button>
              </div>
            )}
            {promoErr && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 2 }}>{promoErr}</div>}
            {promoData && <div style={{ fontSize: 12, color: '#16a34a', marginTop: 2 }}>✓ {promoData.discount_type === 'percent' ? promoData.discount_value + '%' : fmtMoney(promoData.discount_value)}</div>}
            {discountKind === 'admin' && (
              <div style={{ display: 'flex', gap: 4 }}>
                <select style={S.inp} value={adminDiscType} onChange={e => setAdminDiscType(e.target.value as 'percent' | 'fixed')}>
                  <option value="percent">%</option>
                  <option value="fixed">₸</option>
                </select>
                <input style={{ ...S.inp, flex: 1 }} type="number" min="0" placeholder="Размер" value={adminDiscVal} onChange={e => setAdminDiscVal(e.target.value)} />
              </div>
            )}
          </div>

          {/* Totals */}
          <div style={{ padding: '6px 12px', borderTop: '1px solid #f1f5f9', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Итого:</span><span style={{ fontWeight: 700 }}>{fmtMoney(subtotal)}</span></div>
            {discount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a' }}><span>Скидка:</span><span>−{fmtMoney(discount)}</span></div>}
            {depositItems.length > 0 && <div style={{ fontSize: 11, color: '#64748b' }}>* на депозит скидка не применяется</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, marginTop: 4 }}><span>К оплате:</span><span style={{ color: '#263CD9' }}>{fmtMoney(total)}</span></div>
          </div>

          {/* Payments */}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Оплата</div>
            {payments.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <select style={{ ...S.inp, flex: 2 }} value={p.methodId}
                  onChange={e => setPayments(ps => ps.map((x, j) => j === i ? { ...x, methodId: e.target.value } : x))}>
                  <option value="">— способ —</option>
                  {payMethods.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <input style={{ ...S.inp, flex: 1 }} type="number" min="0" placeholder="₸"
                  value={p.amount}
                  onChange={e => setPayments(ps => ps.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                {payments.length > 1 && <button style={S.removeBtn} onClick={() => setPayments(ps => ps.filter((_, j) => j !== i))}>✕</button>}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" style={S.linkBtn} onClick={() => setPayments(ps => [...ps, { methodId: '', amount: '' }])}>+ ещё</button>
              <span style={{ fontSize: 12, color: remaining === 0 ? '#16a34a' : remaining > 0 ? '#ef4444' : '#f59e0b' }}>
                {remaining > 0 ? `Осталось: ${fmtMoney(remaining)}` : remaining < 0 ? `Лишнее: ${fmtMoney(-remaining)}` : '✓ Сходится'}
              </span>
            </div>
          </div>

          {err && <div style={{ padding: '4px 12px' }}><div style={S.err}>{err}</div></div>}
          <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9' }}>
            <button type="button" style={{ ...S.saveBtn, width: '100%', padding: '12px', fontSize: 15 }}
              disabled={saving || cart.length === 0} onClick={submit}>
              {saving ? '…' : `Оформить${total > 0 ? ' · ' + fmtMoney(total) : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ShiftOpen ──────────────────────────────────────────────────────────────────

function ShiftOpen({ shift, role, displayName, payMethods, users, onClosed, onNewSale }: {
  shift: Shift; role: string; displayName: string;
  payMethods: PM[]; users: AppUser[];
  onClosed: () => void; onNewSale: () => void;
}) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [showMovement, setShowMovement] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [selectedSale, setSelectedSale] = useState<SaleFull | null>(null);
  const [refundDone, setRefundDone] = useState(false);

  const load = useCallback(() => {
    api('GET', `/kviz/api/crm/shifts/${shift.id}/movements`).then(({ data }) => { if (Array.isArray(data)) setMovements(data); });
    api('GET', `/kviz/api/crm/shifts/${shift.id}/sales`).then(({ data }) => { if (Array.isArray(data)) setSales(data); });
  }, [shift.id]);

  useEffect(() => { load(); }, [load]);

  async function openRefund(saleId: string) {
    const { data } = await api('GET', `/kviz/api/crm/sales/${saleId}`);
    setSelectedSale(data as SaleFull);
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc' }}>
      {/* Left: shift info */}
      <div style={{ width: 280, background: '#fff', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Смена открыта</div>
          <div style={S.infoRow}><span style={S.infoKey}>Дата</span><span>{shift.shift_date}</span></div>
          <div style={S.infoRow}><span style={S.infoKey}>Открыл</span><span>{shift.opened_by}</span></div>
          <div style={S.infoRow}><span style={S.infoKey}>Время</span><span>{fmtDT(shift.opened_at)}</span></div>
          <div style={S.infoRow}><span style={S.infoKey}>Открытие</span><span>{fmtMoney(shift.opening_cash)}</span></div>
        </div>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button style={{ ...S.saveBtn, width: '100%' }} onClick={onNewSale}>+ Новая продажа</button>
          <button style={{ ...S.outlineBtn, width: '100%' }} onClick={() => setShowMovement(true)}>Внесение / Изъятие</button>
          <button style={{ ...S.outlineBtn, width: '100%', color: '#ef4444', borderColor: '#fca5a5' }} onClick={() => setShowClose(true)}>Закрыть смену</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>ДВИЖЕНИЯ НАЛИЧНЫХ</div>
          {movements.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Нет движений</div>}
          {movements.map(m => (
            <div key={m.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: m.type === 'in' ? '#16a34a' : '#ef4444', fontWeight: 600 }}>
                  {m.type === 'in' ? '+' : '−'}{fmtMoney(m.amount)}
                </span>
                <span style={{ color: '#94a3b8' }}>{fmtDT(m.created_at)}</span>
              </div>
              <div style={{ color: '#64748b' }}>{m.comment} · {m.created_by}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: sales list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Продажи в смене</div>
        {sales.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13 }}>Продажи не найдены</div>}
        {sales.map(sale => (
          <div key={sale.id} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '10px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                #{sale.number} · {fmtMoney(sale.total)}
                {sale.status !== 'completed' && <span style={{ marginLeft: 6, fontSize: 11, background: '#fef2f2', color: '#ef4444', padding: '1px 5px', borderRadius: 4 }}>{sale.status}</span>}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                {sale.cashier}{sale.manager && sale.manager !== sale.cashier ? ` · Менеджер: ${sale.manager}` : ''} · {fmtDT(sale.created_at)}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                {sale.crm_sale_payments.map(p => fmtMoney(p.amount)).join(' + ')}
                {sale.discount_kind !== 'none' && ` · скидка (${sale.discount_kind})`}
              </div>
            </div>
            {role === 'admin' && sale.status === 'completed' && (
              <button style={{ ...S.outlineBtn, fontSize: 12, color: '#ef4444', borderColor: '#fca5a5' }} onClick={() => openRefund(sale.id)}>Возврат</button>
            )}
          </div>
        ))}
      </div>

      {showMovement && <MovementModal shiftId={shift.id} onDone={() => { setShowMovement(false); load(); }} onClose={() => setShowMovement(false)} />}
      {showClose && <CloseShiftModal shift={shift} onDone={() => { setShowClose(false); onClosed(); }} onClose={() => setShowClose(false)} />}
      {selectedSale && !refundDone && (
        <RefundDialog sale={selectedSale} payMethods={payMethods}
          onDone={() => { setRefundDone(false); setSelectedSale(null); load(); }}
          onClose={() => setSelectedSale(null)} />
      )}
    </div>
  );
}

// ── ShiftClosed ────────────────────────────────────────────────────────────────

function ShiftClosed({ role, onOpened }: { role: string; onOpened: () => void }) {
  const [openingCash, setOpeningCash] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  async function openShift() {
    setErr(''); setSaving(true);
    const body: Record<string, unknown> = {};
    if (role === 'admin' && openingCash !== '') body.opening_cash = Number(openingCash);
    const { ok, data } = await api('POST', '/kviz/api/crm/shifts', body);
    setSaving(false);
    if (!ok) { setErr(data.error || 'Ошибка'); return; }
    onOpened();
  }

  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc' }}>
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '32px 40px', textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Смена закрыта</h2>
        <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px' }}>Откройте смену, чтобы начать работу с кассой</p>
        {role === 'admin' && (
          <div style={{ marginBottom: 14, textAlign: 'left' }}>
            <label style={S.label}>Остаток на открытие (₸)</label>
            <input style={S.inp} type="number" min="0" placeholder="По умолчанию — с прошлой смены" value={openingCash} onChange={e => setOpeningCash(e.target.value)} />
          </div>
        )}
        {err && <div style={{ ...S.err, marginBottom: 12 }}>{err}</div>}
        <button style={{ ...S.saveBtn, width: '100%', padding: '12px' }} disabled={saving} onClick={openShift}>
          {saving ? '…' : 'Открыть смену'}
        </button>
      </div>
    </div>
  );
}

// ── KassaPage ──────────────────────────────────────────────────────────────────

type Screen = 'loading' | 'closed' | 'open' | 'sale' | 'done';

export default function KassaPage() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [shift, setShift] = useState<Shift | null>(null);
  const [role, setRole] = useState('manager');
  const [displayName, setDisplayName] = useState('');
  const [payMethods, setPayMethods] = useState<PM[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [lastSaleNum, setLastSaleNum] = useState<number | null>(null);

  async function loadState() {
    const [meRes, shiftRes, pmRes, usersRes] = await Promise.all([
      api('GET', '/kviz/api/me'),
      api('GET', '/kviz/api/crm/shifts/current'),
      api('GET', '/kviz/api/crm/payment-methods'),
      api('GET', '/kviz/api/crm/users'),
    ]);
    if (meRes.data.role) setRole(meRes.data.role);
    if (meRes.data.display_name) setDisplayName(meRes.data.display_name);
    if (Array.isArray(pmRes.data)) setPayMethods(pmRes.data);
    if (Array.isArray(usersRes.data)) setUsers(usersRes.data);
    if (shiftRes.data && shiftRes.data.id) {
      setShift(shiftRes.data); setScreen('open');
    } else {
      setShift(null); setScreen('closed');
    }
  }

  useEffect(() => { loadState(); }, []);

  if (screen === 'loading') return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Manrope',system-ui,sans-serif", color: '#94a3b8' }}>Загрузка…</div>;

  if (screen === 'done') return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: "'Manrope',system-ui,sans-serif", background: '#f8fafc' }}>
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', padding: '32px 40px', textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Продажа оформлена</h2>
        {lastSaleNum && <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px' }}>Чек #{lastSaleNum}</p>}
        <button style={{ ...S.saveBtn, width: '100%', padding: '12px' }} onClick={() => setScreen('open')}>Вернуться в смену</button>
        <button style={{ ...S.cancelBtn, width: '100%', marginTop: 8 }} onClick={() => setScreen('sale')}>Ещё продажа</button>
      </div>
    </div>
  );

  if (screen === 'closed') return (
    <ShiftClosed role={role} onOpened={() => loadState()} />
  );

  if (screen === 'sale' && shift) return (
    <SaleScreen shift={shift} role={role} displayName={displayName} payMethods={payMethods} users={users}
      onCancel={() => setScreen('open')}
      onDone={(num) => { setLastSaleNum(num); setScreen('done'); }}
    />
  );

  if (screen === 'open' && shift) return (
    <ShiftOpen shift={shift} role={role} displayName={displayName} payMethods={payMethods} users={users}
      onClosed={() => loadState()}
      onNewSale={() => setScreen('sale')}
    />
  );

  return null;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal:   { background: '#fff', borderRadius: 14, padding: '20px 24px', width: '90%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto' },
  modalTitle: { margin: '0 0 14px', fontSize: 16, fontWeight: 700 },
  modalBtns: { display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' },
  label:   { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 8 },
  inp:     { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const },
  err:     { background: '#fef2f2', color: '#ef4444', padding: '7px 10px', borderRadius: 8, fontSize: 13 },
  saveBtn: { padding: '8px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' },
  cancelBtn: { padding: '8px 14px', background: 'none', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' },
  outlineBtn: { padding: '7px 12px', background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' },
  tabBtn:  { padding: '5px 12px', background: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#374151', fontWeight: 500 },
  tabBtnActive: { background: '#02BDB6', color: '#fff', fontWeight: 700 },
  linkBtn: { background: 'none', border: 'none', color: '#02BDB6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px' },
  removeBtn: { background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px', flexShrink: 0 },
  qtyBtn:  { padding: '2px 8px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' },
  catalogCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', marginBottom: 8, cursor: 'pointer', transition: 'box-shadow 0.1s' },
  infoRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: '#374151' },
  infoKey: { color: '#94a3b8', marginRight: 8 },
};
