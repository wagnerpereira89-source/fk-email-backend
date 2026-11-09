// Entrada do backend (Hono rodando como Serverless Function na Vercel).
import { Hono } from 'hono';
import { handle } from '@hono/node-server/vercel';
import { getSupabase, hasSupabaseEnv, fetchAll } from '../src/db.js';
import { sendEmail, hasSesEnv } from '../src/ses.js';
import { fetchOrdersPage, fetchCampaignProducts, fetchOrdersAfter, hasWooEnv } from '../src/woo.js';
import { renderCampaignHtml } from '../src/template.js';
import { unsubUrl, verifyEmail } from '../src/sign.js';
import { PIXEL_GIF, addUtm, runPool } from '../src/track.js';
import { ADMIN_HTML } from '../src/admin.js';

// Permite ate 60s por invocacao (importacao percorre varias paginas).
export const maxDuration = 60;

const app = new Hono().basePath('/api');

// Saude do servico: GET /api/health
// Mostra quais variaveis de ambiente estao configuradas (sem revelar os valores),
// pra facilitar o diagnostico.
app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'fk-email-backend',
    version: '0.4.1',
    env: {
      supabase: hasSupabaseEnv(),
      ses: hasSesEnv(),
      sesRegion: process.env.SES_REGION || '(default) us-east-2',
      woo: hasWooEnv(),
      importToken: !!process.env.IMPORT_TOKEN,
      monitor: !!process.env.MONITOR_EMAIL,
    },
  })
);

