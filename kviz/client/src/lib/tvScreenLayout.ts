// синхронизировать с src/http/tv.ts (validateScreenLayoutV2, defaultScreenLayoutV2Server, migrateToV2Server)

export type TextAlignV2  = 'left' | 'center' | 'right';
export type FontNameV2   = 'Manrope' | 'Montserrat' | 'Oswald' | 'Barlow Condensed' | 'Playfair Display' | 'Russo One' | 'Unbounded';
export type ScreenElType = 'text' | 'value' | 'mission' | 'datetime' | 'image' | 'shape' | 'carousel';

/** Shared text style — used by text / value / mission / datetime */
export interface TextStyle {
  font?:    FontNameV2;
  size?:    number;        // font-size as % of screen height, 1–60
  weight?:  400 | 600 | 800;
  color?:   string;        // #RRGGBB
  opacity?: number;        // 0–1
  align?:   TextAlignV2;
  scaleX?:  number;        // 0.5–2
  scaleY?:  number;        // 0.5–2
}

interface ElBase {
  id:       string;
  x: number; y: number; w: number; h: number; // 0–100% of screen
  rotate?:  number;   // -180..180 degrees, default 0
  z:        number;   // 0–500 layer order
  visible?: boolean;  // default true
  locked?:  boolean;  // default false — locked can't be moved/resized by mouse
}

export interface ScreenElText     extends ElBase, TextStyle { type: 'text';     text: string; }
export interface ScreenElValue    extends ElBase, TextStyle { type: 'value';    bind: 'value_cm' | 'value_kg' | 'value_fat'; }
export interface ScreenElMission  extends ElBase, TextStyle { type: 'mission';  /* text from studio_settings */ }
export interface ScreenElDatetime extends ElBase, TextStyle { type: 'datetime'; /* text from serverTime */ }

export interface ScreenElImage extends ElBase {
  type:     'image';
  asset?:   'logo' | 'icon_cm' | 'icon_kg' | 'icon_fat'; // built-in asset
  path?:    string;   // screen/<uuid>.<jpg|png> — uploaded image (exactly one of asset/path)
  fit?:     'contain' | 'cover' | 'stretch';
  opacity?: number;
  radius?:  number;   // border-radius as % of screen height, 0–10
}

export type ShapeFill =
  | { type: 'solid';    color: string; opacity: number }
  | { type: 'gradient'; from: string; to: string; angle: number; opacity: number };

export interface ScreenElShape extends ElBase {
  type:    'shape';
  shape:   'rect' | 'rounded' | 'circle' | 'ellipse' | 'pill';
  radius?: number;  // border-radius as % of screen height, 0–10 (rounded only)
  fill?:   ShapeFill;
  border?: { width: number; color: string; opacity: number }; // width = % screen height
  shadow?: boolean;
  blur?:   boolean; // glassmorphism backdrop-filter
}

export interface ScreenElCarousel extends ElBase {
  type:    'carousel';
  frame?:  boolean; // gradient border frame
  radius?: number;  // 0–10
  shadow?: boolean;
}

export type ScreenEl =
  | ScreenElText | ScreenElValue | ScreenElMission | ScreenElDatetime
  | ScreenElImage | ScreenElShape | ScreenElCarousel;

export interface ScreenLayout { v: 2; elements: ScreenEl[] }

// ── Labels / metadata ─────────────────────────────────────────────────────────

export const TYPE_LABELS: Record<ScreenElType, string> = {
  text:     'Текст',
  value:    'Число (счётчик)',
  mission:  'Миссия',
  datetime: 'Дата и время',
  image:    'Картинка',
  shape:    'Фигура',
  carousel: 'Карусель слайдов',
};

export const BIND_LABELS: Record<ScreenElValue['bind'], string> = {
  value_cm:  'Сантиметры',
  value_kg:  'Килограммы',
  value_fat: 'Жир',
};

export const SHAPE_LABELS: Record<ScreenElShape['shape'], string> = {
  rect:    'Прямоугольник',
  rounded: 'Скруглённый',
  circle:  'Круг',
  ellipse: 'Эллипс',
  pill:    'Таблетка',
};

export const VALID_FONTS: FontNameV2[] = [
  'Manrope', 'Montserrat', 'Oswald', 'Barlow Condensed',
  'Playfair Display', 'Russo One', 'Unbounded',
];

export const ASSET_LABELS: Record<Required<ScreenElImage>['asset'], string> = {
  logo:     'Логотип SlimWay',
  icon_cm:  'Иконка — сантиметры',
  icon_kg:  'Иконка — килограммы',
  icon_fat: 'Иконка — жир',
};

export function newId(): string { return crypto.randomUUID(); }

// ── Migration v1 → v2 ─────────────────────────────────────────────────────────

interface V1El {
  kind: string; x: number; y: number; w: number; h: number; z?: number;
  font?: string; size?: number; weight?: number; color?: string; align?: string;
  text?: string; label?: string; unit?: string;
}
interface V1Layout { version: 1; elements: V1El[] }

