import type { User } from "@supabase/supabase-js";
import { getAuthUserKindById, type FamilyMemberKind } from "@/lib/member-kind";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { supabaseServer } from "@/lib/supabase-server";

type FamilyMembershipRow = { id: string; role: "owner" | "member" | null; kind?: "human" | "system" | null };
type AccountRow = { id: string; family_id: string; name: string; balance: number | string | null };
type CategoryRow = { id: string; family_id: string; name: string; type: string | null; affects_loan: boolean | null };
type AccountMemberRoleRow = { account_id: string; user_id: string | null; role: "owner" | "member" | null };
type LoanRow = {
  id: string;
  family_id: string | null;
  name: string | null;
  remaining_amount: number | string | null;
  total_amount: number | string | null;
};
type VerifiedAccountAccessContext = {
  membership?: FamilyMembershipRow | null;
  authUserKind?: FamilyMemberKind | null;
  familyAccountIds?: string[] | null;
};

const isMissingAccountsTable = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes("could not find the table 'public.accounts'") || lower.includes("relation \"public.accounts\" does not exist");
};

const isMissingAccountMembersTable = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find the table 'public.account_members'") ||
    lower.includes("relation \"public.account_members\" does not exist")
  );
};

export async function getRequestUser(request: Request): Promise<{
  user: User | null;
  error: string | null;
}> {
  const admin = supabaseAdmin();
  const header = request.headers.get("authorization");

  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (!token) return { user: null, error: "Missing bearer token." };
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return { user: null, error: error?.message ?? "Invalid token." };
    return { user: data.user, error: null };
  }

  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return { user: null, error: "Not signed in." };
    return { user, error: null };
  } catch {
    return { user: null, error: "Not signed in." };
  }
}

export async function getFamilyMembership(familyId: string, userId: string) {
  const admin = supabaseAdmin();
  const res = await admin
    .from("family_members")
    .select("id,role,kind")
    .eq("family_id", familyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (res.error) return { data: null, error: res.error.message };
  return {
    data: (res.data as FamilyMembershipRow | null) ?? null,
    error: null,
  };
}

export async function ensureFamilyMember(familyId: string, userId: string) {
  const membership = await getFamilyMembership(familyId, userId);
  if (membership.error) return { ok: false as const, status: 400, error: membership.error };
  if (!membership.data) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, membership: membership.data };
}

export async function ensureFamilyOwner(familyId: string, userId: string) {
  const membership = await ensureFamilyMember(familyId, userId);
  if (!membership.ok) return membership;
  if (membership.membership.role !== "owner") {
    return { ok: false as const, status: 403, error: "Only owners can perform this action." };
  }
  return membership;
}

export async function getAccount(accountId: string) {
  const admin = supabaseAdmin();
  const res = await admin.from("bank_accounts").select("id,family_id,name,balance").eq("id", accountId).maybeSingle();
  if (res.error) return { data: null, error: res.error.message };
  return { data: (res.data as AccountRow | null) ?? null, error: null };
}

export async function getCategory(categoryId: string) {
  const admin = supabaseAdmin();
  const res = await admin
    .from("categories")
    .select("id,family_id,name,type,affects_loan")
    .eq("id", categoryId)
    .maybeSingle();
  if (res.error) return { data: null, error: res.error.message };
  return { data: (res.data as CategoryRow | null) ?? null, error: null };
}

export async function getLoan(loanId: string) {
  const admin = supabaseAdmin();
  const res = await admin
    .from("loans")
    .select("id,family_id,name,remaining_amount,total_amount")
    .eq("id", loanId)
    .maybeSingle();
  if (res.error) return { data: null, error: res.error.message };
  return { data: (res.data as LoanRow | null) ?? null, error: null };
}

export async function getAccountMembershipMap(accountIds: string[]) {
  const uniqueAccountIds = Array.from(new Set(accountIds.filter(Boolean)));
  if (!uniqueAccountIds.length) {
    return {
      map: new Map<string, Array<{ user_id: string; role: "owner" | "member" }>>(),
      missingTable: false,
      error: null,
    };
  }

  const admin = supabaseAdmin();
  const res = await admin
    .from("account_members")
    .select("account_id,user_id,role")
    .in("account_id", uniqueAccountIds);

  if (res.error) {
    if (isMissingAccountMembersTable(res.error.message)) {
      return {
        map: new Map<string, Array<{ user_id: string; role: "owner" | "member" }>>(),
        missingTable: true,
        error: null,
      };
    }
    return {
      map: new Map<string, Array<{ user_id: string; role: "owner" | "member" }>>(),
      missingTable: false,
      error: res.error.message,
    };
  }

  const map = new Map<string, Array<{ user_id: string; role: "owner" | "member" }>>();
  ((res.data ?? []) as AccountMemberRoleRow[]).forEach((row) => {
    if (!row.account_id || !row.user_id) return;
    const bucket = map.get(row.account_id) ?? [];
    bucket.push({ user_id: row.user_id, role: row.role === "owner" ? "owner" : "member" });
    map.set(row.account_id, bucket);
  });

  return {
    map,
    missingTable: false,
    error: null,
  };
}

