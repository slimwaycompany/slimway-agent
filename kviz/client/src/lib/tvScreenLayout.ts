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

// ── Carousel aspect: carousel slot in default layout (w=69% of 16, h=80% of 9) ─
export const CAROUSEL_ASPECT = (69 * 16) / (80 * 9); // ≈ 1.533

// ── Free slide layout (v2 — subset of ScreenLayout: text/image/shape only) ─────

export interface FreeLayout { v: 2; frame: boolean; elements: ScreenEl[] }

/** Migrates old v1 free layout {frame, elements:[{type:'text'|'image'}]} to v2 */
export function migrateFreeLayoutToV2(raw: unknown): FreeLayout {
  if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).v === 2) {
    return raw as FreeLayout;
  }
  const v1 = raw as { frame?: boolean; elements?: Record<string, unknown>[] } | null;
  const frame = v1?.frame ?? false;
  const els: ScreenEl[] = (v1?.elements ?? []).map(el => {
    const id = typeof el.id === 'string' ? el.id : newId();
    const base = { id, x: Number(el.x) || 0, y: Number(el.y) || 0, w: Number(el.w) || 10, h: Number(el.h) || 10, z: Number(el.z) || 0, visible: true as const, locked: false as const };
    if (el.type === 'image') {
      return { ...base, type: 'image' as const, path: typeof el.path === 'string' ? el.path : undefined, fit: (['contain','cover','stretch'].includes(el.fit as string) ? el.fit : 'cover') as 'contain' | 'cover' | 'stretch' };
    }
    return {
      ...base, type: 'text' as const,
      text:   typeof el.text === 'string' ? el.text : '',
      font:   (VALID_FONTS.includes(el.font as FontNameV2) ? el.font : 'Manrope') as FontNameV2,
      size:   Number(el.size) || 2,
      weight: ([400, 600, 800].includes(Number(el.weight)) ? Number(el.weight) : 400) as 400 | 600 | 800,
      color:  (typeof el.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(el.color)) ? el.color : '#000000',
      align:  (['left','center','right'].includes(el.align as string) ? el.align : 'left') as TextAlignV2,
      scaleX: Number(el.scaleX) || 1, scaleY: Number(el.scaleY) || 1,
    };
  });
  return { v: 2, frame, elements: els };
}

// ── Slide templates ──────────────────────────────────────────────────────────
// синхронизировать с src/http/tv.ts (validateSlideTemplateServer, defaultSlideTemplatesServer)

interface SlotChildBase {
  id: string;
  x: number; y: number; w: number; h: number; // 0–100% of slot container
  z: number;
  visible?: boolean;
  locked?: boolean;
}
export interface SlotChildText  extends SlotChildBase, TextStyle { type: 'text';  text?: string; bind?: 'name'; }
export interface SlotChildImage extends SlotChildBase { type: 'image'; bind?: 'before' | 'after'; path?: string; fit?: 'contain' | 'cover' | 'stretch'; opacity?: number; radius?: number; }
export interface SlotChildShape extends SlotChildBase { type: 'shape'; shape: ScreenElShape['shape']; radius?: number; fill?: ShapeFill; border?: ScreenElShape['border']; shadow?: boolean; blur?: boolean; }
export type SlotChild = SlotChildText | SlotChildImage | SlotChildShape;

export interface TplElSlotClient extends ElBase { type: 'slot_client'; index: 'a' | 'b'; children: SlotChild[]; }
export interface TplElSlotImage  extends ElBase { type: 'slot_image';  fit?: 'contain' | 'cover' | 'stretch'; opacity?: number; radius?: number; }
export interface TplElSlotText   extends ElBase, TextStyle { type: 'slot_text'; }

export type TemplateTopEl = ScreenElText | ScreenElImage | ScreenElShape | TplElSlotClient | TplElSlotImage | TplElSlotText;
export interface SlideTemplate  { v: 1; elements: TemplateTopEl[] }
export interface SlideTemplates { result1: SlideTemplate; result2: SlideTemplate; image: SlideTemplate }
export type TemplateKind = keyof SlideTemplates;

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  result1: '1 результат',
  result2: '2 результата',
  image:   'Акция / USP',
};

export const TEMPLATE_EL_LABELS: Record<string, string> = {
  text:        'Текст',
  image:       'Картинка',
  shape:       'Фигура',
  slot_client: 'Слот клиента',
  slot_image:  'Слот картинки',
  slot_text:   'Слот текста',
};

