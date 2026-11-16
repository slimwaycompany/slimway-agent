import { useNavigate, useLocation } from 'react-router-dom';

interface Props {
  children: React.ReactNode;
}

export function MeasureLayout({ children }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fc' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e6ea', padding: '0 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 4, height: 48 }}>
          <span style={{ fontWeight: 700, fontSize: 16, marginRight: 12, color: '#1a1a2e' }}>📏 Замеры</span>
          <button
            className={`measure-subtab${pathname === '/measure/new' || pathname === '/measure' ? ' active' : ''}`}
            onClick={() => navigate('/measure/new')}
          >Новый замер</button>
          <button
            className={`measure-subtab${pathname === '/measure/inbody' ? ' active' : ''}`}
            onClick={() => navigate('/measure/inbody')}
          >InBody</button>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
