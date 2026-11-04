// Entrada do backend (Hono rodando como Serverless Function na Vercel).
import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { supabase } from '../src/db';
import { sendEmail } from '../src/ses';

export const config = { runtime: 'nodejs' };

const app = new Hono().basePath('/api');

// Saude do servico: GET /api/health
app.get('/health', (c) =>
  c.json({ ok: true, service: 'fk-email-backend', version: '0.1.0' })
);

// Envio de teste de ponta a ponta: POST /api/test-send  { "to": "voce@email.com" }
// Usa os dados do cliente "adoratta" (from_name, from_email, reply_to) do Supabase.
app.post('/test-send', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const to = (body?.to ?? '').trim();
  if (!to) {
    return c.json({ error: 'Faltou o campo "to" (e-mail de destino).' }, 400);
  }

  // Busca o cliente Adoratta no banco.
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('slug', 'adoratta')
    .single();

  if (error || !client) {
    return c.json(
      { error: 'Cliente "adoratta" nao encontrado no banco.', detail: error?.message },
      500
    );
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

export default handle(app);
