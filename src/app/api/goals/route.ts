import { NextRequest, NextResponse } from "next/server";
import {
  asNumber,
  ensureAccountAccess,
  ensureLegacyAccountForBankAccount,
  ensureFamilyMember,
  getAccessibleAccountIds,
  getAccount,
  getRequestUser,
  todayIsoDate,
} from "@/lib/api-auth";
import { type GoalMoveType } from "@/lib/goal-moves";
import { IDEMPOTENCY_KEY_HEADER, normalizeIdempotencyKey } from "@/lib/goal-movement-idempotency";
import { toMoneyCents } from "@/lib/goal-movement-state";
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

const normalizeGoal = (goal: GoalRow) => ({
  id: goal.id,
  name: goal.name ?? "Goal",
  target_amount: asNumber(goal.target_amount),
  current_amount: asNumber(goal.current_amount),
  deadline: goal.deadline ?? null,
  bank_account_id: goal.bank_account_id ?? goal.account_id ?? null,
});

const pickGoalId = (payload: { goalId?: string; id?: string } | null | undefined) =>
  (payload?.goalId ?? payload?.id ?? "").trim();

const pickBankAccountId = (payload: { bank_account_id?: string; accountId?: string } | null | undefined) =>
  (payload?.bank_account_id ?? payload?.accountId ?? "").trim();

async function listGoalsForAccounts(accountIds: string[]) {
  if (!accountIds.length) return { goals: [] as ReturnType<typeof normalizeGoal>[], error: null };

  const goalsRes = await supabaseAdmin()
    .from("goals")
    .select("*")
    .in("bank_account_id", accountIds)
    .order("current_amount", { ascending: false })
    .order("name", { ascending: true });
  if (goalsRes.error) return { goals: null, error: goalsRes.error.message };
  return { goals: ((goalsRes.data ?? []) as GoalRow[]).map(normalizeGoal), error: null };
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

type GoalMovementRpcResult = {
  goal?: GoalRow;
  replayed?: boolean;
};

type GoalMovementRpcError = {
  code?: string;
  message?: string;
};

const movementRpcError = (error: GoalMovementRpcError) => {
  const message = error.message ?? "";
  const lower = message.toLowerCase();

  if (error.code === "PGRST202" || (lower.includes("apply_goal_movement_v1") && lower.includes("schema cache"))) {
    return {
      status: 503,
      message: "A atualização de movimentos seguros ainda não está instalada. Nenhum valor foi alterado.",
    };
  }
  if (message.includes("HOMEFUND_IDEMPOTENCY_CONFLICT")) {
    return { status: 409, message: "Esta chave de operação já foi usada com dados diferentes." };
  }
  if (message.includes("HOMEFUND_INSUFFICIENT")) {
    return { status: 409, message: "A poupança não tem saldo suficiente para esse movimento." };
  }
  if (message.includes("HOMEFUND_FORBIDDEN")) {
    return { status: 403, message: "Não tens permissão para alterar esta poupança." };
  }
  if (message.includes("HOMEFUND_NOT_FOUND")) {
    return { status: 404, message: "A poupança ou um dos registos associados já não existe." };
  }
  if (message.includes("HOMEFUND_INVALID")) {
    return { status: 400, message: "Os dados do movimento são inválidos. Atualiza a página e tenta novamente." };
  }
  if (message.includes("HOMEFUND_CONFLICT")) {
    return { status: 409, message: "Os dados financeiros mudaram durante o pedido. Atualiza a página e tenta novamente." };
  }

  return {
    status: 503,
    message: "Não foi possível registar o movimento de forma atómica. Nenhum valor foi alterado; podes tentar novamente.",
  };
};

async function registerGoalMovement(input: {
  operationId: string;
  familyId: string;
  goalId: string;
  bankAccountId: string;
  userId: string;
  amount: number;
  moveType: GoalMoveType;
  categoryId?: string | null;
  loanId?: string | null;
  description?: string | null;
  date?: string | null;
  assignedTo?: string | null;
}) {
  const admin = supabaseAdmin() as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: GoalMovementRpcError | null }>;
  };
  const { data, error } = await admin.rpc("apply_goal_movement_v1", {
    p_operation_id: input.operationId,
    p_family_id: input.familyId,
    p_goal_id: input.goalId,
    p_bank_account_id: input.bankAccountId,
    p_user_id: input.userId,
    p_move_type: input.moveType,
    p_amount_cents: toMoneyCents(input.amount),
    p_movement_date: (input.date ?? todayIsoDate()).slice(0, 10),
    p_description: input.description?.trim() || null,
    p_category_id: input.categoryId?.trim() || null,
    p_loan_id: input.loanId?.trim() || null,
    p_requested_assigned_to: input.assignedTo?.trim() || null,
  });

  if (error) {
    const mapped = movementRpcError(error);
    return { ok: false as const, error: mapped.message, status: mapped.status };
  }

  const raw = (Array.isArray(data) ? data[0] : data) as GoalMovementRpcResult | null;
  if (!raw?.goal?.id) {
    return {
      ok: false as const,
      status: 503,
      error: "A base de dados não confirmou o movimento. Nenhum novo pedido será criado automaticamente.",
    };
  }

  return {
    ok: true as const,
    goal: normalizeGoal(raw.goal),
    replayed: Boolean(raw.replayed),
  };
}