// Envio de teste de ponta a ponta: POST /api/test-send  { "to": "voce@email.com" }
app.post('/test-send', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const to = (body?.to ?? '').trim();
  if (!to) {
    return c.json({ error: 'Faltou o campo "to" (e-mail de destino).' }, 400);
  }

  let client: any;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('slug', 'adoratta')
      .single();
    if (error || !data) {
      return c.json(
        { error: 'Cliente "adoratta" nao encontrado no banco.', detail: error?.message },
        500
      );
    }
    client = data;
  } catch (e: any) {
    return c.json({ error: 'Erro ao conectar no Supabase.', detail: String(e?.message ?? e) }, 500);
  }

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
      <h2 style="color:#354734">Oi! 💜</h2>
      <p>Esse é um <strong>e-mail de teste</strong> do FK E-mail Marketing.</p>
      <p>Se ele chegou bonitinho na sua caixa de entrada, está tudo funcionando:
         <strong>SES + Supabase</strong> conversando certinho.</p>
      <p style="margin-top:24px;color:#888;font-size:13px">
         Enviado por ${client.from_name} via FK Digital.
      </p>
    </div>`;

  try {
    const messageId = await sendEmail({
      to,
      fromName: client.from_name,
      fromEmail: client.from_email,
      replyTo: client.reply_to,
      subject: 'Teste FK E-mail ✅',
      html,
    });
    return c.json({ ok: true, messageId, sentTo: to, from: client.from_email });
  } catch (e: any) {
    return c.json({ error: 'Falha ao enviar pelo SES.', detail: String(e?.message ?? e) }, 500);
  }
});

// Importa contatos do WooCommerce (pelos pedidos) pro Supabase.
// Protegido por token: POST /api/import/woo?token=XXX
// Params opcionais: startPage (1), maxPages (20), perPage (100)
// Chame repetidas vezes usando o "nextStartPage" retornado ate hasMore=false.
app.post('/import/woo', async (c) => {
  const token = c.req.query('token') || c.req.header('x-import-token');
  if (!process.env.IMPORT_TOKEN || token !== process.env.IMPORT_TOKEN) {
    return c.json({ error: 'Nao autorizado (token invalido).' }, 401);
  }
  if (!hasWooEnv()) {
    return c.json({ error: 'Faltam variaveis WOO_URL / WOO_CK / WOO_CS.' }, 500);
  }

  const perPage = Math.min(Math.max(Number(c.req.query('perPage') || 100), 1), 100);
  const startPage = Math.max(Number(c.req.query('startPage') || 1), 1);
  const maxPages = Math.min(Math.max(Number(c.req.query('maxPages') || 20), 1), 50);

  const supabase = getSupabase();
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', 'adoratta')
    .single();
  if (cErr || !client) {
    return c.json({ error: 'Cliente "adoratta" nao encontrado.', detail: cErr?.message }, 500);
  }

  // Dedupe por email nesta execucao.
  const map = new Map<string, string | null>();
  let page = startPage;
  let pagesProcessed = 0;
  let reachedEnd = false;

  try {
    while (pagesProcessed < maxPages) {
      const rows = await fetchOrdersPage(page, perPage);
      for (const r of rows) {
        if (!map.has(r.email)) map.set(r.email, r.name);
      }
      pagesProcessed++;
      page++;
      if (rows.length < perPage) {
        reachedEnd = true;
        break;
      }
    }
  } catch (e: any) {
    return c.json({ error: 'Erro ao buscar no WooCommerce.', detail: String(e?.message ?? e) }, 502);
  }

  const records = Array.from(map.entries()).map(([email, name]) => ({
    client_id: client.id,
    email,
    name,
    status: 'subscribed',
    source: 'woocommerce',
  }));

  // Insere em lotes, ignorando quem ja existe (preserva status atual).
  let affected = 0;
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error, count } = await supabase
      .from('contacts')
      .upsert(chunk, { onConflict: 'client_id,email', ignoreDuplicates: true, count: 'exact' });
    if (error) {
      return c.json(
        { error: 'Erro ao gravar contatos.', detail: error.message, affectedSoFar: affected },
        500
      );
    }
    affected += count ?? 0;
  }

  const hasMore = !reachedEnd;
  return c.json({
    ok: true,
    pagesProcessed,
    uniqueEmailsThisRun: records.length,
    inserted: affected,
    hasMore,
    nextStartPage: hasMore ? page : null,
  });
});

// Descadastro: GET /api/unsubscribe?e=email&t=token  (link do rodape do e-mail)
app.get('/unsubscribe', async (c) => {
  const email = (c.req.query('e') || '').toLowerCase().trim();
  const token = c.req.query('t') || '';
  const page = (titulo: string, msg: string) =>
    c.html(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
       <body style="font-family:Arial,sans-serif;background:#f4f1ee;margin:0">
         <div style="max-width:460px;margin:60px auto;background:#fff;border-radius:16px;padding:40px 28px;text-align:center">
           <h2 style="color:#354734;margin:0 0 12px">${titulo}</h2>
           <p style="color:#555;font-size:15px;line-height:1.5;margin:0">${msg}</p>
         </div>
       </body></html>`
    );

  if (!email || !verifyEmail(email, token)) {
    return page('Link inválido', 'Este link de descadastro não é válido. Se precisar, responda o e-mail que a gente resolve.');
  }

  try {
    const supabase = getSupabase();
    const { data: client } = await supabase.from('clients').select('id').eq('slug', 'adoratta').single();
    if (client) {
      await supabase.from('contacts').update({ status: 'unsubscribed' })
        .eq('client_id', client.id).eq('email', email);
      await supabase.from('suppressions')
        .upsert({ client_id: client.id, email, reason: 'unsubscribe' },
                { onConflict: 'client_id,email', ignoreDuplicates: true });
    }
  } catch (_e) {
    // mesmo se der erro no banco, mostra a confirmacao pro usuario (reprocessa depois)
  }

  return page('Pronto! 💜', 'Você foi descadastrado e não receberá mais estes e-mails. Sentiremos sua falta!');
});

