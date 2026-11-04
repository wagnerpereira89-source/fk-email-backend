// Cliente do Supabase usando a service_role key.
// A service_role ignora o RLS, entao SO o backend usa ela (nunca o frontend).
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  // Em runtime na Vercel isso avisa cedo se faltou configurar as envs.
  console.warn('[fk-email] Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(url ?? '', key ?? '', {
  auth: { persistSession: false },
});
