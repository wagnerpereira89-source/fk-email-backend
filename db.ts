// Cliente do Supabase (service_role / secret key).
// Criado de forma PREGUICOSA: so instancia na primeira vez que for usado.
// Assim, se faltar variavel de ambiente, nao derruba a funcao inteira no load.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Faltam variaveis SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.'
    );
  }
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

export function hasSupabaseEnv(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// O Supabase retorna no maximo 1000 linhas por consulta. Esta funcao pagina
// com .range() ate trazer TODAS as linhas. Passe uma funcao que monta a query
// ja com .range(from, to).
export async function fetchAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const size = 1000;
  let from = 0;
  const out: T[] = [];
  // trava de seguranca pra nunca entrar em loop infinito
  for (let guard = 0; guard < 1000; guard++) {
    const { data, error } = await make(from, from + size - 1);
    if (error) throw new Error(error.message || String(error));
    const rows = data || [];
    out.push(...rows);
    if (rows.length < size) break;
    from += size;
  }
  return out;
}