// Campanha de TESTE: POST /api/campaigns/test?token=XXX  { "to": "voce@email.com", "intro"?, "subject"?, "limit"? }
// Monta o e-mail real com os produtos em destaque e manda pra UM endereco.
app.post('/campaigns/test', async (c) => {
  const token = c.req.query('token') || c.req.header('x-import-token');
  if (!process.env.IMPORT_TOKEN || token !== process.env.IMPORT_TOKEN) {
    return c.json({ error: 'Nao autorizado (token invalido).' }, 401);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const to = (body?.to ?? '').trim();
  if (!to) return c.json({ error: 'Faltou o campo "to".' }, 400);

  const intro = body?.intro || 'Separamos uns queridinhos que a gente sabe que você vai amar 🩷';
  const subject = body?.subject || 'Novidades que você vai amar 🩷';
  // 4 novidades + 4 mais vendidos, mesclados (pode sobrescrever no body)
  const newCount = Math.min(Math.max(Number(body?.newCount || 4), 1), 8);
  const bestCount = Math.min(Math.max(Number(body?.bestCount || 4), 1), 8);

  const supabase = getSupabase();
  const { data: client, error } = await supabase.from('clients').select('*').eq('slug', 'adoratta').single();
  if (error || !client) return c.json({ error: 'Cliente "adoratta" nao encontrado.', detail: error?.message }, 500);

  let products;
  try {
    products = await fetchCampaignProducts(newCount, bestCount);
  } catch (e: any) {
    return c.json({ error: 'Erro ao buscar produtos no WooCommerce.', detail: String(e?.message ?? e) }, 502);
  }
  if (!products.length) return c.json({ error: 'Nenhum produto encontrado na loja.' }, 404);

  const origin = new URL(c.req.url).origin;
  const html = renderCampaignHtml({
    storeName: client.from_name,
    storeUrl: process.env.WOO_URL || 'https://adorattab.com.br',
    intro,
    products,
    unsubscribeUrl: unsubUrl(origin, to),
  });

  try {
    const messageId = await sendEmail({
      to,
      fromName: client.from_name,
      fromEmail: client.from_email,
      replyTo: client.reply_to,
      subject,
      html,
    });
    return c.json({ ok: true, messageId, productsUsed: products.length, sentTo: to });
  } catch (e: any) {
    return c.json({ error: 'Falha ao enviar pelo SES.', detail: String(e?.message ?? e) }, 500);
  }
});

// Verifica o token de admin (query ?token= ou header x-import-token).
function authOk(c: any): boolean {
  const token = c.req.query('token') || c.req.header('x-import-token');
  return !!process.env.IMPORT_TOKEN && token === process.env.IMPORT_TOKEN;
}

async function cnt(q: any): Promise<number> {
  const { count, error } = await q;
  return error ? 0 : count || 0;
}

// PAINEL: GET /api/admin  (pagina HTML; a propria pagina pede o token)
app.get('/admin', (c) => c.html(ADMIN_HTML));

// ESTATISTICAS: GET /api/stats?token=XXX
app.get('/stats', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const supabase = getSupabase();
  const { data: client } = await supabase.from('clients').select('id').eq('slug', 'adoratta').single();
  if (!client) return c.json({ error: 'Cliente nao encontrado.' }, 500);
  const cid = client.id;
  const total = await cnt(supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('client_id', cid));
  const subscribed = await cnt(supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('client_id', cid).eq('status', 'subscribed'));
  const unsubscribed = await cnt(supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('client_id', cid).eq('status', 'unsubscribed'));
  const suppressed = await cnt(supabase.from('suppressions').select('*', { count: 'exact', head: true }).eq('client_id', cid));
  return c.json({ ok: true, total, subscribed, unsubscribed, suppressed });
});

// LISTAR CAMPANHAS: GET /api/campaigns?token=XXX
app.get('/campaigns', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const supabase = getSupabase();
  const { data: client } = await supabase.from('clients').select('id').eq('slug', 'adoratta').single();
  if (!client) return c.json({ error: 'Cliente nao encontrado.' }, 500);
  const { data } = await supabase
    .from('campaigns')
    .select('id,subject,status,sent_at,created_at')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const subscribed = await cnt(
    supabase.from('contacts').select('*', { count: 'exact', head: true })
      .eq('client_id', client.id).eq('status', 'subscribed')
  );

  const campaigns = [];
  for (const camp of data || []) {
    const sent = await cnt(
      supabase.from('campaign_sends').select('*', { count: 'exact', head: true }).eq('campaign_id', camp.id)
    );
    campaigns.push({ ...camp, sent });
  }
  return c.json({ ok: true, campaigns, subscribed });
});

// LISTAR CONTATOS: GET /api/contacts?token=XXX&status=subscribed|unsubscribed|all&limit&offset
app.get('/contacts', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const status = c.req.query('status') || 'all';
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 500), 1), 1000);
  const offset = Math.max(Number(c.req.query('offset') || 0), 0);
  const supabase = getSupabase();
  const { data: client } = await supabase.from('clients').select('id').eq('slug', 'adoratta').single();
  if (!client) return c.json({ error: 'Cliente nao encontrado.' }, 500);

  let q = supabase.from('contacts')
    .select('email,name,status,source,created_at')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status !== 'all') q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, contacts: data || [], count: (data || []).length });
});

