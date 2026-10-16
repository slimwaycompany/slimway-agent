import { useNavigate } from 'react-router-dom';

interface Props {
  active: 'new' | 'reports';
  children: React.ReactNode;
}

export function MeasureLayout({ active, children }: Props) {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fc' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e6ea', padding: '0 16px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 4, height: 48 }}>
          <span style={{ fontWeight: 700, fontSize: 16, marginRight: 12, color: '#1a1a2e' }}>📏 Замеры</span>
          <button
            className={`measure-subtab${active === 'new' ? ' active' : ''}`}
            onClick={() => navigate('/measure/new')}
          >Новый замер</button>
          <button
            className={`measure-subtab${active === 'reports' ? ' active' : ''}`}
            onClick={() => navigate('/measure/reports')}
          >Отчёты</button>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
