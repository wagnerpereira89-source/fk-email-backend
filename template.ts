// Monta o HTML do e-mail de campanha (grade de produtos).
// Usa tabelas e estilo inline, que e o que funciona bem em cliente de e-mail.
import type { WooProduct } from './woo.js';

const GREEN = '#354734';
const CREAM = '#fdf2ed';
const LOGO_URL = 'https://adorattab.com.br/wp-content/uploads/2026/05/LOGOTIPO-ADORATTA-SEM-FUNDO-19.png';
const FONT = "'Open Sans', Arial, Helvetica, sans-serif";

function formatBRL(v: string): string {
  const n = Number(v);
  if (!isFinite(n) || !v) return '';
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

type LinkWrapper = (url: string) => string;

function productCell(p: WooProduct, wrap: LinkWrapper): string {
  const img = p.image || 'https://via.placeholder.com/280x350?text=Produto';
  const priceNow = formatBRL(p.price);
  const priceOld = p.onSale && p.regularPrice ? formatBRL(p.regularPrice) : '';
  const link = wrap(p.permalink);
  return `
  <td width="50%" valign="top" style="padding:10px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td>
        <a href="${link}" style="text-decoration:none;color:inherit">
          <img src="${img}" width="100%" alt="${p.name}"
               style="display:block;border-radius:12px;width:100%;max-width:280px;height:auto;margin:0 auto" />
        </a>
      </td></tr>
      <tr><td style="padding:10px 4px 0;text-align:center;font-family:${FONT}">
        <div style="font-size:14px;font-weight:600;color:#222;line-height:1.3">${p.name}</div>
        <div style="margin-top:4px;font-size:15px">
          ${priceOld ? `<span style="color:#999;text-decoration:line-through;font-size:13px;margin-right:6px">${priceOld}</span>` : ''}
          <span style="color:#111;font-weight:700">${priceNow}</span>
        </div>
        <!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${GREEN}" style="border-radius:8px"><![endif]-->
        <a href="${link}"
           style="display:inline-block;margin-top:10px;background-color:${GREEN};color:#ffffff;
                  text-decoration:none;font-weight:700;font-size:13px;padding:9px 20px;border-radius:8px;font-family:${FONT}">
          Comprar
        </a>
        <!--[if mso]></td></tr></table><![endif]-->
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
  openPixelUrl?: string;        // se presente, adiciona o pixel de abertura
  linkWrapper?: LinkWrapper;    // envolve os links pro rastreio de clique (+ UTM)
}

export function renderCampaignHtml(a: CampaignArgs): string {
  const wrap: LinkWrapper = a.linkWrapper || ((u) => u);
  const storeLink = wrap(a.storeUrl);

  const rows: string[] = [];
  for (let i = 0; i < a.products.length; i += 2) {
    const left = productCell(a.products[i], wrap);
    const right = a.products[i + 1] ? productCell(a.products[i + 1], wrap) : '<td width="50%"></td>';
    rows.push(`<tr>${left}${right}</tr>`);
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light only" />
  <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    /* Dark mode do Outlook: mantem o verde, o branco de fora e o creme do template */
    [data-ogsc] .fk-bar, [data-ogsb] .fk-bar { background-color: ${GREEN} !important; }
    [data-ogsc] .fk-btn, [data-ogsb] .fk-btn { background-color: ${GREEN} !important; color:#ffffff !important; }
    [data-ogsc] body, [data-ogsb] body { background-color: #ffffff !important; }
    [data-ogsc] .fk-template, [data-ogsb] .fk-template { background-color: ${CREAM} !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff">
    <tr><td align="center" style="padding:0 0 24px">
      <table role="presentation" class="fk-template" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${CREAM}" style="max-width:600px;width:100%;background-color:${CREAM}">

        <!-- FAIXA: 20% OFF no Pix -->
        <tr><td class="fk-bar" bgcolor="${GREEN}" style="background-color:${GREEN};padding:12px;text-align:center">
          <span style="font-family:${FONT};color:#ffffff;font-size:13px;font-weight:700;letter-spacing:1px">
            20% OFF PAGANDO NO PIX
          </span>
        </td></tr>

        <!-- LOGO -->
        <tr><td style="padding:26px 20px 8px;text-align:center">
          <a href="${storeLink}">
            <img src="${LOGO_URL}" alt="${a.storeName}" width="220"
                 style="display:block;margin:0 auto;width:220px;max-width:42%;height:auto;border:0" />
          </a>
        </td></tr>

        <!-- INTRO -->
        <tr><td style="padding:10px 24px 6px;text-align:center;font-family:${FONT}">
          <p style="margin:0;font-size:17px;color:#444;line-height:1.5">${a.intro}</p>
        </td></tr>

        <!-- GRADE DE PRODUTOS -->
        <tr><td style="padding:10px 14px 6px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rows.join('\n')}
          </table>
        </td></tr>

        <!-- CTA GERAL -->
        <tr><td style="padding:14px 24px 28px;text-align:center">
          <!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${GREEN}" style="border-radius:8px"><![endif]-->
          <a href="${storeLink}" class="fk-btn"
             style="display:inline-block;background-color:${GREEN};color:#ffffff;text-decoration:none;
                    font-family:${FONT};font-weight:700;font-size:15px;padding:13px 34px;border-radius:8px">
            Ver a loja completa
          </a>
          <!--[if mso]></td></tr></table><![endif]-->
        </td></tr>

        <!-- RODAPE -->
        <tr><td style="padding:20px 24px 8px;text-align:center;font-family:${FONT}">
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
  ${a.openPixelUrl ? `<img src="${a.openPixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />` : ''}
</body>
</html>`;
}
