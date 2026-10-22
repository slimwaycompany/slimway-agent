import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MeasureLayout } from './MeasureLayout';
import { parseLookinBodyCSV } from '../../utils/parseLookinBodyCSV';

type ParsedRows = ReturnType<typeof parseLookinBodyCSV>;

interface Preview {
  total: number; new: number; duplicates: number;
  linked: number; unlinked: number; unlinked_ids: string[];
}
interface ImportResult { added: number; skipped: number; without_client: number }

export default function InBodyImportPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ParsedRows | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setLoading(true); setError(''); setPreview(null); setImportResult(null); setRows(null);
    try {
      const text = await file.text();
      const parsed = parseLookinBodyCSV(text);
      if (!parsed.length) { setError('CSV не распарсился — 0 строк. Проверьте формат файла (UTF-8, LookinBody270).'); setLoading(false); return; }
      setRows(parsed);

      const r = await fetch('/kviz/api/inbody/csv-preview', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsed }),
      });
      const json = await r.json();
      if (!r.ok) { setError(json.error || 'Ошибка предпросмотра'); return; }
      setPreview(json);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function doImport() {
    if (!rows) return;
    setLoading(true); setError('');
    try {
      const r = await fetch('/kviz/api/inbody/csv-import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const json = await r.json();
      if (!r.ok) { setError(json.error || 'Ошибка импорта'); return; }
      setImportResult(json);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <MeasureLayout active="reports">
      <div style={{ padding: '24px 16px', maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <button onClick={() => navigate('/measure/reports')}
            style={{ fontSize: 13, padding: '6px 12px', background: '#f1f5f9', border: '1px solid #e2e6ea', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', color: '#374151' }}>
            ← Отчёты
          </button>
          <span style={{ fontWeight: 700, fontSize: 18, color: '#1a1a2e' }}>Импорт InBody CSV</span>
        </div>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e6ea', borderRadius: 12, padding: '16px 20px', marginBottom: 20, fontSize: 13, color: '#6b7280' }}>
          Загрузите файл <b>inbody270_data.csv</b> из LookinBody Web. Файл не сохраняется — только читается в браузере.
        </div>

        <button
          style={{ padding: '12px 24px', background: '#02BDB6', color: '#fff', border: 'none', borderRadius: 8,
            fontWeight: 600, fontSize: 15, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
            width: '100%', marginBottom: 16, opacity: loading ? 0.7 : 1 }}
          onClick={() => fileRef.current?.click()}
          disabled={loading}
        >
          {loading ? 'Обработка…' : 'Выбрать файл CSV…'}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />

        {error && (
          <div style={{ color: '#ef4444', marginBottom: 16, fontSize: 14, padding: '10px 14px',
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
            {error}
          </div>
        )}

        {preview && !importResult && (
          <div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 12, padding: '20px', marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>Предпросмотр</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                {[
                  ['Всего строк', preview.total, '#374151'],
                  ['Новых', preview.new, '#16a34a'],
                  ['Дублей (уже в базе)', preview.duplicates, '#9ca3af'],
                  ['С привязкой к клиенту', preview.linked, '#2563eb'],
                  ['Без клиента', preview.unlinked, preview.unlinked > 0 ? '#f59e0b' : '#9ca3af'],
                ].map(([label, val, color]) => (
                  <tr key={String(label)}>
                    <td style={{ padding: '5px 0', color: '#6b7280' }}>{label}</td>
                    <td style={{ padding: '5px 0', fontWeight: 700, color: String(color) }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.unlinked_ids.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
                Без клиента (ID): {preview.unlinked_ids.join(', ')}{preview.unlinked_ids.length === 20 ? ' …' : ''}
              </div>
            )}
            {preview.new > 0 ? (
              <button
                onClick={doImport} disabled={loading}
                style={{ marginTop: 18, padding: '12px 24px', background: '#263CD9', color: '#fff',
                  border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 15, cursor: loading ? 'wait' : 'pointer',
                  fontFamily: 'inherit', width: '100%', opacity: loading ? 0.7 : 1 }}
              >
                {loading ? 'Импорт…' : `Импортировать ${preview.new} новых`}
              </button>
            ) : (
              <div style={{ marginTop: 16, padding: '10px', background: '#f0fdf4', border: '1px solid #86efac',
                borderRadius: 8, fontSize: 14, color: '#166534', textAlign: 'center' }}>
                Все строки уже в базе — нечего импортировать
              </div>
            )}
          </div>
        )}

        {importResult && (
          <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '20px' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10, color: '#166534' }}>✓ Импорт завершён</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                {[
                  ['Добавлено', importResult.added, '#16a34a'],
                  ['Пропущено дублей', importResult.skipped, '#9ca3af'],
                  ['Без клиента', importResult.without_client, importResult.without_client > 0 ? '#f59e0b' : '#9ca3af'],
                ].map(([label, val, color]) => (
                  <tr key={String(label)}>
                    <td style={{ padding: '4px 0', color: '#6b7280' }}>{label}</td>
                    <td style={{ padding: '4px 0', fontWeight: 700, color: String(color) }}>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(importResult.without_client > 0) && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
                Непривязанные тесты можно привязать вручную через экран «InBody без клиента».
              </div>
            )}
            <button onClick={() => { setRows(null); setPreview(null); setImportResult(null); }}
              style={{ marginTop: 16, padding: '9px 20px', background: '#f1f5f9', color: '#374151',
                border: '1px solid #e2e6ea', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
              Загрузить ещё
            </button>
          </div>
        )}
      </div>
    </MeasureLayout>
  );
}
