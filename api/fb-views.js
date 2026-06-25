// Função serverless (Vercel) — devolve os reels (views + data) de cada Página do Facebook.
// Usa o token de usuário de longa duração em FB_TOKEN. Auth: ?key=<DASHBOARD_PASSWORD>.
// O cliente (views.html) soma por período (ontem / 7d / 30d / total / personalizado).
//   Env: FB_TOKEN · DASHBOARD_PASSWORD

const GRAPH = 'https://graph.facebook.com/v25.0';

// Páginas que aparecem no painel (as 5 escolhidas). Demais são ignoradas.
const FEATURED = {
  '1052298801293749': { persona: 'Monja', lang: 'BR', label: 'Mestra Lian' },
  '1000440856488761': { persona: 'Monja', lang: 'ES', label: 'Maestra Yuna' },
  '1073100875881286': { persona: 'Monja', lang: 'EN', label: 'Master Mei' },
  '937884859415626':  { persona: 'Monge', lang: 'IT', label: 'Maestro Chan' },
  '948345008370625':  { persona: 'Monge', lang: 'BR', label: 'Mestre Kassapa' },
};

async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}

// Puxa todos os reels (id, views, data) de uma página, com paginação limitada.
async function pageReels(page) {
  let url = `${GRAPH}/${page.id}/videos?fields=id,views,created_time,permalink_url&limit=100&access_token=${page.access_token}`;
  const reels = [];
  let total = 0, guard = 0;
  while (url && guard < 8) {
    const j = await getJSON(url);
    if (j.error) return { error: j.error.message };
    for (const v of (j.data || [])) {
      const views = v.views || 0;
      const t = Math.floor(new Date(v.created_time).getTime() / 1000);
      total += views;
      reels.push({ t, v: views, u: v.permalink_url || '' });
    }
    url = (j.paging && j.paging.next) ? j.paging.next : null;
    guard++;
  }
  return { reels, total };
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

    const wanted = (acc.data || []).filter(p => FEATURED[p.id]);

    const pages = await Promise.all(wanted.map(async (p) => {
      const s = await pageReels(p);
      const m = FEATURED[p.id];
      return {
        id: p.id, name: p.name, label: m.label, fans: p.fan_count || 0,
        persona: m.persona, lang: m.lang,
        reels: s.reels || [], total: s.total || 0, err: s.error || null,
      };
    }));

    pages.sort((a, b) => b.total - a.total);
    res.status(200).json({ updatedAt: nowSec, pages });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
