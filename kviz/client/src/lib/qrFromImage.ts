import jsQR from 'jsqr';

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

/** Scan an image file for an InBody QR. Returns the extracted IBData string, or null. */
export async function qrFromImage(file: File): Promise<string | null> {
  const DEADLINE = Date.now() + 4000;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    bitmap = await createImageBitmap(file);
  }

  const W = bitmap.width, H = bitmap.height;
  const scale = Math.min(1, 2000 / Math.max(W, H));
  const full = drawToCanvas(bitmap, 0, 0, W, H, Math.round(W * scale), Math.round(H * scale));
  bitmap.close();

  const fw = full.width, fh = full.height;

  // 1. BarcodeDetector (Android Chrome native — fast and reliable)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BDet = (window as any).BarcodeDetector;
  if (BDet) {
    try {
      const det = new BDet({ formats: ['qr_code'] });
      const codes: { rawValue: string }[] = await det.detect(full);
      for (const code of codes) {
        const v = extractIBData(code.rawValue);
        if (v) return v;
      }
    } catch {}
  }

  if (Date.now() > DEADLINE) return null;

  function tryScales(canvas: HTMLCanvasElement): string | null {
    for (const s of [1, 0.75, 0.5]) {
      if (Date.now() > DEADLINE) return null;
      const sc = s === 1 ? canvas : drawToCanvas(canvas, 0, 0, canvas.width, canvas.height, Math.round(canvas.width * s), Math.round(canvas.height * s));
      const hit = runJsQR(sc) ?? runJsQR(greyContrast(sc));
      if (hit) return hit;
    }
    return null;
  }

  // 2. Full image
  let hit = tryScales(full);
  if (hit) return hit;

  // 3. Quarters with 15% overlap (right-top first — QR usually there on InBody sheet)
  const ow = fw * 0.15, oh = fh * 0.15;
  const hw = fw / 2, hh = fh / 2;
  const quads: [number, number, number, number][] = [
    [hw - ow, 0,       hw + ow, hh + oh],
    [0,       0,       hw + ow, hh + oh],
    [hw - ow, hh - oh, hw + ow, hh + oh],
    [0,       hh - oh, hw + ow, hh + oh],
  ];
  for (const [sx, sy, sw, sh] of quads) {
    if (Date.now() > DEADLINE) break;
    const qc = drawToCanvas(full, sx, sy, sw, sh, Math.round(sw), Math.round(sh));
    hit = tryScales(qc) ?? runJsQR(greyContrast(qc));
    if (hit) return hit;
  }

  // 4. Top half
  if (Date.now() <= DEADLINE) {
    const topH = drawToCanvas(full, 0, 0, fw, fh / 2, fw, Math.round(fh / 2));
    hit = tryScales(topH);
    if (hit) return hit;
  }

  return null;
}
