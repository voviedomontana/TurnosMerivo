"use client";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

// UI authentication uses server-managed HttpOnly cookies, never browser SDK storage.
export function createBrowserSupabaseClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
