// Supabase Edge Function: create-transaction
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

type Payload = {
  account_id?: string;
  amount?: number;
  type?: "expense" | "income";
  category?: string;
  description?: string;
  date?: string;
  split_details?: Record<string, number>;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return new Response("Missing Bearer token", { status: 401 });

  const payload = (await req.json().catch(() => null)) as Payload | null;
  if (!payload) return new Response("Invalid JSON", { status: 400 });

  const { account_id, amount, type, category, description, date, split_details } = payload;
  if (!account_id || amount === undefined || !type || !category || !date) {
    return new Response("Missing fields", { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return new Response("Invalid token", { status: 401 });

  const { data: membership } = await supabase
    .from("account_members")
    .select("id")
    .eq("account_id", account_id)
    .single();

  if (!membership) return new Response("Not a member of this account", { status: 403 });

  const { error } = await supabase.from("transactions").insert({
    account_id,
    amount,
    type,
    category,
    description,
    date,
    split_details,
    user_id: userData.user.id,
  });

  if (error) return new Response(error.message, { status: 400 });

  return new Response("Created", { status: 201 });
});
