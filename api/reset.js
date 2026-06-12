// Zera os dados de teste do painel (visitas, carrinhos e vendas Kiwify no KV).
// Protegido pela senha do painel. Uso: /api/reset?key=SENHA
// Obs.: vendas do Stripe vêm da API do Stripe (não são apagadas aqui).
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
  if (!kv.url || !kv.token) { res.status(500).json({ error: 'no_kv' }); return; }

  const keys = ['ev', 'ck', 'ks', 'ks_raw', 'v:total', 'ck:total', 'ks:total'];
  const base = Date.now() - 3 * 3600 * 1000; // horário do Brasil
  for (let i = 0; i < 60; i++) {
    const d = new Date(base - i * 86400 * 1000);
    const ymd = '' + d.getUTCFullYear()
      + String(d.getUTCMonth() + 1).padStart(2, '0')
      + String(d.getUTCDate()).padStart(2, '0');
    keys.push('v:' + ymd, 'ck:' + ymd, 'ks:' + ymd);
  }

  try {
    await fetch(kv.url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + kv.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(keys.map(k => ['DEL', k]))
    });
    res.status(200).json({ ok: true, cleared: keys.length });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
