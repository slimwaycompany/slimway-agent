import { useEffect, useRef, useState } from 'react';
import { SCRIPTS, DONT_SAY } from '../config/scripts';
import { Answers } from '../config/qualify';
import ScriptItem from './ScriptItem';

const PANEL_CATS = ['Открытие', 'Возражения', 'Закрытие'];

export default function QuickReplies({ answers, usedScripts, onMark }: {
  answers: Answers; usedScripts: string[]; onMark: (id: string, mergedIds?: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('Возражения');
  const [dontOpen, setDontOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (['q', 'Q', 'й', 'Й'].includes(e.key)) { e.preventDefault(); setOpen(o => !o); }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const scripts = SCRIPTS.filter(s => {
    if (!PANEL_CATS.includes(s.category) || s.category !== cat) return false;
    if (s.when && !s.when(answers)) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.title.toLowerCase().includes(q) || s.text.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <>
      <button className="qr-fab" onClick={() => setOpen(true)} title="Быстрые ответы (Q)">⚡</button>
      {open && (
        <>
          <div className="qr-overlay" onClick={() => setOpen(false)} />
          <div className="qr-panel">
            <div className="qr-header">
              <span>⚡ Быстрые ответы</span>
              <button className="qr-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <input ref={searchRef} className="qr-search" placeholder="Поиск…"
              value={search} onChange={e => setSearch(e.target.value)} />
            <div className="qr-cats">
              {PANEL_CATS.map(c => (
                <button key={c} className={`qr-cat${cat === c ? ' active' : ''}`} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>
            <div className="qr-list">
              {scripts.length === 0 && (
                <p style={{ color: '#9ca3af', padding: '12px 0', fontSize: 14 }}>Нет скриптов</p>
              )}
              {scripts.map(s => (
                <ScriptItem key={s.id} script={s} answers={answers}
                  used={usedScripts.includes(s.id)} onMark={onMark} />
              ))}
            </div>
            <div className="qr-dont-say">
              <button className="qr-dont-toggle" onClick={() => setDontOpen(o => !o)}>
                {dontOpen ? '▾' : '▸'} Не говорить
              </button>
              {dontOpen && (
                <ul className="qr-dont-list">
                  {DONT_SAY.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
