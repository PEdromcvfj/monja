// Função serverless (Vercel) — devolve VENDAS (Stripe + Kiwify) e VISITAS (KV) para o painel.
// Aceita janela por ?since=&until= (unix). Fallback: ?days=.
//   STRIPE_SECRET_KEY · DASHBOARD_PASSWORD · KV_REST_API_URL / KV_REST_API_TOKEN
function detectKV() {
  const e = process.env;
  let url = e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL || e.STORAGE_REST_API_URL || '';
  let token = e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN || e.STORAGE_REST_API_TOKEN || '';
  if (!url || !token) {
    for (const k in e) {
      if (!url && /_REST_API_URL$/.test(k)) url = e[k];
      if (!token && /_REST_API_TOKEN$/.test(k) && !/READ_ONLY/.test(k)) token = e[k];
    }
  }
  return { url: url, token: token };
}
const BR_OFF = 3 * 3600 * 1000; // UTC-3
function brYmd(unixSec) {
  const d = new Date(unixSec * 1000 - BR_OFF);
  return '' + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pass = process.env.DASHBOARD_PASSWORD || '';
  const key = (req.query && req.query.key) || '';
  if (!pass || key !== pass) { res.status(401).json({ error: 'unauthorized' }); return; }

  const q = req.query || {};
  const nowSec = Math.floor(Date.now() / 1000);
  let until = parseInt(q.until, 10) || nowSec;
  let since = parseInt(q.since, 10) || (until - (Math.min(parseInt(q.days, 10) || 30, 95)) * 86400);
  if (until - since > 95 * 86400) since = until - 95 * 86400;
  if (since > until) since = until - 86400;

  // ---------- VENDAS (Stripe) ----------
  let sales = [];
  let salesError = null;
  const sk = process.env.STRIPE_SECRET_KEY;
  if (sk) {
    try {
      const out = [];
      let after = '';
      for (let i = 0; i < 12; i++) {
        const url = 'https://api.stripe.com/v1/checkout/sessions?limit=100'
          + '&created%5Bgte%5D=' + since + '&created%5Blte%5D=' + until
          + (after ? '&starting_after=' + after : '');
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + sk } });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message || 'stripe_error');
        out.push(...(j.data || []));
        if (j.has_more && j.data && j.data.length) after = j.data[j.data.length - 1].id;
        else break;
      }
      sales = out.filter(s => s.payment_status === 'paid').map(s => ({
        t: s.created,
        amount: (s.amount_total || 0) / 100,
        currency: (s.currency || '').toUpperCase(),
        video: s.client_reference_id || 'direto',
        country: (s.customer_details && s.customer_details.address && s.customer_details.address.country) || '—'
      })).sort((a, b) => b.t - a.t);
    } catch (e) { salesError = String((e && e.message) || e); }
  } else { salesError = 'missing_STRIPE_SECRET_KEY'; }

  // ---------- VISITAS / CARRINHOS (KV) ----------
  let visits = null, checkouts = null, kiwifyRaw = [];
  let periodVisits = 0, periodCarts = 0;
  const kv = detectKV();
  if (kv.url && kv.token) {
    try {
      // datas (horário do Brasil) dentro da janela
      const dates = []; const seen = {};
      for (let ts = since; ts <= until; ts += 86400) { const y = brYmd(ts); if (!seen[y]) { seen[y] = 1; dates.push(y); } }
      const yU = brYmd(until); if (!seen[yU]) { dates.push(yU); }

      const cmds = [
        ['LRANGE', 'ev', '0', '999'],   // 0
        ['GET', 'v:total'],              // 1
        ['LRANGE', 'ck', '0', '499'],   // 2
        ['GET', 'ck:total'],             // 3
        ['LRANGE', 'ks', '0', '999'],   // 4
        ['LRANGE', 'ks_raw', '0', '9']  // 5
      ];
      dates.forEach(dt => { cmds.push(['GET', 'v:' + dt]); cmds.push(['GET', 'ck:' + dt]); });

      const r = await fetch(kv.url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + kv.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds)
      });
      const j = await r.json();
      const parse = arr => (arr || []).map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
      kiwifyRaw = (j[5] && j[5].result) || [];
      visits = { total: parseInt((j[1] && j[1].result) || '0', 10) || 0, recent: parse(j[0] && j[0].result) };
      checkouts = { total: parseInt((j[3] && j[3].result) || '0', 10) || 0, recent: parse(j[2] && j[2].result) };
      // soma dos contadores diários no período
      dates.forEach((dt, i) => {
        periodVisits += parseInt((j[6 + i * 2] && j[6 + i * 2].result) || '0', 10) || 0;
        periodCarts += parseInt((j[6 + i * 2 + 1] && j[6 + i * 2 + 1].result) || '0', 10) || 0;
      });
      // vendas Kiwify dentro da janela
      const ksales = parse(j[4] && j[4].result).filter(s => s.t >= since && s.t <= until);
      if (ksales.length) { sales = sales.concat(ksales).sort((a, b) => b.t - a.t); }
    } catch (e) { visits = null; checkouts = null; }
  }

  const out = {
    now: nowSec, since: since, until: until,
    sales: sales, salesError: salesError,
    visits: visits, checkouts: checkouts,
    periodVisits: periodVisits, periodCarts: periodCarts
  };
  if (q.raw === '1') out.kiwifyRaw = kiwifyRaw;
  res.status(200).json(out);
};