function migrateCounter(
  el: V1El,
  iconAsset: ScreenElImage['asset'],
  bind: ScreenElValue['bind'],
  unit: string,
  label: string,
): ScreenEl[] {
  const { x, y, w, h, z = 1 } = el;
  const iW  = Math.round(w * 0.33 * 2) / 2;
  const dX  = Math.round((x + w * 0.35) * 2) / 2;
  const dW  = Math.round(w * 0.65 * 2) / 2;
  const nH  = Math.round(h * 0.52 * 2) / 2;
  const uH  = Math.round(h * 0.18 * 2) / 2;
  const lH  = h - nH - uH;
  return [
    { id: newId(), type: 'image',  x, y, w: iW, h, z, visible: true, locked: false, asset: iconAsset, fit: 'contain' },
    { id: newId(), type: 'value',  x: dX, y, w: dW, h: nH, z, visible: true, locked: false,
      bind, font: 'Barlow Condensed', size: Math.round(h * 0.47 * 10) / 10, weight: 800, color: '#1e293b', align: 'right' },
    { id: newId(), type: 'text',   x: dX, y: y + nH, w: dW, h: uH, z, visible: true, locked: false,
      text: unit, font: 'Manrope', size: Math.round(h * 0.14 * 10) / 10, weight: 600, color: '#64748b', align: 'right' },
    { id: newId(), type: 'text',   x: dX, y: y + nH + uH, w: dW, h: lH, z, visible: true, locked: false,
      text: label, font: 'Manrope', size: Math.round(h * 0.1 * 10) / 10, weight: 400, color: '#475569', align: 'right' },
  ];
}

export function migrateV1ToV2(v1: V1Layout, seed?: { label_cm?: string; label_kg?: string; label_fat?: string }): ScreenLayout {
  const elements: ScreenEl[] = [];
  for (const el of v1.elements) {
    const z = el.z ?? 0;
    if (el.kind === 'logo') {
      elements.push({ id: newId(), type: 'image', x: el.x, y: el.y, w: el.w, h: el.h, z: z || 2, visible: true, locked: false, asset: 'logo', fit: 'contain' });
    } else if (el.kind === 'panel') {
      elements.push({ id: newId(), type: 'shape', x: el.x, y: el.y, w: el.w, h: el.h, z: 0, visible: true, locked: false, shape: 'rounded', radius: 2, fill: { type: 'solid', color: '#ffffff', opacity: 0.58 }, border: { width: 0.15, color: '#ffffff', opacity: 0.85 }, shadow: true, blur: true });
    } else if (el.kind === 'intro') {
      elements.push({ id: newId(), type: 'text', x: el.x, y: el.y, w: el.w, h: el.h, z: z || 1, visible: true, locked: false, text: el.text ?? 'На сегодня мы', font: (el.font as FontNameV2) ?? 'Manrope', size: el.size ?? 1.1, weight: (el.weight as 400|600|800) ?? 600, color: el.color ?? '#263CD9', align: (el.align as TextAlignV2) ?? 'center' });
    } else if (el.kind === 'counter_cm') {
      elements.push(...migrateCounter(el, 'icon_cm', 'value_cm', el.unit ?? 'см', seed?.label_cm ?? el.label ?? 'Сантиметров убрали'));
    } else if (el.kind === 'counter_kg') {
      elements.push(...migrateCounter(el, 'icon_kg', 'value_kg', el.unit ?? 'кг', seed?.label_kg ?? el.label ?? 'Килограммов сбросили'));
    } else if (el.kind === 'counter_fat') {
      elements.push(...migrateCounter(el, 'icon_fat', 'value_fat', el.unit ?? 'кг', seed?.label_fat ?? el.label ?? 'Жира сожгли'));
    } else if (el.kind === 'carousel') {
      elements.push({ id: newId(), type: 'carousel', x: el.x, y: el.y, w: el.w, h: el.h, z: 0, visible: true, locked: false, frame: false });
    } else if (el.kind === 'mission') {
      elements.push({ id: newId(), type: 'mission', x: el.x, y: el.y, w: el.w, h: el.h, z: z || 2, visible: true, locked: false, font: (el.font as FontNameV2) ?? 'Manrope', size: el.size ?? 1.6, weight: (el.weight as 400|600|800) ?? 600, color: el.color ?? '#263CD9', align: (el.align as TextAlignV2) ?? 'center' });
    } else if (el.kind === 'datetime') {
      elements.push({ id: newId(), type: 'datetime', x: el.x, y: el.y, w: el.w, h: el.h, z: z || 2, visible: true, locked: false, font: (el.font as FontNameV2) ?? 'Manrope', size: el.size ?? 1.3, weight: (el.weight as 400|600|800) ?? 600, color: el.color ?? '#000000', align: (el.align as TextAlignV2) ?? 'right' });
    }
  }
  return { v: 2, elements };
}

