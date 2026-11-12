import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../db/supabase';
import { getSession } from './auth';

const BUCKET = 'tv-media';
const sseClients = new Set<Response>();

export function tvNotify(): void {
  if (!sseClients.size) return;
  const msg = 'event: changed\ndata: {}\n\n';
  for (const c of sseClients) {
    try { c.write(msg); } catch { sseClients.delete(c); }
  }
}

function checkKey(req: Request): boolean {
  const exp = process.env.RESULTS_DISPLAY_KEY;
  return !!exp && req.query.key === exp;
}

function isAdmin(req: Request): boolean {
  return getSession(req)?.role === 'admin';
}

const VALID_FONTS = new Set(['Manrope', 'Montserrat', 'Oswald', 'Barlow Condensed', 'Playfair Display', 'Russo One', 'Unbounded']);
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateLayout(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'layout должен быть объектом';
  const l = raw as Record<string, unknown>;
  if (typeof l.frame !== 'boolean') return 'layout.frame должен быть true или false';
  if (!Array.isArray(l.elements)) return 'layout.elements должен быть массивом';
  if ((l.elements as unknown[]).length > 12) return 'Максимум 12 элементов в слайде';
  const ids = new Set<string>();
  for (const item of l.elements as unknown[]) {
    if (typeof item !== 'object' || item === null) return 'Элемент не является объектом';
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return 'id элемента должен быть UUID';
    if (ids.has(e.id)) return `Дублирующийся id: ${e.id}`;
    ids.add(e.id);
    if (e.type !== 'text' && e.type !== 'image') return 'type элемента: text или image';
    for (const [k, min, max] of [['x', 0, 100], ['y', 0, 100], ['w', 1, 100], ['h', 1, 100]] as const) {
      const v = e[k];
      if (typeof v !== 'number' || v < min || v > max) return `${k}: число ${min}–${max}`;
    }
    if (typeof e.z !== 'number' || !Number.isInteger(e.z) || e.z < 0 || e.z > 50) return 'z: целое 0–50';
    if (e.type === 'text') {
      if (typeof e.text !== 'string' || e.text.length > 500) return 'text: строка до 500 символов';
      if (!VALID_FONTS.has(e.font as string)) return `Неверный шрифт: ${e.font}. Допустимые: ${[...VALID_FONTS].join(', ')}`;
      if (typeof e.size !== 'number' || e.size < 1 || e.size > 60) return 'size: число 1–60';
      if (e.weight !== 400 && e.weight !== 600 && e.weight !== 800) return 'weight: 400, 600 или 800';
      if (typeof e.color !== 'string' || !HEX_RE.test(e.color)) return 'color: формат #RRGGBB';
      if (e.align !== 'left' && e.align !== 'center' && e.align !== 'right') return 'align: left, center или right';
      if (typeof e.scaleX !== 'number' || e.scaleX < 0.5 || e.scaleX > 2) return 'scaleX: 0.5–2';
      if (typeof e.scaleY !== 'number' || e.scaleY < 0.5 || e.scaleY > 2) return 'scaleY: 0.5–2';
    }
    if (e.type === 'image') {
      if (typeof e.path !== 'string' || !/^free\/[0-9a-f-]+\.(jpg|png)$/.test(e.path)) return 'path: free/<uuid>.jpg или free/<uuid>.png';
      if (e.fit !== 'cover' && e.fit !== 'contain' && e.fit !== 'stretch') return 'fit: cover, contain или stretch';
    }
  }
  return null;
}

// ── Screen layout (синхронизировать с kviz/client/src/lib/tvScreenLayout.ts) ──

const VALID_SCREEN_KINDS = new Set([
  'logo', 'panel', 'carousel', 'intro', 'mission', 'datetime',
  'counter_cm', 'counter_kg', 'counter_fat',
]);
const TEXT_SCREEN_KINDS   = new Set(['intro', 'mission', 'datetime']);
const COUNTER_SCREEN_KINDS = new Set(['counter_cm', 'counter_kg', 'counter_fat']);

function validateScreenLayout(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'screen_layout должен быть объектом';
  const l = raw as Record<string, unknown>;
  if (l.version !== 1) return 'version должна быть 1';
  if (!Array.isArray(l.elements)) return 'elements должен быть массивом';
  const kinds = new Set<string>();
  for (const item of l.elements as unknown[]) {
    if (typeof item !== 'object' || item === null) return 'элемент не объект';
    const e = item as Record<string, unknown>;
    const kind = String(e.kind);
    if (!VALID_SCREEN_KINDS.has(kind)) return `Неверный kind: ${kind}`;
    if (kinds.has(kind)) return `Дублирующийся kind: ${kind}`;
    kinds.add(kind);
    for (const [k, min, max] of [['x', 0, 100], ['y', 0, 100], ['w', 1, 100], ['h', 1, 100]] as const) {
      const v = e[k];
      if (typeof v !== 'number' || v < min || v > max) return `${kind}.${k}: число ${min}–${max}`;
    }
    if ('z' in e && (typeof e.z !== 'number' || !Number.isInteger(e.z) || (e.z as number) < 0 || (e.z as number) > 50))
      return `${kind}.z: целое 0–50`;
    if (TEXT_SCREEN_KINDS.has(kind) || COUNTER_SCREEN_KINDS.has(kind)) {
      if ('font' in e && e.font !== undefined && !VALID_FONTS.has(e.font as string))
        return `${kind}.font: неверный шрифт`;
      if ('size' in e && e.size !== undefined && (typeof e.size !== 'number' || (e.size as number) < 0.3 || (e.size as number) > 20))
        return `${kind}.size: 0.3–20`;
      if ('weight' in e && e.weight !== undefined && e.weight !== 400 && e.weight !== 600 && e.weight !== 800)
        return `${kind}.weight: 400, 600 или 800`;
      if ('color' in e && e.color !== undefined && (typeof e.color !== 'string' || !HEX_RE.test(e.color as string)))
        return `${kind}.color: формат #RRGGBB`;
      if ('align' in e && e.align !== undefined && e.align !== 'left' && e.align !== 'center' && e.align !== 'right')
        return `${kind}.align: left, center или right`;
    }
    if (TEXT_SCREEN_KINDS.has(kind) && 'text' in e && e.text !== undefined) {
      if (typeof e.text !== 'string' || (e.text as string).length > 300) return `${kind}.text: строка до 300 символов`;
    }
    if (COUNTER_SCREEN_KINDS.has(kind)) {
      if ('label' in e && e.label !== undefined && (typeof e.label !== 'string' || (e.label as string).length > 100))
        return `${kind}.label: строка до 100 символов`;
      if ('unit' in e && e.unit !== undefined && (typeof e.unit !== 'string' || (e.unit as string).length > 20))
        return `${kind}.unit: строка до 20 символов`;
    }
  }
  return null;
}

