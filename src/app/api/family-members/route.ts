import { NextRequest, NextResponse } from "next/server";
import { ensureFamilyMember, ensureFamilyOwner, getRequestUser } from "@/lib/api-auth";
import { getAuthUsersByIds, getMemberKindFromAuthUser, type FamilyMemberKind } from "@/lib/member-kind";
import { supabaseAdmin } from "@/lib/supabase-admin";

type FamilyMemberRow = {
  id: string;
  family_id: string;
  user_id: string | null;
  name: string;
  role: "owner" | "member" | null;
  kind: FamilyMemberKind | null;
  email?: string | null;
  is_api_user?: boolean;
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

async function createSystemUser(input: { email: string; password: string; displayName: string }) {
  const admin = supabaseAdmin();
  return admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      display_name: input.displayName,
      homefund_member_kind: "system",
    },
    app_metadata: {
      homefund_member_kind: "system",
      api_only: true,
    },
  });
}

async function updateSystemUser(userId: string, input: { email?: string; password?: string; displayName?: string }) {
  const payload: {
    email?: string;
    password?: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, string>;
  } = {};

  if (input.email) {
    payload.email = input.email;
    payload.email_confirm = true;
  }
  if (input.password) {
    payload.password = input.password;
  }
  if (input.displayName) {
    payload.user_metadata = {
      display_name: input.displayName,
      homefund_member_kind: "system",
    };
  }

  const admin = supabaseAdmin();
  return admin.auth.admin.updateUserById(userId, payload);
}

