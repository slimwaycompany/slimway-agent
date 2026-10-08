import { rawGet, paginateGet } from '../http/fitbase';

export async function runProbeUnsorted(): Promise<Record<string, unknown>> {
  // 1. Find test card — search by lead_info, then exact-match title
  const q        = encodeURIComponent('ТЕСТ агента');
  const found    = await paginateGet('/lead', { lead_info: q, page_size: 100 });
  const testLead = found.find(l => String(l.title || '') === 'ТЕСТ агента — не трогать');

  let testCardRaw: unknown = null;
  if (testLead) {
    testCardRaw = await rawGet(`/lead/${testLead.id}`);
  }

  // 2. One regular funnel-1 card (has purchase_funnel.id = 1, step > 0)
  const allLeads   = await paginateGet('/lead', { page_size: 100 });
  const regularLead = allLeads.find(l => {
    const step = l.funnel_step as Record<string, unknown> | undefined;
    const pf   = step?.purchase_funnel as Record<string, unknown> | null | undefined;
    return Number(pf?.id ?? 0) === 1 && Number(step?.id ?? 0) > 0;
  });

  let regularCardRaw: unknown = null;
  if (regularLead) {
    regularCardRaw = await rawGet(`/lead/${regularLead.id}`);
  }

  // 3. GET /lead?funnel_step_id=0 — first page (id, title, funnel_step only)
  const step0Resp  = await rawGet('/lead?funnel_step_id=0&page_size=20');
  const step0Items = ((step0Resp.items || []) as Record<string, unknown>[]).map(l => ({
    id:         l.id,
    title:      l.title,
    name:       l.name,
    funnel_step: l.funnel_step,
    funnels_id:  l.funnels_id,
    funnel_id:   l.funnel_id,
    purchase_funnel_id: l.purchase_funnel_id,
  }));

  // 4. Filter experiments — does funnels_id=1 or funnel_id=1 work with funnel_step_id=0?
  const [withFunnelsId, withFunnelId] = await Promise.all([
    rawGet('/lead?funnels_id=1&funnel_step_id=0&page_size=1'),
    rawGet('/lead?funnel_id=1&funnel_step_id=0&page_size=1'),
  ]);

  // 5. Analyse test card for funnel indicator
  let funnelConclusion = 'воронку определить нельзя — поля funnels_id/funnel_id/purchase_funnel_id отсутствуют';
  if (testCardRaw) {
    const raw  = testCardRaw as Record<string, unknown>;
    const item = (raw.item ?? raw) as Record<string, unknown>;
    const fs   = item.funnel_step as Record<string, unknown> | null | undefined;
    // Check purchase_funnel presence
    if (fs?.purchase_funnel) {
      funnelConclusion = `funnel_step.purchase_funnel = ${JSON.stringify(fs.purchase_funnel)} — воронка ОПРЕДЕЛЯЕТСЯ по purchase_funnel`;
    }
    // Check lead-level funnel fields
    for (const key of ['funnels_id', 'funnel_id', 'purchase_funnel_id', 'funnel']) {
      if (item[key] !== undefined && item[key] !== null && item[key] !== 0) {
        funnelConclusion = `воронка определяется по полю «${key}» = ${JSON.stringify(item[key])}`;
        break;
      }
    }
  }

  return {
    test_card_found:    !!testLead,
    test_card_raw:      testCardRaw,
    regular_card_raw:   regularCardRaw,
    step0_first_page: {
      total_count: step0Resp.total_count,
      items:       step0Items,
    },
    filter_funnels_id_1: {
      total_count: withFunnelsId.total_count,
      comment:     'does funnels_id=1 filter work?',
    },
    filter_funnel_id_1: {
      total_count: withFunnelId.total_count,
      comment:     'does funnel_id=1 filter work?',
    },
    step0_no_filter_total: step0Resp.total_count,
    funnel_conclusion: funnelConclusion,
  };
}
