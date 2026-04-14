"use server";
import { supabaseServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

async function findUserIdByEmail(email: string) {
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);

  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

export async function inviteMember(accountId: string, email: string) {
  const supabase = await supabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Not signed in");

  // verify owner
  const { data: membership } = await supabase
    .from("account_members")
    .select("role")
    .eq("account_id", accountId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (!membership || membership.role !== "owner") throw new Error("Only owners can invite");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  const admin = createClient(supabaseUrl, serviceKey);
  const targetUserId = await findUserIdByEmail(email);
  if (!targetUserId) throw new Error("User not found");

  const { error: insertError } = await admin.from("account_members").insert({
    account_id: accountId,
    user_id: targetUserId,
    role: "member",
  });

  if (insertError) throw new Error(insertError.message);
  return { ok: true };
}