export async function GET(request: NextRequest) {
  const familyId = (request.nextUrl.searchParams.get("familyId") ?? "").trim();
  const goalId = (request.nextUrl.searchParams.get("goalId") ?? request.nextUrl.searchParams.get("id") ?? "").trim();
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
    return goalId ? NextResponse.json({ error: "Goal not found." }, { status: 404 }) : NextResponse.json({ goals: [] });
  }

  const listing = await listGoalsForAccounts(access.accountIds);
  if (listing.error) return NextResponse.json({ error: listing.error }, { status: 400 });
  const goals = listing.goals ?? [];

  if (goalId) {
    const goal = goals.find((entry) => entry.id === goalId) ?? null;
    if (!goal) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    return NextResponse.json({ goal });
  }

  return NextResponse.json({ goals });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    bank_account_id?: string;
    accountId?: string;
    name?: string;
    target_amount?: number;
    current_amount?: number;
    deadline?: string | null;
  };

  const familyId = (payload.familyId ?? "").trim();
  const bankAccountId = pickBankAccountId(payload);
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
    id?: string;
    name?: string;
    target_amount?: number;
    current_amount?: number;
    deadline?: string | null;
    bank_account_id?: string;
    accountId?: string;
    contribution_amount?: number;
    contribution_category_id?: string | null;
    contribution_loan_id?: string | null;
    contribution_description?: string | null;
    contribution_date?: string;
    movement_type?: GoalMoveType;
    movement_amount?: number;
    movement_category_id?: string | null;
    movement_loan_id?: string | null;
    movement_description?: string | null;
    movement_date?: string;
    movement_assigned_to?: string | null;
    operation_id?: string;
  };

  const goalId = pickGoalId(payload);
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

  const movementTypeInput = payload.movement_type ?? (payload.contribution_amount !== undefined ? "allocate" : undefined);
  const movementAmountRaw =
    payload.movement_amount !== undefined
      ? payload.movement_amount
      : payload.contribution_amount !== undefined
        ? payload.contribution_amount
        : undefined;
  const isMovementRequest = movementTypeInput !== undefined || movementAmountRaw !== undefined;

  if (isMovementRequest) {
    if (movementTypeInput !== "allocate" && movementTypeInput !== "release" && movementTypeInput !== "spend") {
      return NextResponse.json({ error: "movement_type is invalid." }, { status: 400 });
    }
    const movementAmount = asNumber(movementAmountRaw);
    if (toMoneyCents(movementAmount) <= 0) {
      return NextResponse.json({ error: "movement_amount must be greater than zero." }, { status: 400 });
    }
    if (
      payload.name !== undefined ||
      payload.target_amount !== undefined ||
      payload.current_amount !== undefined ||
      payload.deadline !== undefined ||
      payload.bank_account_id !== undefined ||
      payload.accountId !== undefined
    ) {
      return NextResponse.json(
        { error: "Não combines um movimento financeiro com alterações aos detalhes da poupança." },
        { status: 400 }
      );
    }
    if (!existingGoalAccountId) {
      return NextResponse.json({ error: "Goal has no bank account configured." }, { status: 400 });
    }

    const operationId = normalizeIdempotencyKey(
      request.headers.get(IDEMPOTENCY_KEY_HEADER) ?? payload.operation_id
    );
    if (!operationId) {
      return NextResponse.json(
        { error: "É necessária uma chave Idempotency-Key UUID v4 para movimentos financeiros." },
        { status: 400 }
      );
    }

    const legacyAccount = await ensureLegacyAccountForBankAccount(existingGoalAccountId);
    if (!legacyAccount.ok) {
      return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
    }

    const movement = await registerGoalMovement({
      operationId,
      familyId: resolved.familyId,
      goalId,
      bankAccountId: existingGoalAccountId,
      userId: user.id,
      amount: movementAmount,
      moveType: movementTypeInput,
      categoryId: payload.movement_category_id ?? payload.contribution_category_id ?? null,
      loanId: payload.movement_loan_id ?? payload.contribution_loan_id ?? null,
      description: payload.movement_description ?? payload.contribution_description ?? null,
      date: payload.movement_date ?? payload.contribution_date ?? null,
      assignedTo: payload.movement_assigned_to ?? null,
    });

    if (!movement.ok) {
      return NextResponse.json({ error: movement.error }, { status: movement.status });
    }
    return NextResponse.json({ goal: movement.goal, replayed: movement.replayed });
  }

  const updatePayload: Record<string, unknown> = {};

  if (payload.name !== undefined) updatePayload.name = payload.name.trim();
  if (payload.target_amount !== undefined) {
    const targetAmount = Math.max(0, asNumber(payload.target_amount));
    updatePayload.target_amount = targetAmount > 0 ? targetAmount : 1;
  }
  if (payload.deadline !== undefined) updatePayload.deadline = payload.deadline ? payload.deadline.slice(0, 10) : null;

  if (payload.bank_account_id !== undefined || payload.accountId !== undefined) {
    const accountId = pickBankAccountId(payload);
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
  }

  if (payload.current_amount !== undefined) {
    updatePayload.current_amount = Math.max(0, asNumber(payload.current_amount));
  }

  if (!Object.keys(updatePayload).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
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

  const payload = (await request.json().catch(() => ({}))) as { goalId?: string; id?: string };
  const goalId = pickGoalId(payload);
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
