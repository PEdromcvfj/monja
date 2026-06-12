// Função serverless (Vercel) — devolve VENDAS (Stripe) e VISITAS (KV) para o painel.
// Variáveis de ambiente:
//   STRIPE_SECRET_KEY   -> chave (de preferência RESTRITA, somente leitura) do Stripe
//   DASHBOARD_PASSWORD  -> senha para abrir o painel
//   KV_REST_API_URL / KV_REST_API_TOKEN  -> armazenamento (visitas). Opcional.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const pass = process.env.DASHBOARD_PASSWORD || '';
  const key = (req.query && req.query.key) || '';
  if (!pass || key !== pass) { res.status(401).json({ error: 'unauthorized' }); return; }

  const days = Math.min(parseInt((req.query && req.query.days) || '30', 10) || 30, 90);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

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
          + '&created%5Bgte%5D=' + since
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

  // ---------- VISITAS (KV) ----------
  let visits = null;
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvTok) {
    try {
      const d = new Date();
      const ymd = '' + d.getUTCFullYear()
        + String(d.getUTCMonth() + 1).padStart(2, '0')
        + String(d.getUTCDate()).padStart(2, '0');
      const r = await fetch(kvUrl + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + kvTok, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['LRANGE', 'ev', '0', '999'],
          ['GET', 'v:' + ymd],
          ['GET', 'v:total']
        ])
      });
      const j = await r.json();
      const list = (j[0] && j[0].result) || [];
      const recent = list.map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
      visits = {
        today: parseInt((j[1] && j[1].result) || '0', 10) || 0,
        total: parseInt((j[2] && j[2].result) || '0', 10) || 0,
        recent: recent
      };
    } catch (e) { visits = null; }
  }

  res.status(200).json({ now: Math.floor(Date.now() / 1000), days: days, sales: sales, salesError: salesError, visits: visits });
};