async function getMemberKind(userId: string | null, fallbackKind?: FamilyMemberKind | null): Promise<FamilyMemberKind> {
  if (fallbackKind === "human" || fallbackKind === "system") return fallbackKind;
  if (!userId) return "human";
  const authUsers = await getAuthUsersByIds([userId]);
  return authUsers.get(userId)?.kind ?? "human";
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
    .select("id,family_id,user_id,name,role,kind")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });

  if (membersRes.error) {
    return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
  }

  const members = (membersRes.data ?? []) as FamilyMemberRow[];
  const authUsers = await getAuthUsersByIds(
    members
      .map((member) => member.user_id)
      .filter((userId): userId is string => Boolean(userId))
  );

  return NextResponse.json({
    members: members.map((member) => {
      const authUser = member.user_id ? authUsers.get(member.user_id) : null;
      const resolvedKind = member.kind ?? authUser?.kind ?? "human";
      return {
        ...member,
        kind: resolvedKind,
        email: authUser?.email ?? null,
        is_api_user: resolvedKind === "system",
      };
    }),
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
    password?: string;
    role?: "owner" | "member";
    kind?: FamilyMemberKind;
  };

  const familyId = (payload.familyId ?? "").trim();
  const name = (payload.name ?? "").trim();
  const email = (payload.email ?? "").trim().toLowerCase();
  const password = (payload.password ?? "").trim();
  const role = payload.role === "owner" ? "owner" : "member";
  const kind: FamilyMemberKind = payload.kind === "system" ? "system" : "human";

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
  let createdSystemUserId: string | null = null;

  if (kind === "system") {
    if (!email || !password) {
      return NextResponse.json({ error: "System API users require both email and password." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "System user password must be at least 8 characters." }, { status: 400 });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser.error) {
      return NextResponse.json({ error: existingUser.error }, { status: 400 });
    }
    if (existingUser.user) {
      return NextResponse.json(
        { error: "A Supabase user with this email already exists. Use a different email for the API system user." },
        { status: 400 }
      );
    }

    const createdUser = await createSystemUser({ email, password, displayName: name });
    if (createdUser.error || !createdUser.data.user) {
      return NextResponse.json(
        { error: createdUser.error?.message ?? "Failed to create system auth user." },
        { status: 400 }
      );
    }

    createdSystemUserId = createdUser.data.user.id;
    userId = createdSystemUserId;
    linkedEmail = createdUser.data.user.email?.toLowerCase() ?? email;
  } else if (email) {
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
    if (getMemberKindFromAuthUser(found) === "system") {
      return NextResponse.json({ error: "That email already belongs to an API-only system user." }, { status: 400 });
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
      kind,
    })
    .select("id,family_id,user_id,name,role,kind")
    .single();

  if (insert.error || !insert.data) {
    if (createdSystemUserId) {
      await admin.auth.admin.deleteUser(createdSystemUserId).catch(() => undefined);
    }
    return NextResponse.json({ error: insert.error?.message ?? "Failed to add member." }, { status: 400 });
  }

  return NextResponse.json(
    {
      member: {
        ...insert.data,
        kind: (insert.data.kind as FamilyMemberKind | null) ?? kind,
        email: linkedEmail,
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

  const payload = (await request.json().catch(() => ({}))) as {
    memberId?: string;
    name?: string;
    role?: "owner" | "member";
    email?: string | null;
    password?: string | null;
  };

  const memberId = (payload.memberId ?? "").trim();
  const name = payload.name?.trim();
  const role = payload.role === "owner" ? "owner" : payload.role === "member" ? "member" : undefined;
  const hasEmailUpdate = Object.prototype.hasOwnProperty.call(payload, "email");
  const nextEmail = payload.email?.trim().toLowerCase() ?? "";
  const password = payload.password?.trim() ?? "";
  const hasPasswordUpdate = Boolean(password);
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required." }, { status: 400 });
  }
  if (!name && !role && !hasEmailUpdate && !hasPasswordUpdate) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  if (hasPasswordUpdate && password.length < 8) {
    return NextResponse.json({ error: "System user password must be at least 8 characters." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const existing = await admin
    .from("family_members")
    .select("id,family_id,user_id,name,role,kind")
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

  const kind = await getMemberKind((existing.data.user_id as string | null) ?? null, (existing.data.kind as FamilyMemberKind | null) ?? null);
  const updatePayload: Record<string, unknown> = {};
  if (name) updatePayload.name = name;
  if (role) updatePayload.role = role;
  let linkedEmail: string | null = null;

  if (kind === "system") {
    if ((hasEmailUpdate || hasPasswordUpdate || name) && !existing.data.user_id) {
      return NextResponse.json({ error: "System user is missing its auth account link." }, { status: 400 });
    }
    if (hasEmailUpdate && !nextEmail) {
      return NextResponse.json({ error: "System API users require an email." }, { status: 400 });
    }
    if (hasEmailUpdate || hasPasswordUpdate || name) {
      const updatedUser = await updateSystemUser(existing.data.user_id as string, {
        email: hasEmailUpdate ? nextEmail : undefined,
        password: hasPasswordUpdate ? password : undefined,
        displayName: name,
      });
      if (updatedUser.error) {
        return NextResponse.json({ error: updatedUser.error.message }, { status: 400 });
      }
      linkedEmail = updatedUser.data.user.email?.toLowerCase() ?? (hasEmailUpdate ? nextEmail : null);
    }
  } else if (hasEmailUpdate) {
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
      if (getMemberKindFromAuthUser(found) === "system") {
        return NextResponse.json({ error: "That email already belongs to an API-only system user." }, { status: 400 });
      }
      updatePayload.user_id = found.id;
      linkedEmail = found.email?.toLowerCase() ?? nextEmail;
    }
  }

  const update = await admin
    .from("family_members")
    .update(updatePayload)
    .eq("id", memberId)
    .select("id,family_id,user_id,name,role,kind")
    .single();

  if (update.error || !update.data) {
    return NextResponse.json({ error: update.error?.message ?? "Failed to update member." }, { status: 400 });
  }

  if (!linkedEmail && update.data.user_id) {
    const authUsers = await getAuthUsersByIds([update.data.user_id as string]);
    linkedEmail = authUsers.get(update.data.user_id as string)?.email ?? null;
  }

  return NextResponse.json({
    member: {
      ...update.data,
      kind: (update.data.kind as FamilyMemberKind | null) ?? kind,
      email: linkedEmail,
    },
  });
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
    .select("id,family_id,user_id,name,role,kind")
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

  const kind = await getMemberKind((existing.data.user_id as string | null) ?? null, (existing.data.kind as FamilyMemberKind | null) ?? null);
  const del = await admin.from("family_members").delete().eq("id", memberId);
  if (del.error) {
    return NextResponse.json({ error: del.error.message }, { status: 400 });
  }

  if (kind === "system" && existing.data.user_id) {
    await admin.auth.admin.deleteUser(existing.data.user_id as string).catch(() => undefined);
  }

  return NextResponse.json({ success: true });
}