// LISTAR SUPRESSOES: GET /api/suppressions?token=XXX
app.get('/suppressions', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 500), 1), 1000);
  const offset = Math.max(Number(c.req.query('offset') || 0), 0);
  const supabase = getSupabase();
  const { data: client } = await supabase.from('clients').select('id').eq('slug', 'adoratta').single();
  if (!client) return c.json({ error: 'Cliente nao encontrado.' }, 500);
  const { data, error } = await supabase.from('suppressions')
    .select('email,reason,created_at')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ ok: true, suppressions: data || [] });
});

// PRA QUEM FOI ENVIADO: GET /api/campaigns/:id/recipients?token=XXX&limit&offset
app.get('/campaigns/:id/recipients', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const id = c.req.param('id');
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 500), 1), 1000);
  const offset = Math.max(Number(c.req.query('offset') || 0), 0);
  const supabase = getSupabase();
  const { data, error } = await supabase.from('campaign_sends')
    .select('status,opened_at,clicked_at,sent_at,contacts(email,name)')
    .eq('campaign_id', id)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (error) return c.json({ error: error.message }, 500);
  const recipients = (data || []).map((r: any) => ({
    email: r.contacts?.email || '',
    name: r.contacts?.name || '',
    status: r.status,
    opened: !!r.opened_at,
    clicked: !!r.clicked_at,
    sent_at: r.sent_at,
  }));
  return c.json({ ok: true, recipients });
});

// ----------------------------------------------------------------
// CRIAR CAMPANHA: POST /api/campaigns?token=XXX
// body: { subject, intro?, newCount?, bestCount? }
// Congela os produtos (4+4) no momento da criacao.
// ----------------------------------------------------------------
app.post('/campaigns', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const body = await c.req.json().catch(() => ({} as any));
  const subject = (body?.subject ?? '').trim() || 'Novidades que você vai amar 🩷';
  const intro = body?.intro || 'Separamos uns queridinhos que a gente sabe que você vai amar 🩷';
  const newCount = Math.min(Math.max(Number(body?.newCount || 4), 1), 8);
  const bestCount = Math.min(Math.max(Number(body?.bestCount || 4), 1), 8);

  const supabase = getSupabase();
  const { data: client, error: cErr } = await supabase.from('clients').select('*').eq('slug', 'adoratta').single();
  if (cErr || !client) return c.json({ error: 'Cliente "adoratta" nao encontrado.' }, 500);

  let products;
  try {
    products = await fetchCampaignProducts(newCount, bestCount);
  } catch (e: any) {
    return c.json({ error: 'Erro ao buscar produtos.', detail: String(e?.message ?? e) }, 502);
  }
  if (!products.length) return c.json({ error: 'Nenhum produto encontrado.' }, 404);

  const { data: camp, error: insErr } = await supabase
    .from('campaigns')
    .insert({
      client_id: client.id,
      name: subject,
      subject,
      intro,
      products,
      from_name: client.from_name,
      from_email: client.from_email,
      status: 'sending',
    })
    .select('id')
    .single();
  if (insErr || !camp) return c.json({ error: 'Erro ao criar campanha.', detail: insErr?.message }, 500);

  return c.json({ ok: true, campaignId: camp.id, productsUsed: products.length });
});

