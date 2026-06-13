// Envio de notificações via Telegram + util de KV/rótulo de página.
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

async function kvGet(key) {
  const kv = detectKV();
  if (!kv.url || !kv.token) return null;
  try {
    const r = await fetch(kv.url + '/get/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + kv.token } });
    const j = await r.json();
    return (j && j.result) || null;
  } catch (e) { return null; }
}

async function kvSet(key, val) {
  const kv = detectKV();
  if (!kv.url || !kv.token) return false;
  try {
    await fetch(kv.url + '/set/' + encodeURIComponent(key) + '/' + encodeURIComponent(val), { headers: { Authorization: 'Bearer ' + kv.token } });
    return true;
  } catch (e) { return false; }
}

async function notify(text) {
  try {
    const tok = process.env.TELEGRAM_TOKEN;
    if (!tok) return;
    const chat = process.env.TELEGRAM_CHAT_ID || await kvGet('tg_chat');
    if (!chat) return;
    await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true })
    });
  } catch (e) { /* nunca quebra o fluxo principal */ }
}

function pageLabel(p) {
  if (!p) return '—';
  const L = { es: 'ES', it: 'IT', fr: 'FR', de: 'DE', en: 'EN' };
  const masc = /^\/h(\/|$)/.test(p);
  let rest = (masc ? p.replace(/^\/h/, '') : p).replace(/^\//, '').replace(/\/$/, '');
  const parts = rest ? rest.split('/') : [];
  const desc = parts.indexOf('desconto') > -1;
  const seg = parts.filter(x => x !== 'desconto')[0] || '';
  const lang = L[seg] || 'PT';
  return (masc ? '♂ Masc' : '♀ Fem') + ' ' + lang + (desc ? ' · Desconto' : '');
}

module.exports = { detectKV, kvGet, kvSet, notify, pageLabel };
