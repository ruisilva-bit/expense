import { NextResponse } from "next/server";
import { ensureFamilyOwner, getRequestUser } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type FamilyRow = { id: string; name: string; created_at?: string | null };
type MemberRow = { family_id: string; role: "owner" | "member" | null };

export async function GET(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const membersRes = await admin
    .from("family_members")
    .select("family_id,role")
    .eq("user_id", user.id);

  if (membersRes.error) {
    return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
  }

  const memberships = ((membersRes.data ?? []) as MemberRow[]).filter((row) => row.family_id);
  if (!memberships.length) {
    return NextResponse.json({ families: [] });
  }

  // If duplicated membership rows exist (legacy migrations), keep strongest role.
  const membershipByFamily = new Map<string, "owner" | "member">();
  for (const membership of memberships) {
    const current = membershipByFamily.get(membership.family_id);
    if (current === "owner") continue;
    if (membership.role === "owner") {
      membershipByFamily.set(membership.family_id, "owner");
      continue;
    }
    membershipByFamily.set(membership.family_id, "member");
  }

  const uniqueFamilyIds = Array.from(membershipByFamily.keys());
  const familiesRes = await admin
    .from("families")
    .select("id,name,created_at")
    .in("id", uniqueFamilyIds)
    .order("created_at", { ascending: false });

  if (familiesRes.error) {
    return NextResponse.json({ error: familiesRes.error.message }, { status: 400 });
  }

  const byId = new Map(
    ((familiesRes.data ?? []) as FamilyRow[]).map((family) => [family.id, family])
  );

  const families = uniqueFamilyIds
    .map((familyId) => {
      const family = byId.get(familyId);
      if (!family) return null;
      return {
        id: family.id,
        name: family.name,
        role: membershipByFamily.get(familyId) ?? "member",
      };
    })
    .filter(Boolean);

  return NextResponse.json({ families });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { name?: string };
  const name = (payload.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Family name is required." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const familyInsert = await admin.from("families").insert({ name }).select("id,name").single();
  if (familyInsert.error || !familyInsert.data) {
    return NextResponse.json({ error: familyInsert.error?.message ?? "Failed to create family." }, { status: 400 });
  }

  const memberInsert = await admin.from("family_members").insert({
    family_id: familyInsert.data.id,
    user_id: user.id,
    name: user.email ?? "You",
    role: "owner",
  });

  if (memberInsert.error) {
    return NextResponse.json(
      {
        family: {
          id: familyInsert.data.id,
          name: familyInsert.data.name,
          role: "owner",
        },
        warning: `Family created but membership bootstrap failed: ${memberInsert.error.message}`,
      },
      { status: 201 }
    );
  }

  return NextResponse.json(
    {
      family: {
        id: familyInsert.data.id,
        name: familyInsert.data.name,
        role: "owner",
      },
    },
    { status: 201 }
  );
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { familyId?: string; name?: string };
  const familyId = (payload.familyId ?? "").trim();
  const name = (payload.name ?? "").trim();
  if (!familyId || !name) {
    return NextResponse.json({ error: "familyId and name are required." }, { status: 400 });
  }

  const ownerCheck = await ensureFamilyOwner(familyId, user.id);
  if (!ownerCheck.ok) {
    return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
  }

  const admin = supabaseAdmin();
  const update = await admin
    .from("families")
    .update({ name })
    .eq("id", familyId)
    .select("id,name")
    .maybeSingle();

  if (update.error || !update.data) {
    return NextResponse.json({ error: update.error?.message ?? "Failed to update family." }, { status: 400 });
  }

  return NextResponse.json({ family: update.data });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { familyId?: string };
  const familyId = (payload.familyId ?? "").trim();
  if (!familyId) {
    return NextResponse.json({ error: "familyId is required." }, { status: 400 });
  }

  const ownerCheck = await ensureFamilyOwner(familyId, user.id);
  if (!ownerCheck.ok) {
    return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
  }

  const admin = supabaseAdmin();
  const del = await admin.from("families").delete().eq("id", familyId);
  if (del.error) {
    return NextResponse.json({ error: del.error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