// ── Default layout (v2) ───────────────────────────────────────────────────────

export function defaultScreenLayout(): ScreenLayout {
  return {
    v: 2,
    elements: [
      // Logo — top center
      { id: newId(), type: 'image',    x: 36,   y: 1,    w: 28,  h: 9,    z: 2, visible: true, locked: false, asset: 'logo',    fit: 'contain' },
      // Background panel (glassmorphism)
      { id: newId(), type: 'shape',    x: 2,    y: 11,   w: 27,  h: 80,   z: 0, visible: true, locked: false, shape: 'rounded', radius: 2, fill: { type: 'solid', color: '#ffffff', opacity: 0.58 }, border: { width: 0.15, color: '#ffffff', opacity: 0.85 }, shadow: true, blur: true },
      // Intro text
      { id: newId(), type: 'text',     x: 3,    y: 12,   w: 25,  h: 7,    z: 1, visible: true, locked: false, text: 'На сегодня мы', font: 'Manrope', size: 1.1, weight: 600, color: '#263CD9', align: 'center' },
      // Counter cm
      { id: newId(), type: 'image',    x: 3,    y: 20,   w: 8,   h: 23,   z: 1, visible: true, locked: false, asset: 'icon_cm',  fit: 'contain' },
      { id: newId(), type: 'value',    x: 11.5, y: 20,   w: 16.5,h: 12,   z: 1, visible: true, locked: false, bind: 'value_cm',  font: 'Barlow Condensed', size: 11, weight: 800, color: '#1e293b', align: 'right' },
      { id: newId(), type: 'text',     x: 11.5, y: 32,   w: 16.5,h: 4,    z: 1, visible: true, locked: false, text: 'см', font: 'Manrope', size: 3.2, weight: 600, color: '#64748b', align: 'right' },
      { id: newId(), type: 'text',     x: 11.5, y: 36,   w: 16.5,h: 7,    z: 1, visible: true, locked: false, text: 'Сантиметров убрали', font: 'Manrope', size: 2.3, weight: 400, color: '#475569', align: 'right' },
      // Counter kg
      { id: newId(), type: 'image',    x: 3,    y: 44,   w: 8,   h: 23,   z: 1, visible: true, locked: false, asset: 'icon_kg',  fit: 'contain' },
      { id: newId(), type: 'value',    x: 11.5, y: 44,   w: 16.5,h: 12,   z: 1, visible: true, locked: false, bind: 'value_kg',  font: 'Barlow Condensed', size: 11, weight: 800, color: '#1e293b', align: 'right' },
      { id: newId(), type: 'text',     x: 11.5, y: 56,   w: 16.5,h: 4,    z: 1, visible: true, locked: false, text: 'кг', font: 'Manrope', size: 3.2, weight: 600, color: '#64748b', align: 'right' },
      { id: newId(), type: 'text',     x: 11.5, y: 60,   w: 16.5,h: 7,    z: 1, visible: true, locked: false, text: 'Килограммов сбросили', font: 'Manrope', size: 2.3, weight: 400, color: '#475569', align: 'right' },
      // Counter fat
      { id: newId(), type: 'image',    x: 3,    y: 68,   w: 8,   h: 22,   z: 1, visible: true, locked: false, asset: 'icon_fat', fit: 'contain' },
      { id: newId(), type: 'value',    x: 11.5, y: 68,   w: 16.5,h: 11.5, z: 1, visible: true, locked: false, bind: 'value_fat', font: 'Barlow Condensed', size: 10.5, weight: 800, color: '#1e293b', align: 'right' },
      { id: newId(), type: 'text',     x: 11.5, y: 79.5, w: 16.5,h: 3.5,  z: 1, visible: true, locked: false, text: 'кг', font: 'Manrope', size: 3.2, weight: 600, color: '#64748b', align: 'right' },
      { id: newId(), type: 'text',     x: 11.5, y: 83,   w: 16.5,h: 7,    z: 1, visible: true, locked: false, text: 'Жира сожгли', font: 'Manrope', size: 2.3, weight: 400, color: '#475569', align: 'right' },
      // Carousel — right side
      { id: newId(), type: 'carousel', x: 30,   y: 11,   w: 69,  h: 80,   z: 0, visible: true, locked: false, frame: false },
      // Mission — bottom center
      { id: newId(), type: 'mission',  x: 20,   y: 92,   w: 60,  h: 5,    z: 2, visible: true, locked: false, font: 'Manrope', size: 1.6, weight: 600, color: '#263CD9', align: 'center' },
      // Datetime — bottom right
      { id: newId(), type: 'datetime', x: 81,   y: 92,   w: 18,  h: 5,    z: 2, visible: true, locked: false, font: 'Manrope', size: 1.3, weight: 600, color: '#000000', align: 'right' },
    ],
  };
}