export async function getAccountVisibilityMap(accountIds: string[]) {
  const memberships = await getAccountMembershipMap(accountIds);
  if (memberships.error || memberships.missingTable) {
    return {
      map: new Map<string, Set<string>>(),
      missingTable: memberships.missingTable,
      error: memberships.error,
    };
  }

  const map = new Map<string, Set<string>>();
  memberships.map.forEach((rows, accountId) => {
    const bucket = map.get(accountId) ?? new Set<string>();
    rows.forEach((row) => {
      bucket.add(row.user_id);
    });
    map.set(accountId, bucket);
  });

  return {
    map,
    missingTable: false,
    error: null,
  };
}

export async function getAccessibleAccountIds(
  familyId: string,
  userId: string,
  verifiedContext?: VerifiedAccountAccessContext
) {
  const membership = verifiedContext?.membership
    ? { data: verifiedContext.membership, error: null }
    : await getFamilyMembership(familyId, userId);

  if (membership.error) {
    return { accountIds: null, error: membership.error };
  }
  if (!membership.data) {
    return { accountIds: [] as string[], error: null };
  }
  const verifiedMembership = membership.data;

  let accountIds = verifiedContext?.familyAccountIds
    ? Array.from(new Set(verifiedContext.familyAccountIds.filter(Boolean)))
    : null;

  if (!accountIds) {
    const admin = supabaseAdmin();
    const accountsRes = await admin.from("bank_accounts").select("id").eq("family_id", familyId);
    if (accountsRes.error) {
      return { accountIds: null, error: accountsRes.error.message };
    }
    accountIds = (accountsRes.data ?? []).map((account) => account.id as string).filter(Boolean);
  }

  if (!accountIds.length) {
    return { accountIds: [] as string[], error: null };
  }
  const membershipKind = verifiedMembership.kind === "system" ? "system" : "human";
  const authUserKind = verifiedContext?.authUserKind ?? await getAuthUserKindById(userId);
  if (membershipKind === "system" || authUserKind === "system") {
    return { accountIds, error: null };
  }

  const visibility = await getAccountVisibilityMap(accountIds);
  if (visibility.error) {
    return { accountIds: null, error: visibility.error };
  }
  if (visibility.missingTable) {
    return { accountIds, error: null };
  }

  const allowed = accountIds.filter((accountId) => {
    const bucket = visibility.map.get(accountId);
    if (!bucket || !bucket.size) return true;
    return bucket.has(userId);
  });

  return { accountIds: allowed, error: null };
}

export async function ensureAccountAccess(familyId: string, userId: string, accountId: string) {
  const access = await getAccessibleAccountIds(familyId, userId);
  if (access.error || !access.accountIds) {
    return { ok: false as const, status: 400, error: access.error ?? "Failed to load account access." };
  }
  if (!access.accountIds.includes(accountId)) {
    return { ok: false as const, status: 403, error: "You do not have access to this account." };
  }
  return { ok: true as const };
}

export async function ensureAccountOwner(familyId: string, userId: string, accountId: string) {
  const familyMembership = await getFamilyMembership(familyId, userId);
  if (familyMembership.error) {
    return { ok: false as const, status: 400, error: familyMembership.error };
  }
  if (!familyMembership.data) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  const membershipKind = familyMembership.data.kind === "system" ? "system" : "human";
  const authUserKind = await getAuthUserKindById(userId);
  if (membershipKind === "system" || authUserKind === "system") {
    if (familyMembership.data.role === "owner") {
      return { ok: true as const };
    }
    return { ok: false as const, status: 403, error: "Only account owners can change account visibility." };
  }

  const memberships = await getAccountMembershipMap([accountId]);
  if (memberships.error) {
    return { ok: false as const, status: 400, error: memberships.error };
  }

  if (memberships.missingTable) {
    return ensureFamilyOwner(familyId, userId);
  }

  const rows = memberships.map.get(accountId) ?? [];
  if (!rows.length) {
    return ensureFamilyOwner(familyId, userId);
  }

  const isOwner = rows.some((row) => row.user_id === userId && row.role === "owner");
  if (!isOwner) {
    return { ok: false as const, status: 403, error: "Only account owners can change account visibility." };
  }

  return { ok: true as const };
}

export async function ensureLegacyAccountForBankAccount(bankAccountId: string) {
  const account = await getAccount(bankAccountId);
  if (account.error || !account.data) {
    return { ok: false as const, error: account.error ?? "Bank account not found." };
  }

  const admin = supabaseAdmin();
  const existing = await admin.from("accounts").select("id").eq("id", bankAccountId).maybeSingle();
  if (existing.error) {
    if (isMissingAccountsTable(existing.error.message)) return { ok: true as const };
    return { ok: false as const, error: existing.error.message };
  }
  if (existing.data) return { ok: true as const };

  let insert = await admin.from("accounts").insert({
    id: bankAccountId,
    name: account.data.name,
    type: "personal",
  });
  if (insert.error) {
    if (isMissingAccountsTable(insert.error.message)) return { ok: true as const };
    insert = await admin.from("accounts").insert({
      id: bankAccountId,
      name: account.data.name,
    });
    if (insert.error) {
      if (isMissingAccountsTable(insert.error.message)) return { ok: true as const };
      if (insert.error.message.toLowerCase().includes("duplicate key")) return { ok: true as const };
      return { ok: false as const, error: insert.error.message };
    }
  }

  return { ok: true as const };
}

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
