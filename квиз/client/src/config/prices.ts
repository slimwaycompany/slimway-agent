export type PriceFormat = 'vacu' | 'cross' | 'rollshape' | 'vacu_roll' | 'complex';

export interface PricePackage {
  sessions: number;
  rollSessions?: number;
  weeks: number;
  price: number;
  perSession: number;
  label: string;
  isSingle?: boolean;
}

export const PRICE_NAMES: Record<PriceFormat, string> = {
  vacu:     'VACU',
  cross:    'КРОСС',
  rollshape:'ROLLSHAPE',
  vacu_roll:'VACU + ROLLSHAPE',
  complex:  'COMPLEX',
};

export const PRICE_CONDITIONS = [
  'Продолжительность сеанса — 30 минут',
  'К основному сроку добавляется дополнительный срок 2 месяца',
  'InfraShape / InfraStep / Vacu Activ — на выбор, с учётом рекомендаций и доступности',
  'Посещение по предварительной записи',
];

export const PRICE_PACKS: Record<PriceFormat, PricePackage[]> = {
  vacu: [
    { sessions: 1,  weeks: 0,  price: 15000,  perSession: 15000, label: '1 сеанс',          isSingle: true },
    { sessions: 10, weeks: 5,  price: 100000, perSession: 10000, label: '10 сеансов, 5 нед' },
    { sessions: 16, weeks: 8,  price: 125000, perSession: 7813,  label: '16 сеансов, 2 мес' },
    { sessions: 24, weeks: 13, price: 160000, perSession: 6667,  label: '24 сеанса, 3 мес'  },
    { sessions: 40, weeks: 22, price: 220000, perSession: 5500,  label: '40 сеансов, 5 мес' },
  ],
  cross: [
    { sessions: 1,  weeks: 0,  price: 20000,  perSession: 20000, label: '1 сеанс',          isSingle: true },
    { sessions: 10, weeks: 5,  price: 125000, perSession: 12500, label: '10 сеансов, 5 нед' },
    { sessions: 16, weeks: 8,  price: 150000, perSession: 9375,  label: '16 сеансов, 2 мес' },
    { sessions: 24, weeks: 13, price: 200000, perSession: 8333,  label: '24 сеанса, 3 мес'  },
    { sessions: 40, weeks: 22, price: 250000, perSession: 6250,  label: '40 сеансов, 5 мес' },
  ],
  rollshape: [
    { sessions: 10, weeks: 5,  price: 40000,  perSession: 4000,  label: '10 сеансов, 5 нед' },
    { sessions: 16, weeks: 8,  price: 55000,  perSession: 3438,  label: '16 сеансов, 2 мес' },
    { sessions: 24, weeks: 13, price: 65000,  perSession: 2708,  label: '24 сеанса, 3 мес'  },
    { sessions: 40, weeks: 22, price: 80000,  perSession: 2000,  label: '40 сеансов, 5 мес' },
  ],
  vacu_roll: [
    { sessions: 1,  weeks: 0,  price: 20000,  perSession: 20000, label: '1 сеанс',                isSingle: true },
    { sessions: 10, rollSessions: 10, weeks: 5,  price: 140000, perSession: 7000,  label: '10+10 сеансов, 5 нед' },
    { sessions: 16, rollSessions: 16, weeks: 8,  price: 180000, perSession: 5625,  label: '16+16 сеансов, 2 мес' },
    { sessions: 24, rollSessions: 24, weeks: 13, price: 225000, perSession: 4688,  label: '24+24 сеанса, 3 мес'  },
    { sessions: 40, rollSessions: 40, weeks: 22, price: 300000, perSession: 3750,  label: '40+40 сеансов, 5 мес' },
  ],
  complex: [
    { sessions: 1,  weeks: 0,  price: 25000,  perSession: 25000, label: '1 сеанс',                isSingle: true },
    { sessions: 10, rollSessions: 10, weeks: 5,  price: 165000, perSession: 8250,  label: '10+10 сеансов, 5 нед' },
    { sessions: 16, rollSessions: 16, weeks: 8,  price: 205000, perSession: 6405,  label: '16+16 сеансов, 2 мес' },
    { sessions: 24, rollSessions: 24, weeks: 13, price: 265000, perSession: 5520,  label: '24+24 сеанса, 3 мес'  },
    { sessions: 40, rollSessions: 40, weeks: 22, price: 330000, perSession: 4125,  label: '40+40 сеансов, 5 мес' },
  ],
};

export function formatFromRecommendation(rec: string): PriceFormat {
  return rec.includes('Complex') ? 'complex' : 'cross';
}

export function selectPackage(format: PriceFormat, sessionsMin: number): PricePackage {
  const packs = PRICE_PACKS[format].filter(p => !p.isSingle);
  if (sessionsMin <= 0) return packs.find(p => p.sessions === 16) ?? packs[1];
  const fit = packs.filter(p => p.sessions >= sessionsMin);
  return fit[0] ?? packs[packs.length - 1];
}

export function fmtPrice(n: number): string {
  return n.toLocaleString('ru-RU') + ' ₸';
}
