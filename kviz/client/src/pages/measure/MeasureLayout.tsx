import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';

interface Props {
  children?: React.ReactNode;
  active?: string; // kept for backward compat, ignored
}

export function MeasureLayout({ children }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get('section');

  const isLanding = pathname === '/measure' && !section;

  if (isLanding) {
    return (
      <div style={{ minHeight: '100vh', background: '#f7f8fc', display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: '#1a1a2e' }}>📏 Замеры</span>
        </div>
        <div className="measure-home">
          <button className="measure-card" onClick={() => setSearchParams({ section: 'measure' })}>
            <span className="measure-card-icon">📏</span>
            <div>
              <div className="measure-card-title">Новый замер</div>
              <div className="measure-card-sub">Запись замеров тела</div>
            </div>
          </button>
          <button className="measure-card" onClick={() => setSearchParams({ section: 'inbody' })}>
            <span className="measure-card-icon">⚡</span>
            <div>
              <div className="measure-card-title">InBody</div>
              <div className="measure-card-sub">Сканирование QR-кода</div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  const handleBack = () => {
    if (pathname === '/measure') setSearchParams({});
    else navigate('/measure');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fc' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid var(--border)', padding: '0 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8, height: 48 }}>
          <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#02BDB6', padding: '4px 0', fontFamily: 'inherit', fontWeight: 600 }}>
            ← Назад
          </button>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#1a1a2e' }}>
            {(section === 'inbody' || pathname === '/measure/inbody') ? '⚡ InBody' : '📏 Замеры'}
          </span>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