type ScreenElServer = Record<string, unknown>;
interface ScreenLayoutServer { version: 1; elements: ScreenElServer[] }

// синхронизировать с kviz/client/src/lib/tvScreenLayout.ts (defaultScreenLayout)
function defaultScreenLayoutServer(): ScreenLayoutServer {
  return {
    version: 1,
    elements: [
      { kind: 'logo',        x: 36, y: 1,  w: 28, h: 9,  z: 2 },
      { kind: 'panel',       x: 2,  y: 11, w: 27, h: 80, z: 0 },
      { kind: 'intro',       x: 3,  y: 12, w: 25, h: 7,  z: 1,
        text: 'На сегодня мы', font: 'Manrope', size: 1.1, weight: 600, color: '#263CD9', align: 'center' },
      { kind: 'counter_cm',  x: 3,  y: 20, w: 25, h: 23, z: 1,
        label: 'Сантиметров убрали',    unit: 'см' },
      { kind: 'counter_kg',  x: 3,  y: 44, w: 25, h: 23, z: 1,
        label: 'Килограммов сбросили',  unit: 'кг' },
      { kind: 'counter_fat', x: 3,  y: 68, w: 25, h: 22, z: 1,
        label: 'Жира сожгли',           unit: 'кг' },
      { kind: 'carousel',    x: 30, y: 11, w: 69, h: 80, z: 0 },
      { kind: 'mission',     x: 20, y: 92, w: 60, h: 5,  z: 2,
        text: 'Вместе к лучшей версии себя', font: 'Manrope', size: 1.6, weight: 600, color: '#263CD9', align: 'center' },
      { kind: 'datetime',    x: 81, y: 92, w: 18, h: 5,  z: 2,
        font: 'Manrope', size: 1.3, weight: 600, color: '#000000', align: 'right' },
    ],
  };
}

// ── Screen layout v2 ──────────────────────────────────────────────────────────
// синхронизировать с kviz/client/src/lib/tvScreenLayout.ts

