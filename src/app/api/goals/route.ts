import { NextRequest, NextResponse } from "next/server";
import {
  asNumber,
  ensureAccountAccess,
  ensureLegacyAccountForBankAccount,
  ensureFamilyMember,
  getAccessibleAccountIds,
  getAccount,
  getCategory,
  getLoan,
  getRequestUser,
  todayIsoDate,
} from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type GoalRow = {
  id: string;
  name: string | null;
  target_amount: number | string | null;
  current_amount: number | string | null;
  deadline?: string | null;
  bank_account_id?: string | null;
  account_id?: string | null;
};

const LOAN_TAG_REGEX = /\s*\[loan:([0-9a-fA-F-]{36})\]\s*$/;

const stripLoanTag = (description: string | null | undefined) => {
  if (!description) return null;
  const stripped = description.replace(LOAN_TAG_REGEX, "").trim();
  return stripped || null;
};

const withLoanTag = (description: string | null, loanId: string | null) => {
  const base = stripLoanTag(description);
  if (!loanId) return base;
  return base ? `${base} [loan:${loanId}]` : `[loan:${loanId}]`;
};

const normalizeGoal = (goal: GoalRow) => ({
  id: goal.id,
  name: goal.name ?? "Goal",
  target_amount: asNumber(goal.target_amount),
  current_amount: asNumber(goal.current_amount),
  deadline: goal.deadline ?? null,
  bank_account_id: goal.bank_account_id ?? goal.account_id ?? null,
});

async function listGoalsForFamily(familyId: string) {
  const admin = supabaseAdmin();
  const accountsRes = await admin.from("bank_accounts").select("id").eq("family_id", familyId);
  if (accountsRes.error) return { goals: null, error: accountsRes.error.message };
  const accountIds = (accountsRes.data ?? []).map((account) => account.id);
  if (!accountIds.length) return { goals: [] as ReturnType<typeof normalizeGoal>[], error: null };

  const goalsRes = await admin.from("goals").select("*").order("created_at", { ascending: false });
  if (goalsRes.error) return { goals: null, error: goalsRes.error.message };

  const allowed = new Set(accountIds);
  const goals = ((goalsRes.data ?? []) as GoalRow[]).filter((goal) => {
    const accountId = goal.bank_account_id ?? goal.account_id ?? null;
    return accountId ? allowed.has(accountId) : false;
  });
  return { goals: goals.map(normalizeGoal), error: null };
}

async function resolveFamilyForGoal(goalId: string) {
  const admin = supabaseAdmin();
  const goalRes = await admin.from("goals").select("*").eq("id", goalId).maybeSingle();
  if (goalRes.error || !goalRes.data) {
    return { goal: null, familyId: null, error: goalRes.error?.message ?? "Goal not found." };
  }

  const goalData = goalRes.data as GoalRow;
  const accountId = goalData.bank_account_id ?? goalData.account_id ?? null;
  if (!accountId) {
    return { goal: null, familyId: null, error: "Goal is not attached to any bank account." };
  }

  const account = await getAccount(accountId);
  if (account.error || !account.data) {
    return { goal: null, familyId: null, error: account.error ?? "Bank account not found." };
  }

  return {
    goal: goalData,
    familyId: account.data.family_id,
    error: null,
  };
}

async function applyAccountDelta(accountId: string, delta: number) {
  if (!delta) return { ok: true as const };

  const account = await getAccount(accountId);
  if (account.error || !account.data) {
    return { ok: false as const, error: account.error ?? "Bank account not found." };
  }

  const admin = supabaseAdmin();
  const nextBalance = asNumber(account.data.balance) + delta;
  const update = await admin.from("bank_accounts").update({ balance: nextBalance }).eq("id", accountId);
  if (update.error) return { ok: false as const, error: update.error.message };

  return { ok: true as const };
}

