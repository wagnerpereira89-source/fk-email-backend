// Envio de e-mail pela API do Amazon SES (v2).
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({
  region: process.env.SES_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.SES_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.SES_SECRET_ACCESS_KEY ?? '',
  },
});

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
  const cmd = new SendEmailCommand({
    FromEmailAddress: `${args.fromName} <${args.fromEmail}>`,
    Destination: { ToAddresses: [args.to] },
    ReplyToAddresses: args.replyTo ? [args.replyTo] : undefined,
    Content: {
      Simple: {
        Subject: { Data: args.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: args.html, Charset: 'UTF-8' },
        },
      },
    },
  });

  const res = await ses.send(cmd);
  return res.MessageId;
}