function validateScreenLayoutV2(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'layout должен быть объектом';
  const l = raw as Record<string, unknown>;
  if (l.v !== 2) return 'layout.v должно быть 2';
  if (!Array.isArray(l.elements)) return 'elements должен быть массивом';
  if ((l.elements as unknown[]).length > 50) return 'Максимум 50 элементов';
  const VALID_TYPES  = new Set(['text','value','mission','datetime','image','shape','carousel']);
  const VALID_BINDS  = new Set(['value_cm','value_kg','value_fat']);
  const VALID_ASSETS = new Set(['logo','icon_cm','icon_kg','icon_fat']);
  const VALID_SHAPES = new Set(['rect','rounded','circle','ellipse','pill']);
  const VALID_FITS   = new Set(['contain','cover','stretch']);
  const TEXT_TYPES   = new Set(['text','value','mission','datetime']);
  const ids = new Set<string>();
  for (const item of l.elements as unknown[]) {
    if (typeof item !== 'object' || item === null) return 'Элемент не объект';
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return 'id элемента должен быть UUID';
    if (ids.has(e.id)) return `Дублирующийся id: ${e.id}`;
    ids.add(e.id);
    if (!VALID_TYPES.has(String(e.type))) return `Неверный type: ${e.type}`;
    for (const [k, min, max] of [['x',0,100],['y',0,100],['w',1,100],['h',1,100]] as const) {
      if (typeof e[k] !== 'number' || (e[k] as number) < min || (e[k] as number) > max) return `${k}: число ${min}–${max}`;
    }
    if (typeof e.z !== 'number' || !Number.isInteger(e.z) || e.z < 0 || e.z > 500) return 'z: целое 0–500';
    if ('rotate'  in e && e.rotate  !== undefined && (typeof e.rotate  !== 'number' || (e.rotate  as number) < -180 || (e.rotate  as number) > 180)) return 'rotate: -180..180';
    if ('visible' in e && e.visible !== undefined && typeof e.visible !== 'boolean') return 'visible: boolean';
    if ('locked'  in e && e.locked  !== undefined && typeof e.locked  !== 'boolean') return 'locked: boolean';
    if (TEXT_TYPES.has(String(e.type))) {
      if ('font'    in e && e.font    !== undefined && !VALID_FONTS.has(e.font as string)) return `Неверный шрифт: ${e.font}`;
      if ('size'    in e && e.size    !== undefined && (typeof e.size !== 'number'    || (e.size as number) < 1   || (e.size as number) > 60)) return 'size: 1–60';
      if ('weight'  in e && e.weight  !== undefined && e.weight !== 400 && e.weight !== 600 && e.weight !== 800) return 'weight: 400, 600 или 800';
      if ('color'   in e && e.color   !== undefined && (typeof e.color !== 'string'   || !HEX_RE.test(e.color as string))) return 'color: формат #RRGGBB';
      if ('align'   in e && e.align   !== undefined && e.align !== 'left' && e.align !== 'center' && e.align !== 'right') return 'align: left, center или right';
      if ('opacity' in e && e.opacity !== undefined && (typeof e.opacity !== 'number' || (e.opacity as number) < 0 || (e.opacity as number) > 1)) return 'opacity: 0–1';
      if ('scaleX'  in e && e.scaleX  !== undefined && (typeof e.scaleX  !== 'number' || (e.scaleX as number)  < 0.5 || (e.scaleX as number)  > 2)) return 'scaleX: 0.5–2';
      if ('scaleY'  in e && e.scaleY  !== undefined && (typeof e.scaleY  !== 'number' || (e.scaleY as number)  < 0.5 || (e.scaleY as number)  > 2)) return 'scaleY: 0.5–2';
    }
    if (e.type === 'text') {
      if (typeof e.text !== 'string' || (e.text as string).length > 500) return 'text: строка до 500 символов';
    }
    if (e.type === 'value') {
      if (!VALID_BINDS.has(String(e.bind))) return 'bind: value_cm, value_kg или value_fat';
    }
    if (e.type === 'image') {
      const hasAsset = 'asset' in e && e.asset !== undefined;
      const hasPath  = 'path'  in e && e.path  !== undefined;
      if (!hasAsset && !hasPath) return 'image: нужен asset или path';
      if (hasAsset && hasPath)   return 'image: только один из asset или path';
      if (hasAsset && !VALID_ASSETS.has(e.asset as string)) return 'asset: logo, icon_cm, icon_kg или icon_fat';
      if (hasPath  && (typeof e.path !== 'string' || !/^screen\/[0-9a-f-]+\.(jpg|png)$/.test(e.path as string))) return 'path: screen/<uuid>.jpg или screen/<uuid>.png';
      if ('fit' in e && e.fit !== undefined && !VALID_FITS.has(e.fit as string)) return 'fit: contain, cover или stretch';
    }
    if (e.type === 'shape') {
      if (!VALID_SHAPES.has(String(e.shape))) return 'shape: rect, rounded, circle, ellipse или pill';
      if ('radius' in e && e.radius !== undefined && (typeof e.radius !== 'number' || (e.radius as number) < 0 || (e.radius as number) > 10)) return 'shape.radius: 0–10';
      if ('fill' in e && e.fill !== undefined) {
        const f = e.fill as Record<string, unknown>;
        if (f.type !== 'solid' && f.type !== 'gradient') return 'fill.type: solid или gradient';
        if (f.type === 'solid') {
          if (!HEX_RE.test(String(f.color || ''))) return 'fill.color: #RRGGBB';
          if (typeof f.opacity !== 'number' || (f.opacity as number) < 0 || (f.opacity as number) > 1) return 'fill.opacity: 0–1';
        }
        if (f.type === 'gradient') {
          if (!HEX_RE.test(String(f.from || '')) || !HEX_RE.test(String(f.to || ''))) return 'fill.from/to: #RRGGBB';
          if (typeof f.angle !== 'number' || (f.angle as number) < 0 || (f.angle as number) > 360) return 'fill.angle: 0–360';
          if (typeof f.opacity !== 'number' || (f.opacity as number) < 0 || (f.opacity as number) > 1) return 'fill.opacity: 0–1';
        }
      }
      if ('border' in e && e.border !== undefined) {
        const b = e.border as Record<string, unknown>;
        if (typeof b.width !== 'number' || (b.width as number) < 0 || (b.width as number) > 1) return 'border.width: 0–1';
        if (!HEX_RE.test(String(b.color || ''))) return 'border.color: #RRGGBB';
        if (typeof b.opacity !== 'number' || (b.opacity as number) < 0 || (b.opacity as number) > 1) return 'border.opacity: 0–1';
      }
    }
    if (e.type === 'carousel') {
      if ('radius' in e && e.radius !== undefined && (typeof e.radius !== 'number' || (e.radius as number) < 0 || (e.radius as number) > 10)) return 'carousel.radius: 0–10';
    }
  }
  return null;
}

function migrateCounterServer(
  el: Record<string, unknown>, iconAsset: string, bind: string, unit: string, label: string,
): Record<string, unknown>[] {
  const x = el.x as number, y = el.y as number, w = el.w as number, h = el.h as number, z = Number(el.z ?? 1);
  const iW = Math.round(w * 0.33 * 2) / 2;
  const dX = Math.round((x + w * 0.35) * 2) / 2;
  const dW = Math.round(w * 0.65 * 2) / 2;
  const nH = Math.round(h * 0.52 * 2) / 2;
  const uH = Math.round(h * 0.18 * 2) / 2;
  const lH = h - nH - uH;
  return [
    { id: randomUUID(), type: 'image', x, y, w: iW, h, z, visible: true, locked: false, asset: iconAsset, fit: 'contain' },
    { id: randomUUID(), type: 'value', x: dX, y, w: dW, h: nH, z, visible: true, locked: false, bind, font: 'Barlow Condensed', size: Math.round(h * 0.47 * 10) / 10, weight: 800, color: '#1e293b', align: 'right' },
    { id: randomUUID(), type: 'text',  x: dX, y: y + nH, w: dW, h: uH, z, visible: true, locked: false, text: unit, font: 'Manrope', size: Math.round(h * 0.14 * 10) / 10, weight: 600, color: '#64748b', align: 'right' },
    { id: randomUUID(), type: 'text',  x: dX, y: y + nH + uH, w: dW, h: lH, z, visible: true, locked: false, text: label, font: 'Manrope', size: Math.round(h * 0.1 * 10) / 10, weight: 400, color: '#475569', align: 'right' },
  ];
}

interface V1Seed { label_cm?: string; label_kg?: string; label_fat?: string }

