const MAX_SIDE  = 2400;
const MAX_BYTES = 8 * 1024 * 1024;

/** Compress image for upload: resize to ≤2400px long side; PNG→PNG (preserves transparency); JPEG→JPEG q0.9.
 *  Returns base64-encoded result. Throws string error if result > 8 MB. */
export function compressForUpload(file: File): Promise<string> {
  const isPng = file.type === 'image/png';
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width  = Math.round(img.width  * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob(blob => {
        if (!blob) { reject('Ошибка конвертации'); return; }
        if (blob.size > MAX_BYTES) { reject('Файл не должен превышать 8 МБ'); return; }
        const reader = new FileReader();
        reader.onload = e => resolve((e.target!.result as string).split(',')[1]);
        reader.onerror = () => reject('Ошибка чтения файла');
        reader.readAsDataURL(blob);
      }, isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : 0.9);
    };
    img.onerror = () => reject('Ошибка загрузки изображения');
    img.src = URL.createObjectURL(file);
  });
}
