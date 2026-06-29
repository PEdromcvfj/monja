// Recebe os dados do upload (antes do checkout) e grava na tabela "pedidos" do Supabase.
// Env necessarias no projeto (Vercel):
//   SUPABASE_URL          -> https://xxxxx.supabase.co
//   SUPABASE_SERVICE_KEY  -> a service_role key (secreta, fica so no servidor)
// Tabela esperada (SQL no painel do Supabase):
//   create table public.pedidos (
//     id bigint generated always as identity primary key,
//     order_id text, offer text, notes text,
//     photos jsonb default '[]'::jsonb,
//     email text, whatsapp text,
//     status text default 'aguardando_pagamento',
//     amount numeric, created_at timestamptz default now()
//   );

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(200).json({ ok: true, note: 'use POST' }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
  if (!url || !key) { res.status(200).json({ ok: true, skipped: 'sem SUPABASE_URL/KEY' }); return; }

  const row = {
    order_id: String(b.order || '').slice(0, 40),
    offer: String(b.offer || '').slice(0, 60),
    notes: String(b.notes || '').slice(0, 500),
    photos: Array.isArray(b.photos) ? b.photos.slice(0, 5).map(function (u) { return String(u).slice(0, 400); }) : [],
    status: 'aguardando_pagamento'
  };

  try {
    const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/pedidos', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (r.ok) { res.status(200).json({ ok: true }); }
    else { const t = await r.text(); res.status(200).json({ ok: false, error: t.slice(0, 300) }); }
  } catch (e) {
    res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};
