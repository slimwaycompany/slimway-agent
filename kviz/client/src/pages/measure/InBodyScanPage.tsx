import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MeasureLayout } from './MeasureLayout';
import { parseInBody } from '../../utils/inbody';
import type { InBodyData } from '../../utils/inbody';
import { qrFromImage, extractIBData } from '../../lib/qrFromImage';
import { useQrCamera } from '../../lib/useQrCamera';

const ibBtnSt: React.CSSProperties = {
  padding: '6px 14px', background: '#eff6ff', color: '#2563eb',
  border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
};

type SavedClient = { id: string; name: string } | 'not_found';

export default function InBodyScanPage() {
  const navigate = useNavigate();
  const [pasteVal, setPasteVal] = useState('');
  const [parsed, setParsed] = useState<InBodyData | null>(null);
  const [parseErr, setParseErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [savedClient, setSavedClient] = useState<SavedClient | null>(null);
  const [photoStatus, setPhotoStatus] = useState<null | 'searching' | 'notfound'>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const { cameraActive, cameraErr, videoRef, canvasRef, startCamera, stopCamera } = useQrCamera(tryParse);

  function tryParse(raw: string) {
    const s = extractIBData(raw);
    if (!s) { setParseErr('Не удалось найти данные InBody в строке'); setParsed(null); return; }
    const d = parseInBody(s);
    if (!d) { setParseErr('Строка не распознана как данные InBody'); setParsed(null); return; }
    setParseErr(''); setParsed(d);
  }

  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoStatus('searching'); setParseErr('');
    try {
      const ibData = await qrFromImage(file);
      if (ibData) tryParse(ibData);
      else setPhotoStatus('notfound');
    } catch { setParseErr('Ошибка при обработке фото'); }
    finally {
      if (e.target) e.target.value = '';
      setPhotoStatus(s => s === 'searching' ? null : s);
    }
  }

  async function save() {
    if (!parsed) return;
    setSaving(true); setSaveErr('');
    try {
      const r = await fetch('/kviz/api/inbody/qr', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbody: parsed }),
      });
      const json = await r.json();
      if (!r.ok) { setSaveErr(json.error || 'Ошибка сохранения'); return; }
      // Look up client by phone_digits to navigate after save
      const phone = parsed.phone.replace(/\D/g, '');
      const clients = await fetch(`/kviz/api/measure/clients?q=${encodeURIComponent(phone)}`, { credentials: 'include' })
        .then(r2 => r2.json()).catch(() => []);
      const found = Array.isArray(clients)
        ? clients.find((c: { id?: string; source?: string }) => c.source === 'local' && c.id)
        : null;
      setSavedClient(found ? { id: found.id, name: found.name } : 'not_found');
    } catch (e) { setSaveErr(String(e)); }
    finally { setSaving(false); }
  }

  if (savedClient) {
    return (
      <MeasureLayout>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: '#16a34a' }}>InBody сохранён</div>
          {savedClient === 'not_found' ? (
            <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
              Клиент с этим номером не найден в базе.
            </div>
          ) : (
            <button
              onClick={() => navigate(`/measure/client/${(savedClient as { id: string }).id}`)}
              style={{ marginTop: 16, padding: '10px 24px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Открыть {(savedClient as { id: string; name: string }).name}
            </button>
          )}
          <button
            onClick={() => { setParsed(null); setSavedClient(null); setPasteVal(''); }}
            style={{ display: 'block', margin: '14px auto 0', fontSize: 13, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Сканировать ещё
          </button>
        </div>
      </MeasureLayout>
    );
  }

  return (
    <MeasureLayout>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 16 }}>InBody — сканирование</div>

        {!parsed && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button style={ibBtnSt} onClick={() => captureRef.current?.click()}>📸 Сфотографировать</button>
              <input ref={captureRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhotoFile} />
              <button style={ibBtnSt} onClick={cameraActive ? stopCamera : startCamera}>
                {cameraActive ? '⏹ Стоп' : '📷 Камера'}
              </button>
              <button style={ibBtnSt} onClick={() => galleryRef.current?.click()}>📂 Галерея</button>
              <input ref={galleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhotoFile} />
            </div>

            {photoStatus === 'searching' && (
              <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 10 }}>⏳ Ищу QR на листе…</div>
            )}
            {photoStatus === 'notfound' && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 6 }}>QR не найден. Сфотографируйте ближе.</div>
                <button style={ibBtnSt} onClick={() => { setPhotoStatus(null); captureRef.current?.click(); }}>Ещё раз</button>
              </div>
            )}

            <div style={{ position: 'relative', marginBottom: cameraActive ? 12 : 0, borderRadius: 8, overflow: 'hidden', background: '#000', display: cameraActive ? 'block' : 'none' }}>
              <video ref={videoRef} style={{ width: '100%', display: 'block' }} muted playsInline />
              <div style={{ position: 'absolute', inset: 0, border: '2px solid #02BDB6', borderRadius: 8, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.75)', pointerEvents: 'none' }}>
                Наведите на QR в углу листа
              </div>
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, marginTop: 12 }}>Или вставьте ссылку / строку из QR:</div>
            <input
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e6ea', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box' }}
              placeholder="https://qrcode.inbody.com?IBData=…"
              value={pasteVal}
              onChange={e => { setPasteVal(e.target.value); if (e.target.value.length > 20) tryParse(e.target.value); }}
            />
            {(parseErr || cameraErr) && (
              <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{parseErr || cameraErr}</div>
            )}
          </>
        )}

        {parsed && (
          <>
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#166534' }}>✓ Данные распознаны</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                <span>Дата: {new Date(parsed.measured_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Yekaterinburg' })}</span>
                <span>Вес: {parsed.weight_kg} кг</span>
                <span>Рост: {parsed.height_cm} см</span>
                <span>Жир: {parsed.fat_kg} кг ({parsed.fat_pct}%)</span>
                <span>Мышцы: {parsed.skeletal_muscle_kg} кг</span>
                <span>Телефон: {parsed.phone}</span>
              </div>
              <button
                style={{ marginTop: 8, fontSize: 12, background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0 }}
                onClick={() => { setParsed(null); setPasteVal(''); }}
              >← Заново</button>
            </div>
            {saveErr && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{saveErr}</div>}
            <button
              onClick={save} disabled={saving}
              style={{ width: '100%', padding: '10px 18px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </>
        )}
      </div>
    </MeasureLayout>
  );
}
