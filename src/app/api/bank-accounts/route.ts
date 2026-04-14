import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountOwner,
  ensureFamilyMember,
  ensureLegacyAccountForBankAccount,
  getAccount,
  getAccountMembershipMap,
  getAccessibleAccountIds,
  getRequestUser,
} from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type FamilyUserRow = { id: string; user_id: string | null; role: "owner" | "member" | null; name: string | null };
type AccountPayload = { id: string; name: string; balance: number; visible_user_ids: string[]; owner_user_ids: string[] };
type AccountUpdateRow = { id: string; family_id: string; name: string; balance: number | string | null };

export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("familyId");
  if (!familyId) {
    return NextResponse.json({ error: "familyId is required." }, { status: 400 });
  }

  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  const [accountsRes, familyUsersRes] = await Promise.all([
    admin
      .from("bank_accounts")
      .select("id,name,balance")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true }),
    admin.from("family_members").select("id,user_id,role,name").eq("family_id", familyId),
  ]);

  if (accountsRes.error) {
    return NextResponse.json({ error: accountsRes.error.message }, { status: 400 });
  }
  if (familyUsersRes.error) {
    return NextResponse.json({ error: familyUsersRes.error.message }, { status: 400 });
  }

  const accountRows = (accountsRes.data ?? []) as Array<{ id: string; name: string; balance: number | string | null }>;
  const accountIds = accountRows.map((account) => account.id);

  const access = await getAccessibleAccountIds(familyId, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const allowedSet = new Set(access.accountIds);

  const accountMembership = await getAccountMembershipMap(accountIds);
  if (accountMembership.error) {
    return NextResponse.json({ error: accountMembership.error }, { status: 400 });
  }

  const familyUsers = ((familyUsersRes.data ?? []) as FamilyUserRow[])
    .filter((row) => Boolean(row.user_id))
    .map((row) => ({
      id: row.id,
      user_id: row.user_id as string,
      role: row.role ?? "member",
      name: row.name ?? "Member",
    }));
  const allRealUserIds = familyUsers.map((member) => member.user_id);
  const familyOwnerIds = familyUsers.filter((member) => member.role === "owner").map((member) => member.user_id);

  const accounts: AccountPayload[] = accountRows
    .filter((account) => allowedSet.has(account.id))
    .map((account) => {
      const rows = accountMembership.map.get(account.id) ?? [];
      const visibleUserIds = rows.length
        ? Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)))
        : allRealUserIds;
      const ownerUserIds = rows.filter((row) => row.role === "owner").map((row) => row.user_id);
      const dedupedOwnerIds = Array.from(
        new Set((ownerUserIds.length ? ownerUserIds : familyOwnerIds).filter((value): value is string => Boolean(value)))
      );
      const fallbackOwnerIds = visibleUserIds.includes(user.id) ? [user.id] : visibleUserIds.slice(0, 1);
      return {
        id: account.id,
        name: account.name,
        balance: Number(account.balance ?? 0),
        visible_user_ids: visibleUserIds,
        owner_user_ids: dedupedOwnerIds.length ? dedupedOwnerIds : fallbackOwnerIds,
      };
    });

  return NextResponse.json({ accounts, family_users: familyUsers });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    name?: string;
    balance?: number;
  };

  const familyId = (payload.familyId ?? "").trim();
  const name = (payload.name ?? "").trim();
  const balance = Number(payload.balance ?? 0);

  if (!familyId || !name) {
    return NextResponse.json({ error: "familyId and name are required." }, { status: 400 });
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  const insert = await admin
    .from("bank_accounts")
    .insert({ family_id: familyId, name, balance })
    .select("id,name,balance,family_id")
    .single();

  if (insert.error || !insert.data) {
    return NextResponse.json({ error: insert.error?.message ?? "Failed to create account." }, { status: 400 });
  }
  const createdAccount = insert.data as AccountUpdateRow;

  const legacyAccount = await ensureLegacyAccountForBankAccount(createdAccount.id);
  if (!legacyAccount.ok) {
    await admin.from("bank_accounts").delete().eq("id", createdAccount.id);
    return NextResponse.json(
      { error: `Account created but visibility bootstrap failed: ${legacyAccount.error}` },
      { status: 400 }
    );
  }

  const ownerInsert = await admin.from("account_members").insert({
    account_id: createdAccount.id,
    user_id: user.id,
    role: "owner",
  });
  if (ownerInsert.error) {
    await admin.from("bank_accounts").delete().eq("id", createdAccount.id);
    await admin.from("accounts").delete().eq("id", createdAccount.id);
    return NextResponse.json(
      { error: `Account created but owner visibility bootstrap failed: ${ownerInsert.error.message}` },
      { status: 400 }
    );
  }

  return NextResponse.json({ account: createdAccount }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    accountId?: string;
    name?: string;
    balance?: number;
    visible_user_ids?: string[];
    owner_user_ids?: string[];
  };

  const accountId = (payload.accountId ?? "").trim();
  const name = payload.name?.trim();
  const balance = payload.balance;
  const visibleUserIdsRaw = payload.visible_user_ids;
  const ownerUserIdsRaw = payload.owner_user_ids;
  const hasVisibilityUpdate = Array.isArray(visibleUserIdsRaw);
  const hasOwnerUpdate = Array.isArray(ownerUserIdsRaw);
  const hasAccessUpdate = hasVisibilityUpdate || hasOwnerUpdate;
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }
  if (!name && balance === undefined && !hasAccessUpdate) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const account = await getAccount(accountId);
  if (account.error || !account.data) {
    return NextResponse.json({ error: account.error ?? "Account not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(account.data.family_id, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const updatePayload: Record<string, unknown> = {};
  if (name) updatePayload.name = name;
  if (balance !== undefined) updatePayload.balance = Number(balance);

  const admin = supabaseAdmin();
  if (hasAccessUpdate) {
    const ownerCheck = await ensureAccountOwner(account.data.family_id, user.id, accountId);
    if (!ownerCheck.ok) {
      return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
    }

    const legacyAccount = await ensureLegacyAccountForBankAccount(accountId);
    if (!legacyAccount.ok) {
      return NextResponse.json(
        { error: `Could not sync account visibility mapping: ${legacyAccount.error}` },
        { status: 400 }
      );
    }

    const [familyUsersRes, currentMembersRes] = await Promise.all([
      admin
        .from("family_members")
        .select("user_id")
        .eq("family_id", account.data.family_id)
        .not("user_id", "is", null),
      admin.from("account_members").select("user_id,role").eq("account_id", accountId),
    ]);
    if (familyUsersRes.error) {
      return NextResponse.json({ error: familyUsersRes.error.message }, { status: 400 });
    }
    if (currentMembersRes.error) {
      return NextResponse.json({ error: currentMembersRes.error.message }, { status: 400 });
    }

    const currentVisibleUserIds = Array.from(
      new Set((currentMembersRes.data ?? []).map((row) => row.user_id as string).filter(Boolean))
    );
    const currentOwnerUserIds = Array.from(
      new Set(
        (currentMembersRes.data ?? [])
          .filter((row) => row.role === "owner")
          .map((row) => row.user_id as string)
          .filter(Boolean)
      )
    );

    const visibleUserIds = Array.from(
      new Set(
        (
          hasVisibilityUpdate
            ? (visibleUserIdsRaw ?? []).map((value) => String(value).trim())
            : currentVisibleUserIds
        ).filter(Boolean)
      )
    );
    const ownerUserIds = Array.from(
      new Set(
        (hasOwnerUpdate ? (ownerUserIdsRaw ?? []).map((value) => String(value).trim()) : currentOwnerUserIds).filter(
          Boolean
        )
      )
    );

    const fallbackOwnerId = visibleUserIds.includes(user.id) ? user.id : visibleUserIds[0];
    if (!ownerUserIds.length && fallbackOwnerId) {
      ownerUserIds.push(fallbackOwnerId);
    }

    const validUserIds = new Set((familyUsersRes.data ?? []).map((row) => row.user_id as string));
    if (!visibleUserIds.length) {
      return NextResponse.json({ error: "Select at least one user for visibility." }, { status: 400 });
    }
    if (visibleUserIds.some((memberId) => !validUserIds.has(memberId))) {
      return NextResponse.json({ error: "One or more selected users are not in this family." }, { status: 400 });
    }
    if (ownerUserIds.some((memberId) => !validUserIds.has(memberId))) {
      return NextResponse.json({ error: "One or more selected owners are not in this family." }, { status: 400 });
    }
    if (!ownerUserIds.length) {
      return NextResponse.json({ error: "Each account must have at least one owner." }, { status: 400 });
    }
    if (ownerUserIds.some((memberId) => !visibleUserIds.includes(memberId))) {
      return NextResponse.json({ error: "All owners must also be visible on this account." }, { status: 400 });
    }

    const removeRes = await admin.from("account_members").delete().eq("account_id", accountId);
    if (removeRes.error) {
      return NextResponse.json({ error: removeRes.error.message }, { status: 400 });
    }

    const ownerSet = new Set(ownerUserIds);
    const insertRows = visibleUserIds.map((memberId) => ({
      account_id: accountId,
      user_id: memberId,
      role: ownerSet.has(memberId) ? "owner" : "member",
    }));
    const insertRes = await admin.from("account_members").insert(insertRows);
    if (insertRes.error) {
      return NextResponse.json({ error: insertRes.error.message }, { status: 400 });
    }
  }

  let updatedAccount = account.data as AccountUpdateRow;
  if (Object.keys(updatePayload).length) {
    const update = await admin
      .from("bank_accounts")
      .update(updatePayload)
      .eq("id", accountId)
      .select("id,name,balance,family_id")
      .single();

    if (update.error || !update.data) {
      return NextResponse.json({ error: update.error?.message ?? "Failed to update account." }, { status: 400 });
    }
    updatedAccount = update.data as AccountUpdateRow;
  }

  const [familyUsersRes, accountMembersRes] = await Promise.all([
    admin
      .from("family_members")
      .select("user_id")
      .eq("family_id", account.data.family_id)
      .not("user_id", "is", null),
    admin.from("account_members").select("user_id,role").eq("account_id", accountId),
  ]);
  if (familyUsersRes.error) {
    return NextResponse.json({ error: familyUsersRes.error.message }, { status: 400 });
  }
  if (accountMembersRes.error) {
    return NextResponse.json({ error: accountMembersRes.error.message }, { status: 400 });
  }
  const fallbackVisibleIds = Array.from(new Set((familyUsersRes.data ?? []).map((row) => row.user_id as string)));
  const accountRows = (accountMembersRes.data ?? []).filter((row) => Boolean(row.user_id));
  const visibleUserIds = accountRows.length
    ? Array.from(new Set(accountRows.map((row) => row.user_id as string)))
    : fallbackVisibleIds;
  const ownerUserIds = Array.from(
    new Set(accountRows.filter((row) => row.role === "owner").map((row) => row.user_id as string).filter(Boolean))
  );
  const fallbackOwnerIds = fallbackVisibleIds.includes(user.id) ? [user.id] : fallbackVisibleIds.slice(0, 1);

  return NextResponse.json({
    account: {
      id: updatedAccount.id,
      family_id: updatedAccount.family_id,
      name: updatedAccount.name,
      balance: Number(updatedAccount.balance ?? 0),
      visible_user_ids: visibleUserIds,
      owner_user_ids: ownerUserIds.length ? ownerUserIds : fallbackOwnerIds,
    },
  });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { accountId?: string };
  const accountId = (payload.accountId ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }

  const account = await getAccount(accountId);
  if (account.error || !account.data) {
    return NextResponse.json({ error: account.error ?? "Account not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(account.data.family_id, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  const del = await admin.from("bank_accounts").delete().eq("id", accountId);
  if (del.error) {
    return NextResponse.json({ error: del.error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
