// Lista os pedidos (uploads) gravados no KV, para o painel /pedidos.
// Protegido por ?key=DASHBOARD_PASSWORD (mesma senha do painel).
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
  const pass = process.env.DASHBOARD_PASSWORD || '';
  const key = (req.query && req.query.key) || '';
  if (!pass || key !== pass) { res.status(401).json({ error: 'unauthorized' }); return; }

  const kv = detectKV();
  if (!kv.url || !kv.token) { res.status(200).json({ pedidos: [], error: 'sem KV' }); return; }
  const base = kv.url.replace(/\/$/, '');
  const auth = { Authorization: 'Bearer ' + kv.token, 'Content-Type': 'application/json' };

  try {
    const r1 = await fetch(base + '/lrange/pedidos/0/199', { headers: auth });
    const j1 = await r1.json();
    const ids = (j1 && j1.result) || [];
    let pedidos = [];
    if (ids.length) {
      const keys = ids.map(function (id) { return 'pedido:' + id; });
      const r2 = await fetch(base + '/pipeline', {
        method: 'POST', headers: auth, body: JSON.stringify([['MGET'].concat(keys)])
      });
      const j2 = await r2.json();
      const arr = (j2 && j2[0] && j2[0].result) || [];
      const seen = {};
      pedidos = arr.map(function (s) { try { return JSON.parse(s); } catch (e) { return null; } })
        .filter(function (p) { if (!p || !p.order_id || seen[p.order_id]) return false; seen[p.order_id] = 1; return true; })
        .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    }
    res.status(200).json({ now: Math.floor(Date.now() / 1000), pedidos: pedidos });
  } catch (e) {
    res.status(200).json({ pedidos: [], error: String((e && e.message) || e) });
  }
};
