// Envio de e-mail pela API do Amazon SES (v2).
// Cliente criado de forma PREGUICOSA (so na primeira chamada), igual ao db.ts.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

let _ses: SESv2Client | null = null;

function getSes(): SESv2Client {
  if (_ses) return _ses;
  const accessKeyId = process.env.SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Faltam variaveis SES_ACCESS_KEY_ID e/ou SES_SECRET_ACCESS_KEY no ambiente.'
    );
  }
  _ses = new SESv2Client({
    region: process.env.SES_REGION || 'us-east-2',
    credentials: { accessKeyId, secretAccessKey },
  });
  return _ses;
}

export function hasSesEnv(): boolean {
  return !!process.env.SES_ACCESS_KEY_ID && !!process.env.SES_SECRET_ACCESS_KEY;
}

export interface SendArgs {
  to: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  html: string;
  replyTo?: string | null;
}

// Retorna o MessageId do SES (serve pra casar com os eventos de bounce/entrega depois).
export async function sendEmail(args: SendArgs): Promise<string | undefined> {
  const ses = getSes();
  const cmd = new SendEmailCommand({
    FromEmailAddress: `${args.fromName} <${args.fromEmail}>`,
    Destination: { ToAddresses: [args.to] },
    ReplyToAddresses: args.replyTo ? [args.replyTo] : undefined,
    Content: {
      Simple: {
        Subject: { Data: args.subject, Charset: 'UTF-8' },
        Body: { Html: { Data: args.html, Charset: 'UTF-8' } },
      },
    },
  });
  const res = await ses.send(cmd);
  return res.MessageId;
}
