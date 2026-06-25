// Função serverless (Vercel) — devolve VIEWS dos reels de cada Página do Facebook.
// Usa o token de usuário de longa duração em FB_TOKEN (variável de ambiente na Vercel).
// Auth: ?key=<DASHBOARD_PASSWORD>. Janela calculada no cliente (devolve total, 7d, 30d).
//   Env: FB_TOKEN · DASHBOARD_PASSWORD

const GRAPH = 'https://graph.facebook.com/v25.0';

// Mapeamento página -> persona/idioma (rótulos; o que não estiver aqui cai em "Outros").
// Os dois Maestro (Chan/silavaro) são palpite ES/IT — ajuste se precisar.
const MAP = {
  '1052298801293749': { persona: 'Monja', lang: 'BR' }, // Mestra Lian
  '1000440856488761': { persona: 'Monja', lang: 'ES' }, // Maestra Yunan
  '1073100875881286': { persona: 'Monja', lang: 'EN' }, // Master meii
  '1058777340643696': { persona: 'Monja', lang: 'IT' }, // Maestra Kaori
  '939589179248758':  { persona: 'Monja', lang: 'FR' }, // Maître Jing
  '1122143534309113': { persona: 'Monja', lang: 'DE' }, // Meisterin Hana
  '948345008370625':  { persona: 'Monge', lang: 'BR' }, // Mestre Kassapa
  '1012407485283166': { persona: 'Monge', lang: 'ES' }, // Maestro silavaro
  '937884859415626':  { persona: 'Monge', lang: 'IT' }, // Maestro Chan
  '915272355013689':  { persona: 'Monge', lang: 'FR' }, // Maître Pema
  '960662403799567':  { persona: 'Monge', lang: 'EN' }, // Master Maha
  '1040603702459125': { persona: 'Monge', lang: 'DE' }, // Meisterminh
};

async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}

// Puxa os reels (vídeos) de uma página com paginação limitada e soma as views.
async function pageStats(page, nowSec) {
  const wk = nowSec - 7 * 86400;
  const mo = nowSec - 30 * 86400;
  let url = `${GRAPH}/${page.id}/videos?fields=id,views,created_time,permalink_url,title&limit=100&access_token=${page.access_token}`;
  let total = 0, n = 0, v7 = 0, v30 = 0, guard = 0;
  let top = null;
  const recent = [];
  while (url && guard < 6) {
    const j = await getJSON(url);
    if (j.error) return { error: j.error.message };
    for (const v of (j.data || [])) {
      const views = v.views || 0;
      const t = Math.floor(new Date(v.created_time).getTime() / 1000);
      total += views; n++;
      if (t >= wk) v7 += views;
      if (t >= mo) v30 += views;
      if (!top || views > top.views) top = { id: v.id, views, url: v.permalink_url, t };
      if (recent.length < 12) recent.push({ id: v.id, views, url: v.permalink_url, t });
    }
    url = (j.paging && j.paging.next) ? j.paging.next : null;
    guard++;
  }
  return { reels: n, total, v7, v30, top, recent };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pass = process.env.DASHBOARD_PASSWORD || '';
  const key = (req.query && req.query.key) || '';
  if (!pass || key !== pass) { res.status(401).json({ error: 'unauthorized' }); return; }

  const token = process.env.FB_TOKEN || '';
  if (!token) { res.status(500).json({ error: 'FB_TOKEN ausente' }); return; }

  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const acc = await getJSON(`${GRAPH}/me/accounts?fields=id,name,access_token,fan_count&limit=50&access_token=${token}`);
    if (acc.error) { res.status(502).json({ error: 'FB: ' + acc.error.message }); return; }

    const pages = await Promise.all((acc.data || []).map(async (p) => {
      const s = await pageStats(p, nowSec);
      const m = MAP[p.id] || { persona: 'Outros', lang: '' };
      return {
        id: p.id, name: p.name, fans: p.fan_count || 0,
        persona: m.persona, lang: m.lang,
        reels: s.reels || 0, total: s.total || 0, v7: s.v7 || 0, v30: s.v30 || 0,
        top: s.top || null, recent: s.recent || [], err: s.error || null,
      };
    }));

    pages.sort((a, b) => b.total - a.total);
    res.status(200).json({ updatedAt: nowSec, pages });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
