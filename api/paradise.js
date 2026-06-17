// Recebe o webhook (postback) de vendas da ParadisePags (PIX) e registra no painel (KV).
// Config na ParadisePags: Integrações -> Webhooks (Postbacks) -> Adicionar:
//   URL: https://monja-iota.vercel.app/api/paradise
//   (opcional) adicione ?token=SEU_TOKEN e crie a env PARADISE_TOKEN com o mesmo valor.
// As vendas PIX aparecem no painel junto com as demais e disparam notificação no Telegram.
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
  const want = process.env.PARADISE_TOKEN || '';
  const got = (req.query && req.query.token) || '';
  if (want && got !== want) { res.status(401).json({ error: 'unauthorized' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  const kv = detectKV();
  try {
    // status: so registra venda APROVADA/PAGA (PIX gera transacao pendente antes de pagar)
    const status = String(pick(b, [
      'status', 'order_status', 'payment_status', 'transaction.status',
      'data.status', 'event', 'type', 'event_type'
    ]) || '').toLowerCase();
    const isPaid = /paid|approv|aprovad|pago|completed|succe/.test(status)
      && !/pend|aguard|wait|refus|recus|refund|estorn|charge.?back|cancel|expir/.test(status);

    // valor (pode vir em centavos)
    let raw = pick(b, [
      'amount', 'total', 'value', 'paid_amount', 'price',
      'data.amount', 'data.total', 'transaction.amount', 'order.amount', 'order.total'
    ]);
    let amount = Number(raw);
    if (!isFinite(amount)) amount = 0;
    if (Number.isInteger(amount) && amount >= 1000) amount = amount / 100; // centavos -> reais

    const currency = String(pick(b, ['currency', 'data.currency', 'transaction.currency']) || 'BRL').toUpperCase().slice(0, 4);
    const country = String(pick(b, ['country', 'customer.country', 'Customer.country', 'data.customer.country']) || 'BR').toUpperCase().slice(0, 4);
    const vraw = String(pick(b, [
      'utm_content', 'tracking.utm_content', 'metadata.utm_content',
      'data.utm_content', 'src', 'utm.utm_content'
    ]) || 'direto');
    const video = vraw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'direto';
    const now = Math.floor(Date.now() / 1000);

    if (kv.url && kv.token) {
      // guarda o corpo cru pra inspecionar o formato real da ParadisePags
      const pipeline = [
        ['LPUSH', 'ps_raw', JSON.stringify(b).slice(0, 4000)],
        ['LTRIM', 'ps_raw', '0', '9']
      ];
      if (isPaid) {
        // grava na MESMA lista de vendas que o painel ja le (ks), com source 'pix'
        const sale = JSON.stringify({ t: now, amount: amount, currency: currency, video: video, country: country, source: 'pix' });
        pipeline.push(['LPUSH', 'ks', sale], ['LTRIM', 'ks', '0', '999'], ['INCR', 'ks:total']);
      }
      await fetch(kv.url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + kv.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline)
      });
    }
    if (isPaid) {
      try {
        const { notify } = require('../lib/notify');
        await notify('💰 VENDA! (PIX · ParadisePags)\n' + currency + ' ' + amount.toFixed(2) + ' · ' + country + ' · 🎬 ' + video);
      } catch (e) {}
    }
    res.status(200).json({ ok: true, recorded: isPaid, status: status, amount: amount, currency: currency });
  } catch (e) {
    res.status(200).json({ ok: true, error: String((e && e.message) || e) });
  }
};
