// Monta o HTML do e-mail de campanha (grade de produtos).
// Usa tabelas e estilo inline, que e o que funciona bem em cliente de e-mail.
import type { WooProduct } from './woo.js';

function formatBRL(v: string): string {
  const n = Number(v);
  if (!isFinite(n) || !v) return '';
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

function productCell(p: WooProduct): string {
  const img = p.image || 'https://via.placeholder.com/280x350?text=Produto';
  const priceNow = formatBRL(p.price);
  const priceOld = p.onSale && p.regularPrice ? formatBRL(p.regularPrice) : '';
  return `
  <td width="50%" valign="top" style="padding:10px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td>
        <a href="${p.permalink}" style="text-decoration:none;color:inherit">
          <img src="${img}" width="100%" alt="${p.name}"
               style="display:block;border-radius:12px;width:100%;max-width:280px;height:auto;margin:0 auto" />
        </a>
      </td></tr>
      <tr><td style="padding:10px 4px 0;text-align:center;font-family:Arial,Helvetica,sans-serif">
        <div style="font-size:14px;font-weight:600;color:#222;line-height:1.3">${p.name}</div>
        <div style="margin-top:4px;font-size:15px">
          ${priceOld ? `<span style="color:#999;text-decoration:line-through;font-size:13px;margin-right:6px">${priceOld}</span>` : ''}
          <span style="color:#111;font-weight:700">${priceNow}</span>
        </div>
        <a href="${p.permalink}"
           style="display:inline-block;margin-top:10px;background:#354734;color:#fff;
                  text-decoration:none;font-weight:700;font-size:13px;padding:9px 20px;border-radius:8px">
          Comprar
        </a>
      </td></tr>
    </table>
  </td>`;
}

export interface CampaignArgs {
  storeName: string;
  storeUrl: string;
  intro: string;
  products: WooProduct[];
  unsubscribeUrl: string;
}

export function renderCampaignHtml(a: CampaignArgs): string {
  // monta as linhas de 2 em 2 produtos
  const rows: string[] = [];
  for (let i = 0; i < a.products.length; i += 2) {
    const left = productCell(a.products[i]);
    const right = a.products[i + 1]
      ? productCell(a.products[i + 1])
      : '<td width="50%"></td>';
    rows.push(`<tr>${left}${right}</tr>`);
  }

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f1ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ee">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden">

        <!-- cabecalho -->
        <tr><td style="background:#354734;padding:22px;text-align:center">
          <a href="${a.storeUrl}" style="color:#fff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;letter-spacing:.5px">
            ${a.storeName}
          </a>
        </td></tr>

        <!-- intro -->
        <tr><td style="padding:26px 24px 6px;text-align:center;font-family:Arial,Helvetica,sans-serif">
          <p style="margin:0;font-size:17px;color:#333;line-height:1.5">${a.intro}</p>
        </td></tr>

        <!-- grade de produtos -->
        <tr><td style="padding:10px 14px 6px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rows.join('\n')}
          </table>
        </td></tr>

        <!-- CTA geral -->
        <tr><td style="padding:12px 24px 28px;text-align:center">
          <a href="${a.storeUrl}"
             style="display:inline-block;background:#354734;color:#fff;text-decoration:none;
                    font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:15px;
                    padding:13px 34px;border-radius:8px">
            Ver a loja completa
          </a>
        </td></tr>

        <!-- rodape -->
        <tr><td style="padding:20px 24px;background:#faf8f6;text-align:center;font-family:Arial,Helvetica,sans-serif">
          <p style="margin:0 0 6px;font-size:12px;color:#999">
            Você recebeu este e-mail porque é cliente da ${a.storeName}.
          </p>
          <p style="margin:0;font-size:12px;color:#999">
            <a href="${a.unsubscribeUrl}" style="color:#999;text-decoration:underline">
              Não quero mais receber estes e-mails
            </a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
