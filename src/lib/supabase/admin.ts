import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseAdminClient = SupabaseClient;

let cachedAdmin: SupabaseAdminClient | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getSupabaseAdmin() {
  if (!cachedAdmin) {
    cachedAdmin = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return cachedAdmin;
}