export function defSlotChildren(): SlotChild[] {
  return [
    { id: newId(), type: 'text',  bind: 'name',   x: 2,  y: 1,  w: 96, h: 13, z: 2, visible: true, locked: false, font: 'Manrope', size: 3, weight: 700, color: '#1a202c', align: 'center' },
    { id: newId(), type: 'image', bind: 'before',  x: 0,  y: 15, w: 50, h: 85, z: 1, visible: true, locked: false, fit: 'cover' },
    { id: newId(), type: 'image', bind: 'after',   x: 50, y: 15, w: 50, h: 85, z: 1, visible: true, locked: false, fit: 'cover' },
  ];
}

export function defaultSlideTemplates(): SlideTemplates {
  return {
    result1: { v: 1, elements: [
      { id: newId(), type: 'slot_client', x: 2, y: 2, w: 96, h: 96, z: 1, visible: true, locked: false, index: 'a', children: defSlotChildren() },
    ]},
    result2: { v: 1, elements: [
      { id: newId(), type: 'slot_client', x: 1,  y: 2, w: 48, h: 96, z: 1, visible: true, locked: false, index: 'a', children: defSlotChildren() },
      { id: newId(), type: 'slot_client', x: 51, y: 2, w: 48, h: 96, z: 1, visible: true, locked: false, index: 'b', children: defSlotChildren() },
    ]},
    image: { v: 1, elements: [
      { id: newId(), type: 'slot_image', x: 0, y: 0,  w: 100, h: 100, z: 0, visible: true, locked: false, fit: 'contain' },
      { id: newId(), type: 'slot_text',  x: 5, y: 82, w: 90,  h: 14,  z: 1, visible: true, locked: false, font: 'Manrope', size: 4, weight: 700, color: '#ffffff', align: 'center' },
    ]},
  };
}

export function validateSlideTemplate(kind: TemplateKind, raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'Шаблон должен быть объектом';
  const t = raw as Record<string, unknown>;
  if (t.v !== 1) return 'Шаблон: v должно быть 1';
  if (!Array.isArray(t.elements)) return 'elements должен быть массивом';
  if ((t.elements as unknown[]).length > 30) return 'Максимум 30 элементов';

  const TPLS_TYPES = new Set(['text','image','shape','slot_client','slot_image','slot_text']);
  const ids = new Set<string>();
  let cntA = 0, cntB = 0, cntSlotImg = 0, cntSlotTxt = 0;

  for (const item of t.elements as unknown[]) {
    if (typeof item !== 'object' || item === null) return 'Элемент не является объектом';
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string') return 'Поле id элемента обязательно';
    if (ids.has(e.id)) return `Дублирующийся id: ${e.id}`;
    ids.add(e.id);
    if (!TPLS_TYPES.has(String(e.type))) return `Неверный type: ${e.type}`;
    for (const k of ['x','y','w','h'] as const) {
      if (typeof e[k] !== 'number' || (e[k] as number) < 0 || (e[k] as number) > 100) return `${k}: 0–100`;
    }
    if (typeof e.z !== 'number') return 'z: число';
    if (e.type === 'slot_client') {
      if (e.index !== 'a' && e.index !== 'b') return 'slot_client.index: a или b';
      if (e.index === 'a') cntA++; else cntB++;
      if (!Array.isArray(e.children)) return 'slot_client.children: массив';
      if ((e.children as unknown[]).length > 8) return 'Максимум 8 дочерних элементов в слоте';
    }
    if (e.type === 'slot_image') cntSlotImg++;
    if (e.type === 'slot_text')  cntSlotTxt++;
  }

  if (kind === 'result1') {
    if (cntA !== 1) return 'result1 требует ровно один slot_client[a]';
    if (cntB > 0)   return 'result1 не должен содержать slot_client[b]';
  } else if (kind === 'result2') {
    if (cntA !== 1) return 'result2 требует slot_client[a]';
    if (cntB !== 1) return 'result2 требует slot_client[b]';
  } else if (kind === 'image') {
    if (cntSlotImg !== 1) return 'image требует ровно один slot_image';
    if (cntSlotTxt > 1)   return 'image: не более одного slot_text';
    if (cntA + cntB > 0)  return 'image не должен содержать slot_client';
  }
  return null;
}

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