// ----------------------------------------------------------------
// ENVIAR LOTE: POST /api/campaigns/:id/send-batch?token=XXX&limit=200
// Manda ate "limit" e-mails pra quem ainda nao recebeu essa campanha.
// Chame todo dia (subindo o limit) pro aquecimento.
// ----------------------------------------------------------------
app.post('/campaigns/:id/send-batch', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const id = c.req.param('id');
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 200), 1), 1000);
  const origin = new URL(c.req.url).origin;
  const supabase = getSupabase();

  const { data: camp, error: cErr } = await supabase.from('campaigns').select('*').eq('id', id).single();
  if (cErr || !camp) return c.json({ error: 'Campanha nao encontrada.' }, 404);

  // contatos inscritos do cliente (paginando pra pegar TODOS)
  const contacts = await fetchAll<{ id: string; email: string; name: string | null }>((f, t) =>
    supabase.from('contacts').select('id,email,name')
      .eq('client_id', camp.client_id).eq('status', 'subscribed').range(f, t)
  );
  const already = await fetchAll<{ contact_id: string }>((f, t) =>
    supabase.from('campaign_sends').select('contact_id').eq('campaign_id', id).range(f, t)
  );
  const supp = await fetchAll<{ email: string }>((f, t) =>
    supabase.from('suppressions').select('email').eq('client_id', camp.client_id).range(f, t)
  );

  const sentSet = new Set(already.map((r) => r.contact_id));
  const suppSet = new Set(supp.map((r) => String(r.email).toLowerCase()));
  const todoAll = contacts.filter((ct) => !sentSet.has(ct.id) && !suppSet.has(String(ct.email).toLowerCase()));
  const batch = todoAll.slice(0, limit);

  // Busca os produtos NA HORA (sempre atuais, só em estoque). Se a loja falhar,
  // cai pro snapshot salvo na criação da campanha.
  let products: any[] = [];
  try {
    products = await fetchCampaignProducts(4, 4);
  } catch (_e) { /* usa o fallback abaixo */ }
  if (!products.length) {
    products = Array.isArray(camp.products) ? camp.products : [];
  }
  let sent = 0;
  let failed = 0;

  await runPool(batch, 5, async (ct) => {
    // cria o registro do envio pra ter um id (usado no rastreio)
    const { data: sendRow, error: sErr } = await supabase
      .from('campaign_sends')
      .insert({ campaign_id: id, contact_id: ct.id, status: 'queued' })
      .select('id')
      .single();
    if (sErr || !sendRow) { failed++; return; }

    const sendId = sendRow.id;
    const openPixelUrl = `${origin}/api/o/${sendId}.gif`;
    const linkWrapper = (url: string) =>
      `${origin}/api/c/${sendId}?u=${encodeURIComponent(addUtm(url, String(id)))}`;

    const html = renderCampaignHtml({
      storeName: camp.from_name,
      storeUrl: process.env.WOO_URL || 'https://adorattab.com.br',
      intro: camp.intro || '',
      products,
      unsubscribeUrl: unsubUrl(origin, ct.email),
      openPixelUrl,
      linkWrapper,
    });

    try {
      const messageId = await sendEmail({
        to: ct.email,
        fromName: camp.from_name,
        fromEmail: camp.from_email,
        replyTo: null,
        subject: camp.subject,
        html,
      });
      await supabase.from('campaign_sends')
        .update({ status: 'sent', ses_message_id: messageId ?? null, sent_at: new Date().toISOString() })
        .eq('id', sendId);
      sent++;
    } catch (_e) {
      await supabase.from('campaign_sends').update({ status: 'failed' }).eq('id', sendId);
      failed++;
    }
  });

  if (!camp.sent_at && sent > 0) {
    await supabase.from('campaigns').update({ sent_at: new Date().toISOString() }).eq('id', id);
  }

  // Copia de monitoramento: manda o mesmo e-mail pro MONITOR_EMAIL (pra voce
  // acompanhar como esta chegando). Nao conta nas metricas.
  let monitorSent = false;
  const monitor = (process.env.MONITOR_EMAIL || '').trim();
  if (monitor && sent > 0) {
    try {
      const html = renderCampaignHtml({
        storeName: camp.from_name,
        storeUrl: process.env.WOO_URL || 'https://adorattab.com.br',
        intro: camp.intro || '',
        products,
        unsubscribeUrl: unsubUrl(origin, monitor),
      });
      await sendEmail({
        to: monitor,
        fromName: camp.from_name,
        fromEmail: camp.from_email,
        replyTo: null,
        subject: '[cópia] ' + camp.subject,
        html,
      });
      monitorSent = true;
    } catch (_e) { /* copia e best-effort */ }
  }

  const remaining = todoAll.length - batch.length;
  return c.json({ ok: true, campaignId: id, sentThisRun: sent, failed, remaining, monitorSent });
});

// ----------------------------------------------------------------
// PIXEL DE ABERTURA: GET /api/o/:id.gif  (publico, chamado pelo e-mail)
// ----------------------------------------------------------------
app.get('/o/:id', async (c) => {
  const raw = c.req.param('id') || '';
  const sendId = raw.replace(/\.gif$/i, '');
  try {
    const supabase = getSupabase();
    const { data: s } = await supabase
      .from('campaign_sends').select('id,campaign_id,contact_id,opened_at').eq('id', sendId).single();
    if (s) {
      if (!s.opened_at) {
        await supabase.from('campaign_sends').update({ opened_at: new Date().toISOString() }).eq('id', sendId);
      }
      await supabase.from('events').insert({
        send_id: s.id, contact_id: s.contact_id, campaign_id: s.campaign_id, type: 'open',
      });
    }
  } catch (_e) { /* nunca quebra o pixel */ }

  return c.body(PIXEL_GIF, 200, {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  });
});

