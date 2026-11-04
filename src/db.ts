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
