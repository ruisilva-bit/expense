import { NextRequest, NextResponse } from "next/server";
import { ensureFamilyMember, ensureFamilyOwner, getRequestUser } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type FamilyMemberRow = {
  id: string;
  family_id: string;
  user_id: string | null;
  name: string;
  role: "owner" | "member" | null;
  email?: string | null;
};

async function findUserByEmail(email: string) {
  const admin = supabaseAdmin();
  let page = 1;
  const perPage = 1000;

  while (true) {
    const candidates = await admin.auth.admin.listUsers({ page, perPage });
    if (candidates.error) {
      return { user: null, error: candidates.error.message };
    }

    const users = candidates.data.users ?? [];
    const found = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      return { user: found, error: null };
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return { user: null, error: null };
}

async function getEmailsByUserIds(userIds: string[]) {
  const wanted = new Set(userIds.filter(Boolean));
  const byUserId = new Map<string, string>();
  if (!wanted.size) return byUserId;

  const admin = supabaseAdmin();
  let page = 1;
  const perPage = 1000;

  while (wanted.size) {
    const usersRes = await admin.auth.admin.listUsers({ page, perPage });
    if (usersRes.error) break;

    const users = usersRes.data.users ?? [];
    for (const authUser of users) {
      if (!authUser.id || !wanted.has(authUser.id)) continue;
      byUserId.set(authUser.id, authUser.email ?? "");
      wanted.delete(authUser.id);
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return byUserId;
}

export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("familyId") ?? "";

  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  if (!familyId) {
    return NextResponse.json({ error: "familyId is required." }, { status: 400 });
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  const membersRes = await admin
    .from("family_members")
    .select("id,family_id,user_id,name,role")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });

  if (membersRes.error) {
    return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
  }

  const members = (membersRes.data ?? []) as FamilyMemberRow[];
  const emailsByUserId = await getEmailsByUserIds(
    members
      .map((member) => member.user_id)
      .filter((userId): userId is string => Boolean(userId))
  );

  return NextResponse.json({
    members: members.map((member) => ({
      ...member,
      email: member.user_id ? emailsByUserId.get(member.user_id) ?? null : null,
    })),
  });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    name?: string;
    email?: string;
    role?: "owner" | "member";
  };

  const familyId = (payload.familyId ?? "").trim();
  const name = (payload.name ?? "").trim();
  const email = (payload.email ?? "").trim().toLowerCase();
  const role = payload.role === "owner" ? "owner" : "member";

  if (!familyId || !name) {
    return NextResponse.json({ error: "familyId and name are required." }, { status: 400 });
  }

  const ownerCheck = await ensureFamilyOwner(familyId, user.id);
  if (!ownerCheck.ok) {
    return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
  }

  const admin = supabaseAdmin();
  let userId: string | null = null;
  let linkedEmail: string | null = null;

  if (email) {
    const foundByEmail = await findUserByEmail(email);
    if (foundByEmail.error) {
      return NextResponse.json({ error: foundByEmail.error }, { status: 400 });
    }
    const found = foundByEmail.user;
    if (!found) {
      return NextResponse.json(
        { error: "No Supabase user found with this email. Leave email empty to create a fictitious member." },
        { status: 400 }
      );
    }
    userId = found.id;
    linkedEmail = found.email?.toLowerCase() ?? email;
  }

  const insert = await admin
    .from("family_members")
    .insert({
      family_id: familyId,
      user_id: userId,
      name,
      role,
    })
    .select("id,family_id,user_id,name,role")
    .single();

  if (insert.error || !insert.data) {
    return NextResponse.json({ error: insert.error?.message ?? "Failed to add member." }, { status: 400 });
  }

  return NextResponse.json({ member: { ...insert.data, email: linkedEmail } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    memberId?: string;
    name?: string;
    role?: "owner" | "member";
    email?: string | null;
  };

  const memberId = (payload.memberId ?? "").trim();
  const name = payload.name?.trim();
  const role = payload.role === "owner" ? "owner" : payload.role === "member" ? "member" : undefined;
  const hasEmailUpdate = Object.prototype.hasOwnProperty.call(payload, "email");
  const nextEmail = payload.email?.trim().toLowerCase() ?? "";
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required." }, { status: 400 });
  }
  if (!name && !role && !hasEmailUpdate) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const existing = await admin
    .from("family_members")
    .select("id,family_id,user_id,name,role")
    .eq("id", memberId)
    .maybeSingle();

  if (existing.error || !existing.data) {
    return NextResponse.json({ error: existing.error?.message ?? "Member not found." }, { status: 404 });
  }

  const ownerCheck = await ensureFamilyOwner(existing.data.family_id as string, user.id);
  if (!ownerCheck.ok) {
    return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
  }

  if (role && existing.data.role === "owner" && role !== "owner") {
    const ownersRes = await admin
      .from("family_members")
      .select("id")
      .eq("family_id", existing.data.family_id as string)
      .eq("role", "owner");
    if (ownersRes.error) {
      return NextResponse.json({ error: ownersRes.error.message }, { status: 400 });
    }
    if ((ownersRes.data?.length ?? 0) <= 1) {
      return NextResponse.json({ error: "A family must have at least one owner." }, { status: 400 });
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (name) updatePayload.name = name;
  if (role) updatePayload.role = role;
  let linkedEmail: string | null = null;

  if (hasEmailUpdate) {
    if (!nextEmail) {
      updatePayload.user_id = null;
    } else {
      const foundByEmail = await findUserByEmail(nextEmail);
      if (foundByEmail.error) {
        return NextResponse.json({ error: foundByEmail.error }, { status: 400 });
      }
      const found = foundByEmail.user;
      if (!found) {
        return NextResponse.json({ error: "No Supabase user found with this email." }, { status: 400 });
      }
      updatePayload.user_id = found.id;
      linkedEmail = found.email?.toLowerCase() ?? nextEmail;
    }
  }

  const update = await admin
    .from("family_members")
    .update(updatePayload)
    .eq("id", memberId)
    .select("id,family_id,user_id,name,role")
    .single();

  if (update.error || !update.data) {
    return NextResponse.json({ error: update.error?.message ?? "Failed to update member." }, { status: 400 });
  }

  if (!hasEmailUpdate && update.data.user_id) {
    const emailLookup = await getEmailsByUserIds([update.data.user_id as string]);
    linkedEmail = emailLookup.get(update.data.user_id as string) ?? null;
  }

  return NextResponse.json({ member: { ...update.data, email: linkedEmail } });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { memberId?: string };
  const memberId = (payload.memberId ?? "").trim();
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const existing = await admin
    .from("family_members")
    .select("id,family_id,user_id,name,role")
    .eq("id", memberId)
    .maybeSingle();

  if (existing.error || !existing.data) {
    return NextResponse.json({ error: existing.error?.message ?? "Member not found." }, { status: 404 });
  }

  const ownerCheck = await ensureFamilyOwner(existing.data.family_id as string, user.id);
  if (!ownerCheck.ok) {
    return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
  }

  if (existing.data.role === "owner") {
    const ownersRes = await admin
      .from("family_members")
      .select("id")
      .eq("family_id", existing.data.family_id as string)
      .eq("role", "owner");
    if (ownersRes.error) {
      return NextResponse.json({ error: ownersRes.error.message }, { status: 400 });
    }
    if ((ownersRes.data?.length ?? 0) <= 1) {
      return NextResponse.json({ error: "A family must have at least one owner." }, { status: 400 });
    }
  }

  const del = await admin.from("family_members").delete().eq("id", memberId);
  if (del.error) {
    return NextResponse.json({ error: del.error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