// ----------------------------------------------------------------
// CLIQUE: GET /api/c/:id?u=<url>  (publico) -> registra e redireciona
// ----------------------------------------------------------------
app.get('/c/:id', async (c) => {
  const sendId = c.req.param('id') || '';
  const dest = c.req.query('u') || process.env.WOO_URL || 'https://adorattab.com.br';
  try {
    const supabase = getSupabase();
    const { data: s } = await supabase
      .from('campaign_sends').select('id,campaign_id,contact_id,clicked_at').eq('id', sendId).single();
    if (s) {
      if (!s.clicked_at) {
        await supabase.from('campaign_sends').update({ clicked_at: new Date().toISOString() }).eq('id', sendId);
      }
      await supabase.from('events').insert({
        send_id: s.id, contact_id: s.contact_id, campaign_id: s.campaign_id, type: 'click', url: dest,
      });
    }
  } catch (_e) { /* nunca quebra o redirect */ }

  return c.redirect(dest, 302);
});

// ----------------------------------------------------------------
// RELATORIO: GET /api/campaigns/:id/report?token=XXX
// Cruza os pedidos feitos depois do envio (por email) com quem recebeu.
// ----------------------------------------------------------------
app.get('/campaigns/:id/report', async (c) => {
  if (!authOk(c)) return c.json({ error: 'Nao autorizado.' }, 401);
  const id = c.req.param('id');
  const supabase = getSupabase();

  const { data: camp, error: cErr } = await supabase.from('campaigns').select('*').eq('id', id).single();
  if (cErr || !camp) return c.json({ error: 'Campanha nao encontrada.' }, 404);

  // metricas de envio (paginando pra pegar TODOS)
  const rows = await fetchAll<{ contact_id: string; status: string; opened_at: string | null; clicked_at: string | null }>(
    (f, t) =>
      supabase.from('campaign_sends')
        .select('contact_id,status,opened_at,clicked_at')
        .eq('campaign_id', id).range(f, t)
  );
  const delivered = rows.filter((r) => r.status === 'sent').length;
  const opens = rows.filter((r) => r.opened_at).length;
  const clicks = rows.filter((r) => r.clicked_at).length;

  // ATRIBUICAO REAL: so conta compra de quem CLICOU no e-mail (quem clicou no
  // link rastreado veio pra loja pelo e-mail e leva utm_source=email, batendo
  // com a origem "email" do WooCommerce). Cliente que comprou por conta propria
  // (sem clicar) NAO entra, pra nao superestimar.
  const contactIds = rows.filter((r) => r.clicked_at).map((r) => r.contact_id);
  const emailSet = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 500) {
    const chunk = contactIds.slice(i, i + 500);
    const { data: cts } = await supabase.from('contacts').select('email').in('id', chunk);
    for (const ct of cts || []) emailSet.add(String(ct.email).toLowerCase());
  }

  // pedidos feitos depois do envio
  const since = camp.sent_at || camp.created_at;
  const buyers = new Map<string, number>();
  let revenue = 0;
  let orders = 0;
  if (hasWooEnv() && since) {
    try {
      let page = 1;
      for (let guard = 0; guard < 30; guard++, page++) {
        const list = await fetchOrdersAfter(since, page, 100);
        for (const o of list) {
          if (o.email && emailSet.has(o.email)) {
            orders++;
            revenue += o.total;
            buyers.set(o.email, (buyers.get(o.email) || 0) + o.total);
          }
        }
        if (list.length < 100) break;
      }
    } catch (_e) { /* se a loja falhar, devolve so as metricas de envio */ }
  }

  return c.json({
    ok: true,
    campaignId: id,
    subject: camp.subject,
    sentAt: camp.sent_at,
    recipients: rows.length,
    delivered,
    opens,
    clicks,
    openRate: delivered ? +(opens / delivered * 100).toFixed(1) : 0,
    clickRate: delivered ? +(clicks / delivered * 100).toFixed(1) : 0,
    buyers: buyers.size,
    orders,
    revenue: +revenue.toFixed(2),
    attribution: 'click', // compras atribuidas = clicaram no e-mail e compraram
    topBuyers: Array.from(buyers.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([email, total]) => ({ email, total: +total.toFixed(2) })),
  });
});

export default handle(app);
