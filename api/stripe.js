// Webhook do Stripe → notificação de venda no Telegram.
// Configure na Stripe (Developers → Webhooks) o evento "checkout.session.completed"
// apontando para: https://monja-iota.vercel.app/api/stripe
const { notify } = require('../lib/notify');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(200).json({ ok: true, note: 'use POST' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  try {
    const type = b.type || '';
    const o = (b.data && b.data.object) || {};
    const paid = /checkout\.session\.completed|async_payment_succeeded/.test(type)
      && (o.payment_status ? o.payment_status === 'paid' : true);
    if (paid) {
      const amount = (o.amount_total || 0) / 100;
      const currency = (o.currency || '').toUpperCase();
      const video = o.client_reference_id || 'direto';
      const country = (o.customer_details && o.customer_details.address && o.customer_details.address.country) || '—';
      const val = amount ? (currency + ' ' + amount.toFixed(2)) : 'venda';
      await notify('💰 VENDA! (Stripe)\n' + val + ' · ' + country + ' · 🎬 ' + video);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: true, error: String((e && e.message) || e) });
  }
};
