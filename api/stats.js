// Função serverless (Vercel) — lê as vendas do Stripe com segurança.
// Variáveis de ambiente necessárias (Vercel → Settings → Environment Variables):
//   STRIPE_SECRET_KEY   -> chave (de preferência RESTRITA, somente leitura) do Stripe
//   DASHBOARD_PASSWORD  -> senha para abrir o painel
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const pass = process.env.DASHBOARD_PASSWORD || '';
  const key = (req.query && req.query.key) || '';
  if (!pass || key !== pass) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) {
    res.status(500).json({ error: 'missing_STRIPE_SECRET_KEY' });
    return;
  }

  const days = Math.min(parseInt((req.query && req.query.days) || '30', 10) || 30, 90);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  async function listSessions() {
    const out = [];
    let after = '';
    for (let i = 0; i < 12; i++) { // até ~1200 vendas
      let url = 'https://api.stripe.com/v1/checkout/sessions?limit=100'
              + '&created%5Bgte%5D=' + since
              + (after ? '&starting_after=' + after : '');
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + sk } });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'stripe_error');
      out.push(...(j.data || []));
      if (j.has_more && j.data && j.data.length) {
        after = j.data[j.data.length - 1].id;
      } else break;
    }
    return out;
  }

  try {
    const sessions = await listSessions();
    const sales = sessions
      .filter(s => s.payment_status === 'paid')
      .map(s => ({
        t: s.created,
        amount: (s.amount_total || 0) / 100,
        currency: (s.currency || '').toUpperCase(),
        video: s.client_reference_id || 'direto',
        country: (s.customer_details && s.customer_details.address && s.customer_details.address.country) || '—'
      }))
      .sort((a, b) => b.t - a.t);

    res.status(200).json({ now: Math.floor(Date.now() / 1000), days: days, sales: sales });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
