// Assinatura simples (HMAC) pro link de descadastro, pra ninguem conseguir
// descadastrar terceiros chutando a URL. Usa o IMPORT_TOKEN como chave.
import { createHmac } from 'crypto';

function secret(): string {
  return process.env.IMPORT_TOKEN || 'fk-dev-secret';
}

export function signEmail(email: string): string {
  return createHmac('sha256', secret())
    .update(email.toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

export function verifyEmail(email: string, token: string): boolean {
  const expected = signEmail(email);
  return token.length === expected.length && token === expected;
}

export function unsubUrl(origin: string, email: string): string {
  const e = encodeURIComponent(email);
  const t = signEmail(email);
  return `${origin}/api/unsubscribe?e=${e}&t=${t}`;
}
