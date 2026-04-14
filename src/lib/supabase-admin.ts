import "server-only";
import { createClient } from "@supabase/supabase-js";

type GenericRow = Record<string, unknown>;
type GenericDatabase = {
  public: {
    Tables: Record<
      string,
      {
        Row: GenericRow;
        Insert: GenericRow;
        Update: GenericRow;
        Relationships: [];
      }
    >;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
};

type AdminClient = ReturnType<typeof createClient<GenericDatabase>>;

let cachedAdminClient: AdminClient | null = null;

export function supabaseAdmin(): AdminClient {
  if (cachedAdminClient) return cachedAdminClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL.");
  }

  // We use the admin client only on the server to bypass broken RLS recursion paths.
  cachedAdminClient = createClient<GenericDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedAdminClient;
}
