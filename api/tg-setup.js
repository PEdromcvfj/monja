// Ativa as notificações do Telegram: descobre o seu chat (depois de você mandar
// uma mensagem ao bot) e guarda no KV. Uso: /api/tg-setup?key=SENHA
const { kvSet } = require('../lib/notify');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pass = process.env.DASHBOARD_PASSWORD || '';
  const key = (req.query && req.query.key) || '';
  if (!pass || key !== pass) { res.status(401).json({ error: 'unauthorized' }); return; }

  const tok = process.env.TELEGRAM_TOKEN || '';
  if (!tok) { res.status(400).json({ error: 'missing_TELEGRAM_TOKEN', note: 'Crie a variável TELEGRAM_TOKEN no Vercel.' }); return; }

  try {
    const r = await fetch('https://api.telegram.org/bot' + tok + '/getUpdates');
    const j = await r.json();
    const ups = (j && j.result) || [];
    let chat = null;
    for (let i = ups.length - 1; i >= 0; i--) {
      const m = ups[i].message || ups[i].channel_post || ups[i].edited_message;
      if (m && m.chat && m.chat.id) { chat = m.chat.id; break; }
    }
    if (!chat) {
      res.status(200).json({ ok: false, note: 'Abra seu bot no Telegram e envie /start (ou qualquer mensagem), depois abra este link de novo.' });
      return;
    }
    await kvSet('tg_chat', chat);
    await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: '✅ Notificações ativadas! Você vai receber aqui os carrinhos iniciados e as vendas (Stripe e Kiwify).' })
    });
    res.status(200).json({ ok: true, chat_id: chat });
  } catch (e) {
    res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};
