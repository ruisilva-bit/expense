import { supabaseAdmin } from "@/lib/supabase-admin";

export type FamilyMemberKind = "human" | "system";

type AuthUserLike = {
  id?: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

export function getMemberKindFromAuthUser(user: AuthUserLike | null | undefined): FamilyMemberKind {
  const appKind = user?.app_metadata?.homefund_member_kind;
  const userKind = user?.user_metadata?.homefund_member_kind;
  return appKind === "system" || userKind === "system" ? "system" : "human";
}

export async function getAuthUsersByIds(userIds: string[]) {
  const wanted = new Set(userIds.filter(Boolean));
  const byUserId = new Map<string, { email: string | null; kind: FamilyMemberKind }>();
  if (!wanted.size) return byUserId;

  const admin = supabaseAdmin();
  let page = 1;
  const perPage = 1000;

  while (wanted.size) {
    const usersRes = await admin.auth.admin.listUsers({ page, perPage });
    if (usersRes.error) {
      break;
    }

    const users = usersRes.data.users ?? [];
    for (const authUser of users) {
      if (!authUser.id || !wanted.has(authUser.id)) continue;
      byUserId.set(authUser.id, {
        email: authUser.email ?? null,
        kind: getMemberKindFromAuthUser(authUser),
      });
      wanted.delete(authUser.id);
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return byUserId;
}

export async function getAuthUserKindById(userId: string | null | undefined): Promise<FamilyMemberKind> {
  if (!userId) return "human";
  const admin = supabaseAdmin();
  const userRes = await admin.auth.admin.getUserById(userId);
  if (userRes.error || !userRes.data.user) {
    return "human";
  }
  return getMemberKindFromAuthUser(userRes.data.user);
}

export async function filterHumanMembers<T extends { user_id: string | null }>(members: T[]) {
  const authUsers = await getAuthUsersByIds(
    members.map((member) => member.user_id).filter((userId): userId is string => Boolean(userId))
  );
  return members.filter((member) => {
    if (!member.user_id) return true;
    return (authUsers.get(member.user_id)?.kind ?? "human") !== "system";
  });
}
