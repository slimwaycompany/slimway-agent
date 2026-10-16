import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost } from '../api';

export default function NewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    async function init() {
      const name   = searchParams.get('name')    ?? '';
      const phone  = searchParams.get('phone')   ?? '';
      const leadId = searchParams.get('lead_id') ?? '';

      if (leadId) {
        const existing: { id: string; status: string; current_step: number }[] =
          await apiGet(`/api/sessions?lead_id=${encodeURIComponent(leadId)}`);
        if (existing.length > 0) {
          const s = existing[0];
          navigate(s.status === 'done' ? `/q/${s.id}/summary` : `/q/${s.id}/${s.current_step}`, { replace: true });
          return;
        }
      }

      const s = await apiPost('/api/sessions', {
        fitbase_lead_id: leadId || undefined,
        client_name:     name  || undefined,
        client_phone:    phone || undefined,
      });
      navigate(`/q/${s.id}/1`, { replace: true });
    }

    init().catch(console.error);
  }, []);

  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 16 }}>
      Открываем квалификацию…
    </div>
  );
}
