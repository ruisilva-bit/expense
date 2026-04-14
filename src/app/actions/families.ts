"use server";
import { supabaseServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

export async function createFamily(name: string) {
  const supabase = await supabaseServer();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Not signed in");

  // Use service role for creation to avoid RLS bootstrap race; family row is scoped by membership immediately after.
  if (!serviceKey || !supabaseUrl) {
    throw new Error("Service role key missing for family creation.");
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin.from("families").insert({ name }).select("id").single();
  if (error || !data) throw new Error(error?.message || "Failed to create family");

  const memberInsert = await admin.from("family_members").insert({
    family_id: data.id,
    user_id: userData.user.id,
    name: userData.user.email ?? "You",
    role: "owner",
  });
  if (memberInsert.error) throw new Error(memberInsert.error.message);

  return data.id;
}

export async function addMember(familyId: string, name: string, email?: string) {
  const supabase = await supabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error("Not signed in");

  if (!serviceKey || !supabaseUrl) throw new Error("Service key required for invites");
  const admin = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;
  if (email) {
    const { data: target, error } = await admin.auth.admin.getUserByEmail(email);
    if (!error && target?.user) userId = target.user.id;
  }

  const insert = await admin.from("family_members").insert({ family_id: familyId, user_id: userId, name, role: "member" });
  if (insert.error) throw new Error(insert.error.message);
}
