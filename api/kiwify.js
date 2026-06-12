// Recebe o webhook de vendas do Kiwify e registra no painel (KV).
// Config: na Kiwify, aponte o webhook de "Compra aprovada" para:
//   https://monja-iota.vercel.app/api/kiwify?token=SEU_TOKEN
// e crie a variavel de ambiente KIWIFY_TOKEN com o mesmo valor (Vercel).
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

function pick(obj, paths) {
  for (const p of paths) {
    let v = obj, ok = true;
    for (const k of p.split('.')) {
      if (v && typeof v === 'object' && k in v) v = v[k];
      else { ok = false; break; }
    }
    if (ok && v != null && v !== '') return v;
  }
  return undefined;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(200).json({ ok: true, note: 'use POST' }); return; }

  // seguranca opcional por token
  const want = process.env.KIWIFY_TOKEN || '';
  const got = (req.query && req.query.token) || '';
  if (want && got !== want) { res.status(401).json({ error: 'unauthorized' }); return; }

  // corpo (pode vir como objeto ou string)
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  const kv = detectKV();
  try {
    // status: so registra venda aprovada/paga
    const status = String(pick(b, ['order_status', 'status', 'webhook_event_type', 'event']) || '').toLowerCase();
    const isPaid = /paid|approv|aprovad|completed|pago/.test(status) || status === '';

    // valor (Kiwify costuma mandar em centavos)
    let raw = pick(b, ['Commissions.charge_amount', 'order.charge_amount', 'charge_amount', 'order.amount', 'amount', 'order_total', 'Commissions.product_base_price']);
    let amount = Number(raw);
    if (!isFinite(amount)) amount = 0;
    if (Number.isInteger(amount) && amount >= 1000) amount = amount / 100; // centavos -> reais

    const currency = String(pick(b, ['Commissions.currency', 'currency', 'order.currency']) || 'BRL').toUpperCase().slice(0, 4);
    const country = String(pick(b, ['Customer.country', 'customer.country', 'Customer.Country', 'buyer.country']) || 'BR').toUpperCase().slice(0, 4);
    const vraw = String(pick(b, ['TrackingParameters.utm_content', 'TrackingParameters.src', 'tracking.utm_content', 'utm_content', 'src', 'TrackingParameters.s']) || 'direto');
    const video = vraw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'direto';
    const now = Math.floor(Date.now() / 1000);

    if (kv.url && kv.token) {
      const pipeline = [
        ['LPUSH', 'ks_raw', JSON.stringify(b).slice(0, 4000)],
        ['LTRIM', 'ks_raw', '0', '9']
      ];
      if (isPaid) {
        const sale = JSON.stringify({ t: now, amount: amount, currency: currency, video: video, country: country, source: 'kiwify' });
        pipeline.push(['LPUSH', 'ks', sale], ['LTRIM', 'ks', '0', '999'], ['INCR', 'ks:total']);
      }
      await fetch(kv.url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + kv.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline)
      });
    }
    res.status(200).json({ ok: true, recorded: isPaid, amount: amount, currency: currency, video: video });
  } catch (e) {
    res.status(200).json({ ok: true, error: String((e && e.message) || e) });
  }
};
