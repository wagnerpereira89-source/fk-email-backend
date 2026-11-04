// Entrada do backend (Hono rodando como Serverless Function na Vercel).
import { Hono } from 'hono';
import { handle } from '@hono/node-server/vercel';
import { getSupabase, hasSupabaseEnv } from '../src/db.js';
import { sendEmail, hasSesEnv } from '../src/ses.js';
import { fetchOrdersPage, hasWooEnv } from '../src/woo.js';

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
    version: '0.1.4',
    env: {
      supabase: hasSupabaseEnv(),
      ses: hasSesEnv(),
      sesRegion: process.env.SES_REGION || '(default) us-east-2',
      woo: hasWooEnv(),
      importToken: !!process.env.IMPORT_TOKEN,
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

export default handle(app);