function migrateToV2Server(v1: { version: number; elements: Record<string, unknown>[] }, seed?: V1Seed): object {
  const elements: Record<string, unknown>[] = [];
  for (const el of v1.elements) {
    const z = Number(el.z ?? 0);
    if (el.kind === 'logo') {
      elements.push({ id: randomUUID(), type: 'image',   x: el.x, y: el.y, w: el.w, h: el.h, z: z || 2, visible: true, locked: false, asset: 'logo', fit: 'contain' });
    } else if (el.kind === 'panel') {
      elements.push({ id: randomUUID(), type: 'shape',   x: el.x, y: el.y, w: el.w, h: el.h, z: 0, visible: true, locked: false, shape: 'rounded', radius: 2, fill: { type: 'solid', color: '#ffffff', opacity: 0.58 }, border: { width: 0.15, color: '#ffffff', opacity: 0.85 }, shadow: true, blur: true });
    } else if (el.kind === 'intro') {
      elements.push({ id: randomUUID(), type: 'text',    x: el.x, y: el.y, w: el.w, h: el.h, z: z || 1, visible: true, locked: false, text: el.text ?? 'На сегодня мы', font: el.font ?? 'Manrope', size: el.size ?? 1.1, weight: el.weight ?? 600, color: el.color ?? '#263CD9', align: el.align ?? 'center' });
    } else if (el.kind === 'counter_cm') {
      elements.push(...migrateCounterServer(el, 'icon_cm',  'value_cm',  String(el.unit || 'см'), seed?.label_cm  || String(el.label || 'Сантиметров убрали')));
    } else if (el.kind === 'counter_kg') {
      elements.push(...migrateCounterServer(el, 'icon_kg',  'value_kg',  String(el.unit || 'кг'), seed?.label_kg  || String(el.label || 'Килограммов сбросили')));
    } else if (el.kind === 'counter_fat') {
      elements.push(...migrateCounterServer(el, 'icon_fat', 'value_fat', String(el.unit || 'кг'), seed?.label_fat || String(el.label || 'Жира сожгли')));
    } else if (el.kind === 'carousel') {
      elements.push({ id: randomUUID(), type: 'carousel', x: el.x, y: el.y, w: el.w, h: el.h, z: 0, visible: true, locked: false, frame: false });
    } else if (el.kind === 'mission') {
      // text lives in studio_settings in v2 — not stored in the element
      elements.push({ id: randomUUID(), type: 'mission',  x: el.x, y: el.y, w: el.w, h: el.h, z: z || 2, visible: true, locked: false, font: el.font ?? 'Manrope', size: el.size ?? 1.6, weight: el.weight ?? 600, color: el.color ?? '#263CD9', align: el.align ?? 'center' });
    } else if (el.kind === 'datetime') {
      elements.push({ id: randomUUID(), type: 'datetime', x: el.x, y: el.y, w: el.w, h: el.h, z: z || 2, visible: true, locked: false, font: el.font ?? 'Manrope', size: el.size ?? 1.3, weight: el.weight ?? 600, color: el.color ?? '#000000', align: el.align ?? 'right' });
    }
  }
  return { v: 2, elements };
}

function defaultScreenLayoutV2Server(seed?: V1Seed): object {
  const lCm  = seed?.label_cm  || 'Сантиметров убрали';
  const lKg  = seed?.label_kg  || 'Килограммов сбросили';
  const lFat = seed?.label_fat || 'Жира сожгли';
  return {
    v: 2,
    elements: [
      { id: randomUUID(), type: 'image',    x: 36,   y: 1,    w: 28,  h: 9,    z: 2, visible: true, locked: false, asset: 'logo',    fit: 'contain' },
      { id: randomUUID(), type: 'shape',    x: 2,    y: 11,   w: 27,  h: 80,   z: 0, visible: true, locked: false, shape: 'rounded', radius: 2, fill: { type: 'solid', color: '#ffffff', opacity: 0.58 }, border: { width: 0.15, color: '#ffffff', opacity: 0.85 }, shadow: true, blur: true },
      { id: randomUUID(), type: 'text',     x: 3,    y: 12,   w: 25,  h: 7,    z: 1, visible: true, locked: false, text: 'На сегодня мы', font: 'Manrope', size: 1.1, weight: 600, color: '#263CD9', align: 'center' },
      { id: randomUUID(), type: 'image',    x: 3,    y: 20,   w: 8,   h: 23,   z: 1, visible: true, locked: false, asset: 'icon_cm',  fit: 'contain' },
      { id: randomUUID(), type: 'value',    x: 11.5, y: 20,   w: 16.5,h: 12,   z: 1, visible: true, locked: false, bind: 'value_cm',  font: 'Barlow Condensed', size: 11, weight: 800, color: '#1e293b', align: 'right' },
      { id: randomUUID(), type: 'text',     x: 11.5, y: 32,   w: 16.5,h: 4,    z: 1, visible: true, locked: false, text: 'см', font: 'Manrope', size: 3.2, weight: 600, color: '#64748b', align: 'right' },
      { id: randomUUID(), type: 'text',     x: 11.5, y: 36,   w: 16.5,h: 7,    z: 1, visible: true, locked: false, text: lCm, font: 'Manrope', size: 2.3, weight: 400, color: '#475569', align: 'right' },
      { id: randomUUID(), type: 'image',    x: 3,    y: 44,   w: 8,   h: 23,   z: 1, visible: true, locked: false, asset: 'icon_kg',  fit: 'contain' },
      { id: randomUUID(), type: 'value',    x: 11.5, y: 44,   w: 16.5,h: 12,   z: 1, visible: true, locked: false, bind: 'value_kg',  font: 'Barlow Condensed', size: 11, weight: 800, color: '#1e293b', align: 'right' },
      { id: randomUUID(), type: 'text',     x: 11.5, y: 56,   w: 16.5,h: 4,    z: 1, visible: true, locked: false, text: 'кг', font: 'Manrope', size: 3.2, weight: 600, color: '#64748b', align: 'right' },
      { id: randomUUID(), type: 'text',     x: 11.5, y: 60,   w: 16.5,h: 7,    z: 1, visible: true, locked: false, text: lKg, font: 'Manrope', size: 2.3, weight: 400, color: '#475569', align: 'right' },
      { id: randomUUID(), type: 'image',    x: 3,    y: 68,   w: 8,   h: 22,   z: 1, visible: true, locked: false, asset: 'icon_fat', fit: 'contain' },
      { id: randomUUID(), type: 'value',    x: 11.5, y: 68,   w: 16.5,h: 11.5, z: 1, visible: true, locked: false, bind: 'value_fat', font: 'Barlow Condensed', size: 10.5, weight: 800, color: '#1e293b', align: 'right' },
      { id: randomUUID(), type: 'text',     x: 11.5, y: 79.5, w: 16.5,h: 3.5,  z: 1, visible: true, locked: false, text: 'кг', font: 'Manrope', size: 3.2, weight: 600, color: '#64748b', align: 'right' },
      { id: randomUUID(), type: 'text',     x: 11.5, y: 83,   w: 16.5,h: 7,    z: 1, visible: true, locked: false, text: lFat, font: 'Manrope', size: 2.3, weight: 400, color: '#475569', align: 'right' },
      { id: randomUUID(), type: 'carousel', x: 30,   y: 11,   w: 69,  h: 80,   z: 0, visible: true, locked: false, frame: false },
      { id: randomUUID(), type: 'mission',  x: 20,   y: 92,   w: 60,  h: 5,    z: 2, visible: true, locked: false, font: 'Manrope', size: 1.6, weight: 600, color: '#263CD9', align: 'center' },
      { id: randomUUID(), type: 'datetime', x: 81,   y: 92,   w: 18,  h: 5,    z: 2, visible: true, locked: false, font: 'Manrope', size: 1.3, weight: 600, color: '#000000', align: 'right' },
    ],
  };
}

