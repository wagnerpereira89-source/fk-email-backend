// Integracao com a API REST do WooCommerce.
// Usado pra importar contatos (e-mail + nome) a partir dos pedidos da loja.

export interface WooContact {
  email: string;
  name: string | null;
}

function wooAuthHeader(): string {
  const ck = process.env.WOO_CK || '';
  const cs = process.env.WOO_CS || '';
  return 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64');
}

export function hasWooEnv(): boolean {
  return !!process.env.WOO_URL && !!process.env.WOO_CK && !!process.env.WOO_CS;
}

// Busca uma pagina de pedidos e extrai email + primeiro nome do billing.
// Retorna [] quando nao houver mais pedidos.
export async function fetchOrdersPage(page: number, perPage: number): Promise<WooContact[]> {
  const base = (process.env.WOO_URL || '').replace(/\/+$/, '');
  const url =
    `${base}/wp-json/wc/v3/orders` +
    `?per_page=${perPage}&page=${page}&status=any&orderby=id&order=asc`;

  const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`WooCommerce respondeu ${res.status}: ${txt.slice(0, 200)}`);
  }

  const orders = (await res.json()) as any[];
  const out: WooContact[] = [];
  for (const o of orders) {
    const email = String(o?.billing?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) continue;
    const name = String(o?.billing?.first_name || '').trim() || null;
    out.push({ email, name });
  }
  return out;
}

// ---------------------------------------------------------------
// PRODUTOS (pra montar o e-mail)
// ---------------------------------------------------------------
export interface WooProduct {
  id: number;
  name: string;
  permalink: string;
  image: string | null;
  price: string;              // ex: "37.50"
  regularPrice: string | null; // preenchido quando em promocao
  onSale: boolean;
}

async function wooGet(qs: string): Promise<any[]> {
  const base = (process.env.WOO_URL || '').replace(/\/+$/, '');
  const res = await fetch(`${base}/wp-json/wc/v3/products?${qs}`, {
    headers: { Authorization: wooAuthHeader() },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`WooCommerce respondeu ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as any[];
}

// Busca produtos em DESTAQUE (featured). Se nao houver, cai pros mais populares.
export async function fetchFeaturedProducts(limit: number): Promise<WooProduct[]> {
  let list = await wooGet(`featured=true&status=publish&per_page=${limit}&orderby=date&order=desc`);
  if (!list.length) {
    list = await wooGet(`status=publish&per_page=${limit}&orderby=popularity&order=desc`);
  }
  return list.map((p) => ({
    id: Number(p.id),
    name: String(p.name || ''),
    permalink: String(p.permalink || ''),
    image: p?.images?.[0]?.src ? String(p.images[0].src) : null,
    price: String(p.price || p.regular_price || ''),
    regularPrice: p.on_sale && p.regular_price ? String(p.regular_price) : null,
    onSale: !!p.on_sale,
  }));
}

function mapProduct(p: any): WooProduct {
  return {
    id: Number(p.id),
    name: String(p.name || ''),
    permalink: String(p.permalink || ''),
    image: p?.images?.[0]?.src ? String(p.images[0].src) : null,
    price: String(p.price || p.regular_price || ''),
    regularPrice: p.on_sale && p.regular_price ? String(p.regular_price) : null,
    onSale: !!p.on_sale,
  };
}

// Só entra produto publicado, EM ESTOQUE (com quantidade > 0 quando gerencia
// estoque) e visível no catálogo.
function produtoOk(p: any): boolean {
  const vis = String(p?.catalog_visibility || 'visible');
  const visivel = vis === 'visible' || vis === 'catalog';
  if (!visivel) return false;
  if (String(p?.stock_status || 'instock') !== 'instock') return false;
  // se o produto gerencia estoque e a quantidade é 0 ou menos, fora
  if (p?.manage_stock && p?.stock_quantity != null && Number(p.stock_quantity) <= 0) return false;
  return true;
}

// Retorna só os ÚLTIMOS PRODUTOS CADASTRADOS (novidades), em estoque e visíveis.
// A assinatura (newCount, bestCount) é mantida; o total enviado = newCount + bestCount.
// Busca bem mais que o necessário e corta, pra garantir a quantidade após o filtro.
export async function fetchCampaignProducts(newCount: number, bestCount: number): Promise<WooProduct[]> {
  const total = Math.max(1, newCount + bestCount);
  const fetchN = Math.min(total * 3 + 10, 100);
  const raw = await wooGet(`status=publish&stock_status=instock&per_page=${fetchN}&orderby=date&order=desc`);
  return raw.filter(produtoOk).slice(0, total).map(mapProduct);
}

export interface WooOrder {
  id: number;
  email: string;
  total: number;
  createdAt: string;
}

// Busca uma pagina de pedidos criados DEPOIS de uma data (ISO), pro relatorio de conversao.
export async function fetchOrdersAfter(afterISO: string, page: number, perPage: number): Promise<WooOrder[]> {
  const base = (process.env.WOO_URL || '').replace(/\/+$/, '');
  const url =
    `${base}/wp-json/wc/v3/orders` +
    `?after=${encodeURIComponent(afterISO)}&per_page=${perPage}&page=${page}&status=any&orderby=date&order=asc`;
  const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`WooCommerce respondeu ${res.status}: ${t.slice(0, 200)}`);
  }
  const orders = (await res.json()) as any[];
  return orders.map((o) => ({
    id: Number(o.id),
    email: String(o?.billing?.email || '').trim().toLowerCase(),
    total: Number(o?.total || 0),
    createdAt: String(o?.date_created || ''),
  }));
}
