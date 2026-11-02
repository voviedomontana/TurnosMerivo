import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { AccessError } from "./service";

// This client is exclusively for Auth Admin, never business tables or RPC.
export function authAdminClient() {
  const config = getSupabaseConfig();
  const key = process.env.SUPABASE_AUTH_ADMIN_KEY;
  if (!config || !key) throw new AccessError("UNAVAILABLE", 503);
  return createClient(config.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }).auth.admin;
}
