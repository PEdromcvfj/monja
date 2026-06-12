// Registra cada visita (país via cabeçalho da Vercel, horário do servidor, vídeo de origem).
// Usa o armazenamento KV/Redis da Vercel. Se não estiver configurado, apenas ignora (no-op).
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
  const kv = detectKV();
  const url = kv.url, token = kv.token;
  if (!url || !token) { res.status(204).end(); return; }

  try {
    const q = req.query || {};
    const path = String(q.p || '').slice(0, 80);
    const video = String(q.v || '').slice(0, 80) || 'direto';
    const country = String(req.headers['x-vercel-ip-country'] || '—').slice(0, 4);
    const now = Math.floor(Date.now() / 1000);
    const d = new Date();
    const ymd = '' + d.getUTCFullYear()
      + String(d.getUTCMonth() + 1).padStart(2, '0')
      + String(d.getUTCDate()).padStart(2, '0');

    const ev = JSON.stringify({ t: now, c: country, v: video, p: path });
    const pipeline = [
      ['LPUSH', 'ev', ev],
      ['LTRIM', 'ev', '0', '999'],
      ['INCR', 'v:total'],
      ['INCR', 'v:' + ymd],
      ['EXPIRE', 'v:' + ymd, '3456000']
    ];
    await fetch(url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline)
    });
    res.status(204).end();
  } catch (e) {
    res.status(204).end();
  }
};
