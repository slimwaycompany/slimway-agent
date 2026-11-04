import jsQR from 'jsqr';
import { BarcodeDetector as BDPolyfill, prepareZXingModule } from 'barcode-detector/ponyfill';

// Serve WASM from our own host, not jsDelivr CDN
prepareZXingModule({
  overrides: {
    locateFile: (path: string) => {
      if (path.endsWith('.wasm')) return '/kviz/zxing_reader.wasm';
      return path;
    },
  },
});

export function extractIBData(input: string): string | null {
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    const v = u.searchParams.get('IBData');
    if (v) return v;
  } catch {}
  if (/^270-/.test(trimmed)) return trimmed;
  return null;
}

function drawToCanvas(
  src: ImageBitmap | HTMLCanvasElement,
  sx: number, sy: number, sw: number, sh: number,
  targetW: number, targetH: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = targetW; c.height = targetH;
  c.getContext('2d')!.drawImage(src as CanvasImageSource, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return c;
}

function runJsQR(c: HTMLCanvasElement): string | null {
  const ctx = c.getContext('2d')!;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const hit = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
  return hit ? extractIBData(hit.data) : null;
}

function greyContrast(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(2)';
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Crop a region from original bitmap at ~1600px max dimension */
function cropFromBitmap(bmp: ImageBitmap, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const scale = Math.min(1, 1600 / Math.max(sw, sh));
  return drawToCanvas(bmp, sx, sy, sw, sh, Math.round(sw * scale), Math.round(sh * scale));
}

/** Scan an image file for an InBody QR. Returns the extracted IBData string, or null. */
export async function qrFromImage(file: File): Promise<string | null> {
  const DEADLINE = Date.now() + 8000;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    bitmap = await createImageBitmap(file);
  }

  const W = bitmap.width, H = bitmap.height;

  async function tryBarcodeDetector(canvas: HTMLCanvasElement): Promise<string | null> {
    // 1. Native BarcodeDetector (Android Chrome — fast)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const NativeBD = (window as any).BarcodeDetector;
    if (NativeBD) {
      try {
        const det = new NativeBD({ formats: ['qr_code'] });
        const codes: { rawValue: string }[] = await det.detect(canvas);
        for (const code of codes) {
          const v = extractIBData(code.rawValue);
          if (v) return v;
        }
      } catch {}
    }
    if (Date.now() > DEADLINE) return null;
    // 2. Polyfill BarcodeDetector (zxing-wasm — works on iOS Safari)
    try {
      const det = new BDPolyfill({ formats: ['qr_code'] });
      const codes: { rawValue: string }[] = await det.detect(canvas);
      for (const code of codes) {
        const v = extractIBData(code.rawValue);
        if (v) return v;
      }
    } catch {}
    return null;
  }

  function tryScalesJsQR(canvas: HTMLCanvasElement): string | null {
    for (const s of [1, 0.75, 0.5]) {
      if (Date.now() > DEADLINE) return null;
      const sc = s === 1 ? canvas : drawToCanvas(canvas, 0, 0, canvas.width, canvas.height, Math.round(canvas.width * s), Math.round(canvas.height * s));
      const hit = runJsQR(sc) ?? runJsQR(greyContrast(sc));
      if (hit) return hit;
    }
    return null;
  }

  // Build full canvas at ~2000px for fast jsQR pass
  const fullScale = Math.min(1, 2000 / Math.max(W, H));
  const full = drawToCanvas(bitmap, 0, 0, W, H, Math.round(W * fullScale), Math.round(H * fullScale));

  // 1. BarcodeDetector on full image (native + polyfill)
  let hit = await tryBarcodeDetector(full);
  if (hit) { bitmap.close(); return hit; }

  if (Date.now() > DEADLINE) { bitmap.close(); return null; }

  // 2. jsQR on full image at multiple scales
  hit = tryScalesJsQR(full);
  if (hit) { bitmap.close(); return hit; }

  // 3. Crop quarters from ORIGINAL bitmap at ~1600px (right-top first — QR usually there)
  const ow = W * 0.15, oh = H * 0.15;
  const hw = W / 2, hh = H / 2;
  const quads: [number, number, number, number][] = [
    [hw - ow, 0,       hw + ow, hh + oh],  // right-top
    [0,       0,       hw + ow, hh + oh],  // left-top
    [hw - ow, hh - oh, hw + ow, hh + oh],  // right-bottom
    [0,       hh - oh, hw + ow, hh + oh],  // left-bottom
  ];
  for (const [sx, sy, sw, sh] of quads) {
    if (Date.now() > DEADLINE) break;
    const qc = cropFromBitmap(bitmap, sx, sy, sw, sh);
    hit = await tryBarcodeDetector(qc);
    if (hit) { bitmap.close(); return hit; }
    if (Date.now() > DEADLINE) break;
    hit = tryScalesJsQR(qc) ?? runJsQR(greyContrast(qc));
    if (hit) { bitmap.close(); return hit; }
  }

  // 4. Top half from ORIGINAL bitmap
  if (Date.now() <= DEADLINE) {
    const topH = cropFromBitmap(bitmap, 0, 0, W, H / 2);
    hit = tryScalesJsQR(topH);
    if (hit) { bitmap.close(); return hit; }
  }

  bitmap.close();
  return null;
}
