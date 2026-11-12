// синхронизировать с src/http/tv.ts (validateScreenLayout, defaultScreenLayoutServer)

export type ScreenElKind =
  | 'logo' | 'panel' | 'carousel'
  | 'intro' | 'mission' | 'datetime'
  | 'counter_cm' | 'counter_kg' | 'counter_fat';

export interface ScreenEl {
  kind: ScreenElKind;
  x: number; y: number; w: number; h: number; z?: number;
  // text style (intro, mission, datetime, counters)
  font?: string;
  size?: number;  // font-size as % of screen height
  weight?: 400 | 600 | 800;
  color?: string;
  align?: 'left' | 'center' | 'right';
  // text content
  text?: string;   // intro, mission
  // counter content
  label?: string;
  unit?: string;
}

export interface ScreenLayout {
  version: 1;
  elements: ScreenEl[];
}

export const SCREEN_EL_LABELS: Record<ScreenElKind, string> = {
  logo: 'Логотип',
  panel: 'Панель (фон)',
  intro: 'Вступительный текст',
  counter_cm: 'Счётчик — сантиметры',
  counter_kg: 'Счётчик — килограммы',
  counter_fat: 'Счётчик — жир',
  mission: 'Миссия',
  datetime: 'Дата и время',
  carousel: 'Карусель слайдов',
};

export function defaultScreenLayout(): ScreenLayout {
  return {
    version: 1,
    elements: [
      { kind: 'logo',        x: 36,  y: 1,  w: 28, h: 9,  z: 2 },
      { kind: 'panel',       x: 2,   y: 11, w: 27, h: 80, z: 0 },
      { kind: 'intro',       x: 3,   y: 12, w: 25, h: 7,  z: 1,
        text: 'На сегодня мы', font: 'Manrope', size: 1.1, weight: 600, color: '#263CD9', align: 'center' },
      { kind: 'counter_cm',  x: 3,   y: 20, w: 25, h: 23, z: 1,
        label: 'Сантиметров убрали',    unit: 'см' },
      { kind: 'counter_kg',  x: 3,   y: 44, w: 25, h: 23, z: 1,
        label: 'Килограммов сбросили',  unit: 'кг' },
      { kind: 'counter_fat', x: 3,   y: 68, w: 25, h: 22, z: 1,
        label: 'Жира сожгли',           unit: 'кг' },
      { kind: 'carousel',    x: 30,  y: 11, w: 69, h: 80, z: 0 },
      { kind: 'mission',     x: 20,  y: 92, w: 60, h: 5,  z: 2,
        text: 'Вместе к лучшей версии себя', font: 'Manrope', size: 1.6, weight: 600, color: '#263CD9', align: 'center' },
      { kind: 'datetime',    x: 81,  y: 92, w: 18, h: 5,  z: 2,
        font: 'Manrope', size: 1.3, weight: 600, color: '#000000', align: 'right' },
    ],
  };
}