function extractScreenPaths(layout: Record<string, unknown> | null): Set<string> {
  const paths = new Set<string>();
  if (!layout || !Array.isArray(layout.elements)) return paths;
  for (const el of layout.elements as Record<string, unknown>[]) {
    if (el.type === 'image' && typeof el.path === 'string' && (el.path as string).startsWith('screen/')) paths.add(el.path as string);
  }
  return paths;
}

// JPEG: FF D8 FF | PNG: 89 50 4E 47
function validImg(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  return (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) ||
         (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47);
}

// cacheImmutable=true for public (UUID filenames never reuse a URL)
// cacheImmutable=false for admin preview (must always show latest)
async function proxyMedia(storagePath: string, res: Response, cacheImmutable = false): Promise<void> {
  if (!storagePath || !/^[a-zA-Z0-9/_.-]+$/.test(storagePath)) { res.status(400).end(); return; }
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) { res.status(404).end(); return; }
    const buf = Buffer.from(await data.arrayBuffer());
    res.setHeader('Content-Type', data.type || (storagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'));
    res.setHeader('Cache-Control', cacheImmutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.send(buf);
  } catch { res.status(500).end(); }
}

// Fetch tv_results rows for a list of UUIDs, returns a Map<id, row>
async function fetchResultsByIds(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  const { data } = await supabase.from('tv_results').select('id,title,before_path,after_path').in('id', ids);
  const map = new Map<string, Record<string, unknown>>();
  for (const r of (data ?? [])) map.set(r.id as string, r as Record<string, unknown>);
  return map;
}

export function buildTvRouter(): Router {
  const r = Router();

  // ── Public endpoints (key-protected) ──────────────────────────────────────

  r.get('/api/tv/data', async (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    try {
      const [settingsRes, countersRes, slidesRes, missionRes] = await Promise.all([
        supabase.from('tv_settings').select('screen_layout,main_label_cm,main_label_kg,main_label_fat').eq('id', 1).maybeSingle(),
        supabase.from('studio_results').select('cm_lost,kg_lost,fat_kg_lost'),
        supabase.from('tv_slides').select('*').order('position'),
        supabase.from('studio_settings').select('value').eq('key', 'mission').maybeSingle(),
      ]);
      const totals = ((countersRes.data ?? []) as Record<string, unknown>[]).reduce((a: Record<string, number>, row) => ({
        cm_lost:     a.cm_lost     + Number(row.cm_lost     || 0),
        kg_lost:     a.kg_lost     + Number(row.kg_lost     || 0),
        fat_kg_lost: a.fat_kg_lost + Number(row.fat_kg_lost || 0),
      }), { cm_lost: 0, kg_lost: 0, fat_kg_lost: 0 });

      const settings = settingsRes.data as Record<string, unknown> | null;
      const mission  = String((missionRes.data as Record<string, unknown> | null)?.value || '');
      const seed: V1Seed = {
        label_cm:  String(settings?.main_label_cm  || ''),
        label_kg:  String(settings?.main_label_kg  || ''),
        label_fat: String(settings?.main_label_fat || ''),
      };

      // Resolve screen_layout: migrate v1→v2 or generate v2 default
      const raw = settings?.screen_layout as Record<string, unknown> | null;
      let screenLayout: object;
      if (!raw) {
        screenLayout = defaultScreenLayoutV2Server(seed);
      } else if (raw.version === 1) {
        screenLayout = migrateToV2Server(raw as { version: number; elements: Record<string, unknown>[] }, seed);
      } else {
        screenLayout = raw; // already v2
      }

      const slides = (slidesRes.data ?? []) as Record<string, unknown>[];
      const resultIds = [...new Set(
        slides.flatMap(s => [s.result_a, s.result_b].filter(Boolean) as string[])
      )];
      const resultsMap = await fetchResultsByIds(resultIds);

      const enriched = slides.map(s => ({
        ...s,
        result_a: s.result_a ? (resultsMap.get(s.result_a as string) ?? null) : null,
        result_b: s.result_b ? (resultsMap.get(s.result_b as string) ?? null) : null,
      }));

      res.setHeader('Cache-Control', 'no-store');
      res.json({
        screen_layout: screenLayout,
        counters: totals,
        mission,
        slides: enriched,
        serverTime: new Date().toISOString(),
        version: '4',
      });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.get('/api/tv/stream', (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  });

  // Public media proxy: immutable cache — URL always changes on upload
  r.get('/api/tv/media', async (req, res) => {
    if (!checkKey(req)) { res.status(404).end(); return; }
    await proxyMedia(String(req.query.path || ''), res, true);
  });

  // Admin media proxy: no-cache — always show latest for settings preview
  r.get('/kviz/api/tv/media', async (req, res) => {
    if (!getSession(req)) { res.status(401).end(); return; }
    await proxyMedia(String(req.query.path || ''), res, false);
  });

  // ── Admin settings ─────────────────────────────────────────────────────────

  r.get('/kviz/api/tv/settings', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data, error } = await supabase.from('tv_settings').select('*').eq('id', 1).maybeSingle();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? {});
  });

  r.put('/kviz/api/tv/settings', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const upd: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    // main_label_* и intro_text перенесены в screen_layout (screen editor)
    if ('main_enabled'   in b) upd.main_enabled  = b.main_enabled === true || b.main_enabled === 'true';
    if ('main_seconds'   in b) upd.main_seconds  = Math.max(1, Math.min(300, Number(b.main_seconds) || 5));
    if ('results_enabled' in b) upd.results_enabled = b.results_enabled === true || b.results_enabled === 'true';
    if ('results_seconds' in b) upd.results_seconds = Math.max(1, Math.min(300, Number(b.results_seconds) || 5));
    if (!Object.keys(upd).some(k => !['id', 'updated_at'].includes(k))) {
      res.status(400).json({ error: 'Нет допустимых полей для обновления. Текст экрана редактируется в редакторе экрана.' }); return;
    }
    const { data, error } = await supabase.from('tv_settings').upsert(upd, { onConflict: 'id' }).select('*').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    tvNotify();
    res.json(data);
  });

  // ── Screen layout ──────────────────────────────────────────────────────────

  r.get('/kviz/api/tv/screen', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const [settingsRes, missionRes] = await Promise.all([
      supabase.from('tv_settings').select('screen_layout,main_label_cm,main_label_kg,main_label_fat').eq('id', 1).maybeSingle(),
      supabase.from('studio_settings').select('value').eq('key', 'mission').maybeSingle(),
    ]);
    const settings = settingsRes.data as Record<string, unknown> | null;
    const mission  = String((missionRes.data as Record<string, unknown> | null)?.value || '');
    const seed: V1Seed = {
      label_cm:  String(settings?.main_label_cm  || ''),
      label_kg:  String(settings?.main_label_kg  || ''),
      label_fat: String(settings?.main_label_fat || ''),
    };
    const raw = settings?.screen_layout as Record<string, unknown> | null;
    let layout: object;
    if (!raw) {
      layout = defaultScreenLayoutV2Server(seed);
    } else if (raw.version === 1) {
      layout = migrateToV2Server(raw as { version: number; elements: Record<string, unknown>[] }, seed);
    } else {
      layout = raw;
    }
    res.json({ layout, mission });
  });

  r.put('/kviz/api/tv/screen', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const err = validateScreenLayoutV2(b.layout);
    if (err) { res.status(400).json({ error: err }); return; }

    // Get old layout to find screen/* paths that might be removed
    const { data: cur } = await supabase.from('tv_settings').select('screen_layout').eq('id', 1).maybeSingle();
    const oldPaths = extractScreenPaths((cur as Record<string, unknown> | null)?.screen_layout as Record<string, unknown> | null);
    const newPaths = extractScreenPaths(b.layout as Record<string, unknown>);
    const toRemove = [...oldPaths].filter(p => !newPaths.has(p));

    const { data, error } = await supabase.from('tv_settings')
      .upsert({ id: 1, screen_layout: b.layout, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('screen_layout').single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    if (typeof b.mission === 'string') {
      await supabase.from('studio_settings').upsert({ key: 'mission', value: b.mission }, { onConflict: 'key' });
    }
    if (toRemove.length) supabase.storage.from(BUCKET).remove(toRemove).catch(e => console.error('tv screen remove old imgs:', e));
    tvNotify();
    res.json({ layout: (data as Record<string, unknown>).screen_layout, mission: b.mission ?? '' });
  });

  r.post('/kviz/api/tv/screen/image', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
    const buf = Buffer.from(b.content_base64, 'base64');
    if (buf.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Файл не должен превышать 2 МБ' }); return; }
    if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const sp = `screen/${randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
    if (upErr) { console.error('tv screen img upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
    res.json({ path: sp });
  });

  // ── Admin tv_results CRUD ──────────────────────────────────────────────────

  r.get('/kviz/api/tv/results', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data, error } = await supabase.from('tv_results').select('*').order('position');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  });

  r.post('/kviz/api/tv/results', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const title = String(b.title || '').trim();
    if (!title) { res.status(400).json({ error: 'Название обязательно' }); return; }
    const { data: last } = await supabase.from('tv_results').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase.from('tv_results')
      .insert({ title, before_path: '', after_path: '', position: (Number((last as Record<string, number>)?.position ?? 0) + 1) })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.put('/kviz/api/tv/results/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const upd: Record<string, unknown> = {};
    if ('title' in b) upd.title = String(b.title || '').trim();
    if (!Object.keys(upd).length) { res.status(400).json({ error: 'Нет данных' }); return; }
    const { data, error } = await supabase.from('tv_results').update(upd).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  });

  r.delete('/kviz/api/tv/results/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    // Check usage in slides before deleting
    const { data: usedSlide } = await supabase.from('tv_slides')
      .select('position')
      .or(`result_a.eq.${req.params.id},result_b.eq.${req.params.id}`)
      .order('position').limit(1).maybeSingle();
    if (usedSlide) {
      res.status(409).json({ error: `Карточка используется в слайде №${(usedSlide as Record<string, number>).position}. Сначала удалите или измените слайд` });
      return;
    }
    const { data: row } = await supabase.from('tv_results').select('before_path,after_path').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase.from('tv_results').delete().eq('id', req.params.id);
    if (error) {
      if (error.code === '23503') {
        res.status(409).json({ error: 'Карточка используется в слайде. Сначала удалите или измените слайд' });
      } else {
        console.error('tv results delete:', error);
        res.status(500).json({ error: 'Ошибка удаления' });
      }
      return;
    }
    const paths = [(row as Record<string, string>)?.before_path, (row as Record<string, string>)?.after_path].filter(Boolean) as string[];
    if (paths.length) supabase.storage.from(BUCKET).remove(paths).catch(e => console.error('tv result delete paths:', e));
    tvNotify();
    res.json({ ok: true });
  });

  r.post('/kviz/api/tv/results/:id/before-upload', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    await uploadResultImg(req, res, 'before');
  });

  r.post('/kviz/api/tv/results/:id/after-upload', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    await uploadResultImg(req, res, 'after');
  });

  // ── Admin tv_slides CRUD ───────────────────────────────────────────────────

  r.get('/kviz/api/tv/slides', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data, error } = await supabase.from('tv_slides').select('*').order('position');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data ?? []);
  });

  r.post('/kviz/api/tv/slides', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const kind = String(b.kind || '');
    if (!['result1', 'result2', 'promo', 'usp', 'free'].includes(kind)) {
      res.status(400).json({ error: 'Неверный тип слайда' }); return;
    }

    const { count } = await supabase.from('tv_slides').select('*', { count: 'exact', head: true });
    if ((count ?? 0) >= 20) { res.status(400).json({ error: 'Можно добавить не больше 20 слайдов' }); return; }

    if (kind === 'free') {
      const layout = b.layout ?? { frame: true, elements: [] };
      if (b.layout) {
        const validErr = validateLayout(layout);
        if (validErr) { res.status(400).json({ error: validErr }); return; }
      }
      const dur = Math.max(2, Math.min(300, Number(b.duration_sec) || 10));
      const { data: last } = await supabase.from('tv_slides').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
      const position = (Number((last as Record<string, number>)?.position ?? 0) + 1);
      const { data, error } = await supabase.from('tv_slides').insert({
        kind: 'free', position, duration_sec: dur, enabled: b.enabled !== false,
        result_a: null, result_b: null, image_path: null, layout,
      }).select().single();
      if (error) { console.error('tv free slide insert:', error); res.status(500).json({ error: 'Ошибка создания слайда' }); return; }
      tvNotify();
      res.json(data);
      return;
    }

    const result_a = b.result_a ? String(b.result_a) : null;
    const result_b = b.result_b ? String(b.result_b) : null;
    if (kind === 'result1' && !result_a) { res.status(400).json({ error: 'Выберите карточку клиента' }); return; }
    if (kind === 'result2') {
      if (!result_a || !result_b) { res.status(400).json({ error: 'Выберите двух клиентов' }); return; }
      if (result_a === result_b) { res.status(400).json({ error: 'Выберите двух разных клиентов' }); return; }
    }

    let image_path: string | null = null;
    if (kind === 'promo' || kind === 'usp') {
      if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'Загрузите изображение' }); return; }
      const buf = Buffer.from(b.content_base64, 'base64');
      if (buf.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Файл не должен превышать 2 МБ' }); return; }
      if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
      const ext = buf[0] === 0x89 ? 'png' : 'jpg';
      const sp = `slides/${randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
      if (upErr) { console.error('tv slide upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
      image_path = sp;
    }

    const dur = Math.max(2, Math.min(300, Number(b.duration_sec) || 10));
    const { data: last } = await supabase.from('tv_slides').select('position').order('position', { ascending: false }).limit(1).maybeSingle();
    const position = (Number((last as Record<string, number>)?.position ?? 0) + 1);

    const { data, error } = await supabase.from('tv_slides').insert({
      kind, position, duration_sec: dur,
      enabled: b.enabled !== false,
      result_a: (kind === 'result1' || kind === 'result2') ? result_a : null,
      result_b: kind === 'result2' ? result_b : null,
      image_path,
    }).select().single();
    if (error) { console.error('tv slide insert:', error); res.status(500).json({ error: 'Ошибка создания слайда' }); return; }
    tvNotify();
    res.json(data);
  });

  r.post('/kviz/api/tv/slides/:id/free-image', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
    const buf = Buffer.from(b.content_base64, 'base64');
    if (buf.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Файл не должен превышать 2 МБ' }); return; }
    if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const sp = `free/${randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
    if (upErr) { console.error('tv free img upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
    res.json({ path: sp });
  });

  r.patch('/kviz/api/tv/slides/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    const upd: Record<string, unknown> = {};

    // Free slide layout update
    if ('layout' in b) {
      const { data: curRow } = await supabase.from('tv_slides').select('kind,layout').eq('id', req.params.id).maybeSingle();
      if ((curRow as Record<string, unknown> | null)?.kind !== 'free') {
        res.status(400).json({ error: 'layout можно изменить только у слайда типа free' }); return;
      }
      const validErr = validateLayout(b.layout);
      if (validErr) { res.status(400).json({ error: validErr }); return; }
      type LayoutEl = { type: string; path?: string };
      type LayoutObj = { elements?: LayoutEl[] };
      const oldLayout = (curRow as Record<string, unknown> | null)?.layout as LayoutObj | null;
      const oldPaths = new Set((oldLayout?.elements ?? []).filter(e => e.type === 'image' && e.path).map(e => e.path as string));
      const newPaths = new Set(((b.layout as LayoutObj).elements ?? []).filter(e => e.type === 'image' && e.path).map(e => (e as LayoutEl).path as string));
      const toRemove = [...oldPaths].filter(p => !newPaths.has(p));
      const { data, error } = await supabase.from('tv_slides').update({ layout: b.layout }).eq('id', req.params.id).select().single();
      if (error) { console.error('tv free layout update:', error); res.status(500).json({ error: 'Ошибка сохранения' }); return; }
      if (toRemove.length) supabase.storage.from(BUCKET).remove(toRemove).catch(e => console.error('tv free slide remove old imgs:', e));
      tvNotify();
      res.json(data);
      return;
    }

    if ('duration_sec' in b) upd.duration_sec = Math.max(2, Math.min(300, Number(b.duration_sec) || 10));
    if ('enabled'      in b) upd.enabled      = b.enabled === true || b.enabled === 'true';
    if ('result_a'     in b) upd.result_a     = b.result_a || null;
    if ('result_b'     in b) upd.result_b     = b.result_b || null;

    // Position swap: exchange with the slide currently at the target position
    if ('position' in b) {
      const newPos = Number(b.position);
      const [curRes, targetRes] = await Promise.all([
        supabase.from('tv_slides').select('position').eq('id', req.params.id).maybeSingle(),
        supabase.from('tv_slides').select('id,position').eq('position', newPos).maybeSingle(),
      ]);
      const curPos = (curRes.data as Record<string, number> | null)?.position;
      const target = targetRes.data as Record<string, unknown> | null;
      if (curPos != null && target && target.id !== req.params.id) {
        // Use high temp position to avoid unique-constraint conflict during swap
        await supabase.from('tv_slides').update({ position: 9999 }).eq('id', req.params.id);
        await supabase.from('tv_slides').update({ position: curPos }).eq('id', target.id as string);
        await supabase.from('tv_slides').update({ position: newPos }).eq('id', req.params.id);
      }
      tvNotify();
      const { data: updated } = await supabase.from('tv_slides').select('*').eq('id', req.params.id).single();
      res.json(updated ?? {});
      return;
    }

    if (!Object.keys(upd).length) { res.status(400).json({ error: 'Нет данных' }); return; }
    const { data, error } = await supabase.from('tv_slides').update(upd).eq('id', req.params.id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    tvNotify();
    res.json(data);
  });

  r.post('/kviz/api/tv/slides/:id/image', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const b = req.body as Record<string, unknown>;
    if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
    const buf = Buffer.from(b.content_base64, 'base64');
    if (buf.length > 2 * 1024 * 1024) { res.status(400).json({ error: 'Файл не должен превышать 2 МБ' }); return; }
    if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
    const ext = buf[0] === 0x89 ? 'png' : 'jpg';
    const { data: oldRow } = await supabase.from('tv_slides').select('image_path').eq('id', req.params.id).maybeSingle();
    const sp = `slides/${randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
    if (upErr) { console.error('tv slide img upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
    const { data, error } = await supabase.from('tv_slides').update({ image_path: sp }).eq('id', req.params.id).select().single();
    if (error) { console.error('tv slide img update:', error); res.status(500).json({ error: 'Ошибка обновления слайда' }); return; }
    const oldPath = (oldRow as Record<string, string> | null)?.image_path;
    if (oldPath) supabase.storage.from(BUCKET).remove([oldPath]).catch(e => console.error('tv slide remove old:', e));
    tvNotify();
    res.json(data);
  });

  r.delete('/kviz/api/tv/slides/:id', async (req, res) => {
    if (!isAdmin(req)) { res.status(403).json({ error: 'Только для администратора' }); return; }
    const { data: row } = await supabase.from('tv_slides').select('image_path,kind,layout').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase.from('tv_slides').delete().eq('id', req.params.id);
    if (error) { console.error('tv slide delete:', error); res.status(500).json({ error: 'Ошибка удаления слайда' }); return; }
    const r2 = row as Record<string, unknown> | null;
    const pathsToRemove: string[] = [];
    if (r2?.image_path) pathsToRemove.push(r2.image_path as string);
    if (r2?.kind === 'free' && r2?.layout) {
      type LayoutEl = { type: string; path?: string };
      const layout = r2.layout as { elements?: LayoutEl[] };
      for (const el of (layout.elements ?? [])) {
        if (el.type === 'image' && el.path) pathsToRemove.push(el.path);
      }
    }
    if (pathsToRemove.length) supabase.storage.from(BUCKET).remove(pathsToRemove).catch(e => console.error('tv slide delete imgs:', e));
    // Renumber remaining slides 1..n so there are no gaps
    const { data: remaining } = await supabase.from('tv_slides').select('id').order('position');
    if (remaining?.length) {
      await Promise.all((remaining as Record<string, string>[]).map((s, i) =>
        supabase.from('tv_slides').update({ position: i + 1 }).eq('id', s.id)
      ));
    }
    tvNotify();
    res.json({ ok: true });
  });

  return r;
}

async function uploadResultImg(req: Request, res: Response, side: 'before' | 'after'): Promise<void> {
  const b = req.body as Record<string, unknown>;
  if (typeof b.content_base64 !== 'string' || !b.content_base64) { res.status(400).json({ error: 'content_base64 обязателен' }); return; }
  const buf = Buffer.from(b.content_base64, 'base64');
  if (!validImg(buf)) { res.status(400).json({ error: 'Только JPEG и PNG' }); return; }
  const ext = buf[0] === 0x89 ? 'png' : 'jpg';
  const { data: oldRow } = await supabase.from('tv_results').select(`${side}_path`).eq('id', req.params.id).maybeSingle();
  const sp = `results/${randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(sp, buf, { contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}` });
  if (upErr) { console.error('tv result upload:', upErr); res.status(500).json({ error: 'Ошибка загрузки файла' }); return; }
  const { data, error } = await supabase.from('tv_results').update({ [`${side}_path`]: sp }).eq('id', req.params.id).select().single();
  if (error) { console.error('tv result update:', error); res.status(500).json({ error: 'Ошибка обновления записи' }); return; }
  const oldPath = (oldRow as Record<string, unknown>)?.[`${side}_path`] as string | undefined;
  if (oldPath) supabase.storage.from(BUCKET).remove([oldPath]).catch(e => console.error('tv result remove old:', e));
  tvNotify();
  res.json(data);
}