async function applyLoanRemainingDelta(loanId: string, delta: number) {
  if (!delta) return { ok: true as const };

  const loan = await getLoan(loanId);
  if (loan.error || !loan.data) {
    return { ok: false as const, error: loan.error ?? "Loan not found." };
  }
  if (!loan.data.family_id) {
    return { ok: false as const, error: "Loan is missing family_id." };
  }

  const admin = supabaseAdmin();
  const currentRemaining = asNumber(loan.data.remaining_amount, asNumber(loan.data.total_amount));
  const nextRemaining = Math.max(0, currentRemaining + delta);
  const update = await admin.from("loans").update({ remaining_amount: nextRemaining }).eq("id", loanId);
  if (update.error) {
    return { ok: false as const, error: update.error.message };
  }

  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const familyId = (request.nextUrl.searchParams.get("familyId") ?? "").trim();
  if (!familyId) {
    return NextResponse.json({ error: "familyId is required." }, { status: 400 });
  }

  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const access = await getAccessibleAccountIds(familyId, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  if (!access.accountIds.length) {
    return NextResponse.json({ goals: [] });
  }

  const listing = await listGoalsForFamily(familyId);
  if (listing.error) return NextResponse.json({ error: listing.error }, { status: 400 });
  const allowedSet = new Set(access.accountIds);
  return NextResponse.json({
    goals: (listing.goals ?? []).filter((goal) =>
      goal.bank_account_id ? allowedSet.has(goal.bank_account_id) : false
    ),
  });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    bank_account_id?: string;
    name?: string;
    target_amount?: number;
    current_amount?: number;
    deadline?: string | null;
  };

  const familyId = (payload.familyId ?? "").trim();
  const bankAccountId = (payload.bank_account_id ?? "").trim();
  const name = (payload.name ?? "").trim();
  const target = Math.max(0, asNumber(payload.target_amount));
  const current = Math.max(0, asNumber(payload.current_amount));
  const safeTarget = target > 0 ? target : 1;
  const deadline = payload.deadline?.trim() || null;

  if (!familyId || !bankAccountId || !name) {
    return NextResponse.json(
      { error: "familyId, bank_account_id and name are required." },
      { status: 400 }
    );
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const access = await ensureAccountAccess(familyId, user.id, bankAccountId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const account = await getAccount(bankAccountId);
  if (account.error || !account.data) {
    return NextResponse.json({ error: account.error ?? "Bank account not found." }, { status: 404 });
  }
  if (account.data.family_id !== familyId) {
    return NextResponse.json({ error: "Bank account does not belong to selected family." }, { status: 400 });
  }
  const legacyAccount = await ensureLegacyAccountForBankAccount(bankAccountId);
  if (!legacyAccount.ok) {
    return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
  }

  const admin = supabaseAdmin();
  let insert = await admin
    .from("goals")
    .insert({
      bank_account_id: bankAccountId,
      account_id: bankAccountId,
      user_id: user.id,
      name,
      target_amount: safeTarget,
      current_amount: current,
      deadline,
    })
    .select("*")
    .single();

  if (insert.error) {
    insert = await admin
      .from("goals")
      .insert({
        account_id: bankAccountId,
        user_id: user.id,
        name,
        target_amount: safeTarget,
        current_amount: current,
      })
      .select("*")
      .single();
  }

  if (insert.error || !insert.data) {
    return NextResponse.json({ error: insert.error?.message ?? "Failed to create goal." }, { status: 400 });
  }

  return NextResponse.json({ goal: normalizeGoal(insert.data as GoalRow) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    goalId?: string;
    name?: string;
    target_amount?: number;
    current_amount?: number;
    deadline?: string | null;
    bank_account_id?: string;
    contribution_amount?: number;
    contribution_category_id?: string | null;
    contribution_loan_id?: string | null;
    contribution_description?: string | null;
    contribution_date?: string;
  };

  const goalId = (payload.goalId ?? "").trim();
  if (!goalId) return NextResponse.json({ error: "goalId is required." }, { status: 400 });

  const resolved = await resolveFamilyForGoal(goalId);
  if (resolved.error || !resolved.familyId || !resolved.goal) {
    return NextResponse.json({ error: resolved.error ?? "Goal not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(resolved.familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const access = await getAccessibleAccountIds(resolved.familyId, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const accessibleSet = new Set(access.accountIds);
  const existingGoalAccountId = resolved.goal.bank_account_id ?? resolved.goal.account_id ?? null;
  if (existingGoalAccountId && !accessibleSet.has(existingGoalAccountId)) {
    return NextResponse.json({ error: "You do not have access to this goal account." }, { status: 403 });
  }

  const updatePayload: Record<string, unknown> = {};
  let effectiveBankAccountId = resolved.goal.bank_account_id ?? resolved.goal.account_id ?? null;

  if (payload.name !== undefined) updatePayload.name = payload.name.trim();
  if (payload.target_amount !== undefined) {
    const targetAmount = Math.max(0, asNumber(payload.target_amount));
    updatePayload.target_amount = targetAmount > 0 ? targetAmount : 1;
  }
  if (payload.deadline !== undefined) updatePayload.deadline = payload.deadline ? payload.deadline.slice(0, 10) : null;

  if (payload.bank_account_id !== undefined) {
    const accountId = payload.bank_account_id.trim();
    const account = await getAccount(accountId);
    if (account.error || !account.data) {
      return NextResponse.json({ error: account.error ?? "Bank account not found." }, { status: 404 });
    }
    if (account.data.family_id !== resolved.familyId) {
      return NextResponse.json({ error: "Bank account does not belong to this family." }, { status: 400 });
    }
    if (!accessibleSet.has(accountId)) {
      return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
    }
    const legacyAccount = await ensureLegacyAccountForBankAccount(accountId);
    if (!legacyAccount.ok) {
      return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
    }
    updatePayload.bank_account_id = accountId;
    effectiveBankAccountId = accountId;
  }

  const contributionAmount =
    payload.contribution_amount !== undefined ? Math.max(0, asNumber(payload.contribution_amount)) : 0;
  if (payload.current_amount !== undefined || contributionAmount > 0) {
    const baseCurrent =
      payload.current_amount !== undefined
        ? Math.max(0, asNumber(payload.current_amount))
        : Math.max(0, asNumber(resolved.goal.current_amount));
    updatePayload.current_amount = baseCurrent + contributionAmount;
  }

  if (!Object.keys(updatePayload).length && contributionAmount <= 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  if (contributionAmount > 0) {
    if (!effectiveBankAccountId) {
      return NextResponse.json({ error: "Goal has no bank account configured." }, { status: 400 });
    }

    const contributionCategoryId = (payload.contribution_category_id ?? "").trim();
    const contributionLoanId = (payload.contribution_loan_id ?? "").trim();
    let contributionCategoryAffectsLoan = false;
    let contributionCategoryName: string | null = null;
    if (contributionCategoryId) {
      const category = await getCategory(contributionCategoryId);
      if (category.error || !category.data) {
        return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
      }
      if (category.data.family_id !== resolved.familyId) {
        return NextResponse.json({ error: "Category does not belong to this family." }, { status: 400 });
      }
      contributionCategoryAffectsLoan = Boolean(category.data.affects_loan);
      contributionCategoryName = category.data.name;
    }

    const legacyAccount = await ensureLegacyAccountForBankAccount(effectiveBankAccountId);
    if (!legacyAccount.ok) {
      return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
    }

    if (contributionCategoryAffectsLoan && !contributionLoanId) {
      return NextResponse.json(
        { error: "Selected category affects loans. Please select which loan to apply." },
        { status: 400 }
      );
    }

    if (contributionLoanId) {
      const loan = await getLoan(contributionLoanId);
      if (loan.error || !loan.data) {
        return NextResponse.json({ error: loan.error ?? "Loan not found." }, { status: 404 });
      }
      if (loan.data.family_id !== resolved.familyId) {
        return NextResponse.json({ error: "Loan does not belong to this family." }, { status: 400 });
      }
    }

    const admin = supabaseAdmin();
    const creatorMemberRes = await admin
      .from("family_members")
      .select("id")
      .eq("family_id", resolved.familyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (creatorMemberRes.error) {
      return NextResponse.json({ error: creatorMemberRes.error.message }, { status: 400 });
    }
    const creatorMemberId = (creatorMemberRes.data?.id as string | undefined) ?? null;
    const baseContributionDescription =
      payload.contribution_description?.trim() || `Goal contribution: ${(resolved.goal.name ?? "Goal").trim() || "Goal"}`;

    const transactionInsert = await admin.from("transactions").insert({
      family_id: resolved.familyId,
      bank_account_id: effectiveBankAccountId,
      account_id: effectiveBankAccountId,
      created_by: user.id,
      user_id: user.id,
      assigned_to: creatorMemberId,
      amount: contributionAmount,
      type: "expense",
      category_id: contributionCategoryId || null,
      category: contributionCategoryName ?? "Goal contribution",
      description: withLoanTag(
        baseContributionDescription,
        contributionCategoryAffectsLoan ? contributionLoanId || null : null
      ),
      date: (payload.contribution_date ?? todayIsoDate()).slice(0, 10),
    });

    if (transactionInsert.error) {
      return NextResponse.json(
        { error: `Could not register contribution transaction: ${transactionInsert.error.message}` },
        { status: 400 }
      );
    }

    const balanceUpdate = await applyAccountDelta(effectiveBankAccountId, -contributionAmount);
    if (!balanceUpdate.ok) {
      return NextResponse.json({ error: balanceUpdate.error }, { status: 400 });
    }

    if (contributionLoanId && contributionCategoryAffectsLoan) {
      const loanUpdate = await applyLoanRemainingDelta(contributionLoanId, -contributionAmount);
      if (!loanUpdate.ok) {
        return NextResponse.json({ error: loanUpdate.error }, { status: 400 });
      }
    }
  }

  const admin = supabaseAdmin();
  let update = await admin.from("goals").update(updatePayload).eq("id", goalId).select("*").single();
  if (update.error && updatePayload.bank_account_id) {
    const fallbackPayload: Record<string, unknown> = {};
    Object.entries(updatePayload).forEach(([key, value]) => {
      if (key !== "bank_account_id") fallbackPayload[key] = value;
    });
    fallbackPayload.account_id = updatePayload.bank_account_id;
    update = await admin.from("goals").update(fallbackPayload).eq("id", goalId).select("*").single();
  }

  if (update.error || !update.data) {
    return NextResponse.json({ error: update.error?.message ?? "Failed to update goal." }, { status: 400 });
  }

  return NextResponse.json({ goal: normalizeGoal(update.data as GoalRow) });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { goalId?: string };
  const goalId = (payload.goalId ?? "").trim();
  if (!goalId) return NextResponse.json({ error: "goalId is required." }, { status: 400 });

  const resolved = await resolveFamilyForGoal(goalId);
  if (resolved.error || !resolved.familyId) {
    return NextResponse.json({ error: resolved.error ?? "Goal not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(resolved.familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const access = await getAccessibleAccountIds(resolved.familyId, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const goalAccountId = resolved.goal?.bank_account_id ?? resolved.goal?.account_id ?? null;
  if (goalAccountId && !access.accountIds.includes(goalAccountId)) {
    return NextResponse.json({ error: "You do not have access to this goal account." }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const del = await admin.from("goals").delete().eq("id", goalId);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
