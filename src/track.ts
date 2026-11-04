// Helpers de rastreio: pixel de abertura (gif 1x1) e UTM nos links.

// GIF transparente 1x1 (pra contar abertura).
export const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Adiciona UTM no link do produto, pra loja atribuir o pedido ao e-mail.
export function addUtm(url: string, campaignId: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'email');
    u.searchParams.set('utm_medium', 'campaign');
    u.searchParams.set('utm_campaign', campaignId);
    return u.toString();
  } catch {
    return url;
  }
}

// Roda tarefas com limite de simultaneidade (pra nao estourar o tempo/limite do SES).
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}
