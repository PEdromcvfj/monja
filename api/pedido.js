// Recebe os dados do upload (antes do checkout) e grava o pedido.
// Primario: Upstash KV (ja configurado no projeto, mesmo banco das vendas).
//   - SET  pedido:<orderId>  = JSON do pedido
//   - LPUSH pedidos <orderId> (indice dos mais recentes)
// Opcional: tambem grava no Supabase se SUPABASE_URL + SUPABASE_SERVICE_KEY existirem.
// Tambem dispara alerta no Telegram (lib/notify) quando chega foto nova.

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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(200).json({ ok: true, note: 'use POST' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  const row = {
    order_id: String(b.order || '').slice(0, 40),
    offer: String(b.offer || '').slice(0, 60),
    notes: String(b.notes || '').slice(0, 500),
    photos: Array.isArray(b.photos) ? b.photos.slice(0, 5).map(function (u) { return String(u).slice(0, 400); }) : [],
    status: 'aguardando_pagamento',
    ts: Math.floor(Date.now() / 1000)
  };

  let savedKV = false, savedSupa = false, errors = [];

  // ---- Upstash KV (primario) ----
  const kv = detectKV();
  if (kv.url && kv.token) {
    try {
      const pipeline = [
        ['SET', 'pedido:' + row.order_id, JSON.stringify(row)],
        ['LPUSH', 'pedidos', row.order_id],
        ['LTRIM', 'pedidos', '0', '999']
      ];
      const r = await fetch(kv.url.replace(/\/$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + kv.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(pipeline)
      });
      savedKV = r.ok;
      if (!r.ok) errors.push('kv:' + (await r.text()).slice(0, 120));
    } catch (e) { errors.push('kv:' + String((e && e.message) || e)); }
  }

  // ---- Supabase (opcional, se configurado) ----
  const supaUrl = process.env.SUPABASE_URL || '';
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
  if (supaUrl && supaKey) {
    try {
      const r = await fetch(supaUrl.replace(/\/$/, '') + '/rest/v1/renova_pedidos', {
        method: 'POST',
        headers: { apikey: supaKey, Authorization: 'Bearer ' + supaKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ order_id: row.order_id, offer: row.offer, notes: row.notes, photos: row.photos, status: row.status })
      });
      savedSupa = r.ok;
      if (!r.ok) errors.push('supa:' + (await r.text()).slice(0, 120));
    } catch (e) { errors.push('supa:' + String((e && e.message) || e)); }
  }

  // ---- Alerta no Telegram ----
  try {
    const { notify } = require('../lib/notify');
    await notify('📸 Nova foto recebida (Renova Memórias)\nPedido: ' + row.order_id + '\nOferta: ' + row.offer + '\nFotos: ' + row.photos.length + (row.notes ? '\nObs: ' + row.notes : ''));
  } catch (e) {}

  res.status(200).json({ ok: savedKV || savedSupa, kv: savedKV, supabase: savedSupa, errors: errors });
};
