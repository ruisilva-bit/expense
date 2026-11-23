import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  asNumber,
  ensureAccountAccess,
  ensureFamilyMember,
  getAccessibleAccountIds,
  getAccountMembershipMap,
  getAccount,
  getCategory,
  getRequestUser,
  todayIsoDate,
} from "@/lib/api-auth";
import {
  effectiveMemberIds,
  stripMemberTag,
  withMemberIdsTag,
} from "@/lib/member-tags";
import { supabaseAdmin } from "@/lib/supabase-admin";

type RecurringRow = {
  id: string;
  family_id: string;
  bank_account_id: string;
  assigned_to: string | null;
  amount: number | string | null;
  category_id: string | null;
  frequency: string | null;
  next_execution_date: string | null;
  description: string | null;
  created_at: string | null;
  created_by: string | null;
};
type FamilyMemberRow = { id: string; name: string | null; user_id?: string | null };
type CategoryRow = { id: string; name: string | null; color?: string | null };
type QueryError = { message: string } | null;
type CategoryQueryResult = { data: CategoryRow[] | null; error: QueryError };
type RecurringCategory = { id: string; name: string | null; type: string | null; affects_loan: boolean | null };

const isMissingColorColumnError = (message: string) => {
  const lower = message.toLowerCase();
  const mentionsColorColumn = lower.includes("color") && (lower.includes("column") || lower.includes("schema cache"));
  const missingSignal = lower.includes("does not exist") || lower.includes("could not find");
  return mentionsColorColumn && missingSignal;
};

const GOAL_TAG_REGEX = /\[goal:([0-9a-fA-F-]{36})\]/;
const LOAN_TAG_REGEX = /\[loan:([0-9a-fA-F-]{36})\]/;
const RECURRING_TAG_REGEX = /\s*\[recurring:([0-9a-fA-F-]{36}):(\d{4}-\d{2}-\d{2})\]\s*$/;
const RECURRING_MARKER_REGEX = /\[recurring:([0-9a-fA-F-]{36}):(\d{4}-\d{2}-\d{2})\]/;

const isDuplicateKeyError = (message: string | undefined) => {
  const lower = (message ?? "").toLowerCase();
  return lower.includes("duplicate key") || lower.includes("unique constraint");
};

const deterministicRecurringTransactionId = (recurringId: string, occurrenceDate: string, bankAccountId: string) => {
  const base = createHash("sha256")
    .update(`${recurringId}:${occurrenceDate}:${bankAccountId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");

  base[12] = "5";
  const variantNibble = Number.parseInt(base[16] ?? "0", 16);
  base[16] = ((variantNibble & 0x3) | 0x8).toString(16);

  const hex = base.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const normalizeFrequency = (value: string | null | undefined) => {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "every:1:month";

  const modern = raw.match(/^every:(\d+):(day|days|week|weeks|month|months|year|years)$/);
  if (modern) {
    const interval = Math.max(1, Number(modern[1] ?? 1));
    const unitRaw = modern[2] ?? "month";
    const unit = unitRaw.endsWith("s") ? unitRaw.slice(0, -1) : unitRaw;
    return `every:${interval}:${unit}`;
  }

  const text = raw.match(/^every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)$/);
  if (text) {
    const interval = Math.max(1, Number(text[1] ?? 1));
    const unitRaw = text[2] ?? "month";
    const unit = unitRaw.endsWith("s") ? unitRaw.slice(0, -1) : unitRaw;
    return `every:${interval}:${unit}`;
  }

  if (raw === "daily") return "every:1:day";
  if (raw === "weekly") return "every:1:week";
  if (raw === "monthly") return "every:1:month";
  if (raw === "quarterly") return "every:3:month";
  if (raw === "yearly") return "every:1:year";

  return "every:1:month";
};

const parseFrequency = (value: string | null | undefined) => {
  const normalized = normalizeFrequency(value);
  const parsed = normalized.match(/^every:(\d+):(day|week|month|year)$/);
  if (!parsed) return { interval: 1, unit: "month" as const };
  const interval = Math.max(1, Number(parsed[1] ?? 1));
  const unit = parsed[2] as "day" | "week" | "month" | "year";
  return { interval, unit };
};

const nextDateFromFrequency = (startDate: string, frequency: string | null | undefined) => {
  const { interval, unit } = parseFrequency(frequency);
  const next = new Date(`${startDate}T00:00:00.000Z`);
  if (unit === "day") next.setUTCDate(next.getUTCDate() + interval);
  if (unit === "week") next.setUTCDate(next.getUTCDate() + interval * 7);
  if (unit === "month") next.setUTCMonth(next.getUTCMonth() + interval);
  if (unit === "year") next.setUTCFullYear(next.getUTCFullYear() + interval);
  return next.toISOString().slice(0, 10);
};

const withRecurringTag = (description: string | null, recurringId: string, occurrenceDate: string) => {
  const clean = (description ?? "").replace(RECURRING_TAG_REGEX, "").trim();
  const tag = `[recurring:${recurringId}:${occurrenceDate}]`;
  return clean ? `${clean} ${tag}` : tag;
};

const normalizeRow = (row: RecurringRow) => ({
  id: row.id,
  family_id: row.family_id,
  bank_account_id: row.bank_account_id,
  assigned_to: row.assigned_to,
  amount: asNumber(row.amount),
  category_id: row.category_id,
  frequency: normalizeFrequency(row.frequency),
  next_execution_date: row.next_execution_date ?? todayIsoDate(),
  description: row.description,
  created_at: row.created_at,
});

async function memberBelongsToFamily(memberId: string, familyId: string) {
  const admin = supabaseAdmin();
  const member = await admin
    .from("family_members")
    .select("id")
    .eq("id", memberId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (member.error) return { ok: false as const, error: member.error.message };
  if (!member.data) return { ok: false as const, error: "Member does not belong to this family." };
  return { ok: true as const };
}

async function materializeRecurringBackfill(input: {
  recurringId: string;
  familyId: string;
  bankAccountId: string;
  assignedTo: string | null;
  amount: number;
  categoryId: string | null;
  frequency: string;
  nextExecutionDate: string;
  description: string | null;
  createdBy: string;
}) {
  const admin = supabaseAdmin();
  const today = todayIsoDate();
  const account = await getAccount(input.bankAccountId);
  if (account.error || !account.data) {
    return { nextExecutionDate: input.nextExecutionDate, insertedCount: 0, error: account.error ?? "Bank account not found." };
  }

  let categoryInfo: RecurringCategory | null = null;
  if (input.categoryId) {
    const category = await getCategory(input.categoryId);
    if (category.error || !category.data) {
      return { nextExecutionDate: input.nextExecutionDate, insertedCount: 0, error: category.error ?? "Category not found." };
    }
    categoryInfo = category.data as RecurringCategory;
  }

  const txnType = categoryInfo?.type === "income" ? "income" : "expense";
  const categoryLabel = categoryInfo?.name ?? "Recurring";
  const affectsLoan = Boolean(categoryInfo?.affects_loan);

  let occurrenceDate = input.nextExecutionDate;
  let insertedCount = 0;
  let runningBalance = asNumber(account.data.balance);
  let iterations = 0;

  while (occurrenceDate <= today) {
    iterations += 1;
    if (iterations > 5000) {
      return { nextExecutionDate: occurrenceDate, insertedCount, error: "Recurring backfill exceeded safety limit." };
    }

    const marker = `[recurring:${input.recurringId}:${occurrenceDate}]`;
    const description = withRecurringTag(input.description, input.recurringId, occurrenceDate);
    const existingQuery = admin
      .from("transactions")
      .select("id")
      .eq("family_id", input.familyId)
      .eq("bank_account_id", input.bankAccountId)
      .eq("date", occurrenceDate)
      .ilike("description", `%${marker}%`)
      .limit(1);

    const existingTxn = await existingQuery.maybeSingle();
    if (existingTxn.error) {
      return { nextExecutionDate: occurrenceDate, insertedCount, error: existingTxn.error.message };
    }

    if (!existingTxn.data) {
      const deterministicId = deterministicRecurringTransactionId(
        input.recurringId,
        occurrenceDate,
        input.bankAccountId
      );
      const insert = await admin.from("transactions").insert({
        id: deterministicId,
        family_id: input.familyId,
        bank_account_id: input.bankAccountId,
        account_id: input.bankAccountId,
        assigned_to: input.assignedTo,
        amount: input.amount,
        type: txnType,
        category_id: input.categoryId,
        category: categoryLabel,
        description,
        date: occurrenceDate,
        created_by: input.createdBy,
        user_id: input.createdBy,
      });

      if (insert.error) {
        if (isDuplicateKeyError(insert.error.message)) {
          occurrenceDate = nextDateFromFrequency(occurrenceDate, input.frequency);
          continue;
        }
        return { nextExecutionDate: occurrenceDate, insertedCount, error: insert.error.message };
      }

      runningBalance += txnType === "income" ? input.amount : -input.amount;
      insertedCount += 1;

      const goalMatch = (input.description ?? "").match(GOAL_TAG_REGEX);
      const goalId = goalMatch?.[1] ?? null;
      if (goalId && input.amount > 0) {
        const goalRes = await admin.from("goals").select("id,current_amount").eq("id", goalId).maybeSingle();
        if (!goalRes.error && goalRes.data) {
          const goalAmount = asNumber(goalRes.data.current_amount) + input.amount;
          await admin.from("goals").update({ current_amount: goalAmount }).eq("id", goalId);
        }
      }

      if (txnType === "expense" && affectsLoan && input.amount > 0) {
        const loanMatch = (input.description ?? "").match(LOAN_TAG_REGEX);
        const loanId = loanMatch?.[1] ?? null;
        if (loanId) {
          const loanRes = await admin
            .from("loans")
            .select("id,remaining_amount,total_amount")
            .eq("id", loanId)
            .maybeSingle();
          if (!loanRes.error && loanRes.data) {
            const currentRemaining = asNumber(loanRes.data.remaining_amount, asNumber(loanRes.data.total_amount));
            await admin
              .from("loans")
              .update({ remaining_amount: Math.max(0, currentRemaining - input.amount) })
              .eq("id", loanId);
          }
        }
      }
    }

    occurrenceDate = nextDateFromFrequency(occurrenceDate, input.frequency);
  }

  if (insertedCount > 0) {
    const balanceUpdate = await admin
      .from("bank_accounts")
      .update({ balance: runningBalance })
      .eq("id", input.bankAccountId);
    if (balanceUpdate.error) {
      return { nextExecutionDate: occurrenceDate, insertedCount, error: balanceUpdate.error.message };
    }
  }

  return { nextExecutionDate: occurrenceDate, insertedCount, error: null };
}

type RecurringTaggedTxnRow = {
  id: string;
  bank_account_id: string;
  amount: number | string | null;
  type: string | null;
  category_id: string | null;
  description: string | null;
  created_at: string | null;
};

async function cleanupRecurringDuplicates(familyId: string, accountIds: string[]) {
  if (!accountIds.length) {
    return { removedCount: 0, fixedGroups: 0, errors: [] as string[] };
  }

  const admin = supabaseAdmin();
  const taggedTxRes = await admin
    .from("transactions")
    .select("id,bank_account_id,amount,type,category_id,description,created_at")
    .eq("family_id", familyId)
    .in("bank_account_id", accountIds)
    .ilike("description", "%[recurring:%");

  if (taggedTxRes.error) {
    return { removedCount: 0, fixedGroups: 0, errors: [taggedTxRes.error.message] };
  }

  const categoriesRes = await admin
    .from("categories")
    .select("id,affects_loan")
    .eq("family_id", familyId);
  const categoryAffectsLoan = new Map<string, boolean>(
    (categoriesRes.data ?? []).map((row) => [row.id as string, Boolean(row.affects_loan)])
  );

  const grouped = new Map<string, RecurringTaggedTxnRow[]>();
  ((taggedTxRes.data ?? []) as RecurringTaggedTxnRow[]).forEach((row) => {
    const marker = row.description?.match(RECURRING_MARKER_REGEX)?.[0];
    if (!marker) return;
    const key = `${row.bank_account_id}:${marker}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  });

  const idsToDelete: string[] = [];
  let fixedGroups = 0;

  grouped.forEach((rows) => {
    if (rows.length <= 1) return;
    fixedGroups += 1;
    rows.sort((a, b) => {
      const byDate = (a.created_at ?? "").localeCompare(b.created_at ?? "");
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });

    rows.slice(1).forEach((row) => {
      idsToDelete.push(row.id);
    });
  });

  if (!idsToDelete.length) {
    return { removedCount: 0, fixedGroups: 0, errors: [] as string[] };
  }

  const errors: string[] = [];
  const deletedRows: RecurringTaggedTxnRow[] = [];
  for (let index = 0; index < idsToDelete.length; index += 200) {
    const chunk = idsToDelete.slice(index, index + 200);
    const deletion = await admin
      .from("transactions")
      .delete()
      .in("id", chunk)
      .select("id,bank_account_id,amount,type,category_id,description,created_at");
    if (deletion.error) {
      errors.push(deletion.error.message);
      continue;
    }
    deletedRows.push(...((deletion.data ?? []) as RecurringTaggedTxnRow[]));
  }

  const bankDeltas = new Map<string, number>();
  const goalDeltas = new Map<string, number>();
  const loanDeltas = new Map<string, number>();
  deletedRows.forEach((row) => {
    const amount = asNumber(row.amount);
    const type = (row.type ?? "").toLowerCase();
    const currentBankDelta = bankDeltas.get(row.bank_account_id) ?? 0;
    if (type === "income") bankDeltas.set(row.bank_account_id, currentBankDelta - amount);
    if (type === "expense") bankDeltas.set(row.bank_account_id, currentBankDelta + amount);

    const goalMatch = (row.description ?? "").match(GOAL_TAG_REGEX);
    const goalId = goalMatch?.[1] ?? null;
    if (goalId && amount > 0) {
      goalDeltas.set(goalId, (goalDeltas.get(goalId) ?? 0) - amount);
    }

    const loanMatch = (row.description ?? "").match(LOAN_TAG_REGEX);
    const loanId = loanMatch?.[1] ?? null;
    const affectsLoan = row.category_id ? Boolean(categoryAffectsLoan.get(row.category_id)) : false;
    if (loanId && affectsLoan && type === "expense" && amount > 0) {
      loanDeltas.set(loanId, (loanDeltas.get(loanId) ?? 0) + amount);
    }
  });

  for (const [accountId, delta] of bankDeltas.entries()) {
    if (!delta) continue;
    const account = await getAccount(accountId);
    if (account.error || !account.data) {
      errors.push(account.error ?? `Could not load account ${accountId} while fixing duplicates.`);
      continue;
    }
    const nextBalance = asNumber(account.data.balance) + delta;
    const update = await admin.from("bank_accounts").update({ balance: nextBalance }).eq("id", accountId);
    if (update.error) errors.push(update.error.message);
  }

  for (const [goalId, delta] of goalDeltas.entries()) {
    if (!delta) continue;
    const goal = await admin.from("goals").select("id,current_amount").eq("id", goalId).maybeSingle();
    if (goal.error || !goal.data) {
      errors.push(goal.error?.message ?? `Could not load goal ${goalId} while fixing duplicates.`);
      continue;
    }
    const nextAmount = Math.max(0, asNumber(goal.data.current_amount) + delta);
    const update = await admin.from("goals").update({ current_amount: nextAmount }).eq("id", goalId);
    if (update.error) errors.push(update.error.message);
  }

  for (const [loanId, delta] of loanDeltas.entries()) {
    if (!delta) continue;
    const loan = await admin
      .from("loans")
      .select("id,remaining_amount,total_amount")
      .eq("id", loanId)
      .maybeSingle();
    if (loan.error || !loan.data) {
      errors.push(loan.error?.message ?? `Could not load loan ${loanId} while fixing duplicates.`);
      continue;
    }
    const currentRemaining = asNumber(loan.data.remaining_amount, asNumber(loan.data.total_amount));
    const nextRemaining = Math.max(0, currentRemaining + delta);
    const update = await admin.from("loans").update({ remaining_amount: nextRemaining }).eq("id", loanId);
    if (update.error) errors.push(update.error.message);
  }

  return { removedCount: deletedRows.length, fixedGroups, errors };
}

async function reconcileRecurringRows(recurringRows: RecurringRow[], fallbackUserId: string) {
  const admin = supabaseAdmin();
  const today = todayIsoDate();
  const rowsById = new Map<string, RecurringRow>(recurringRows.map((row) => [row.id, row]));

  let insertedCount = 0;
  let updatedSchedules = 0;
  const errors: string[] = [];

  for (const row of recurringRows) {
    const normalized = normalizeRow(row);
    if (normalized.next_execution_date > today) continue;

    const backfill = await materializeRecurringBackfill({
      recurringId: normalized.id,
      familyId: normalized.family_id,
      bankAccountId: normalized.bank_account_id,
      assignedTo: normalized.assigned_to,
      amount: normalized.amount,
      categoryId: normalized.category_id,
      frequency: normalized.frequency,
      nextExecutionDate: normalized.next_execution_date,
      description: normalized.description,
      createdBy: row.created_by || fallbackUserId,
    });

    if (backfill.error) {
      errors.push(`${row.id}: ${backfill.error}`);
      continue;
    }

    insertedCount += backfill.insertedCount;

    if (backfill.nextExecutionDate !== normalized.next_execution_date) {
      const update = await admin
        .from("recurring_transactions")
        .update({ next_execution_date: backfill.nextExecutionDate })
        .eq("id", row.id)
        .select("*")
        .single();

      if (update.error || !update.data) {
        errors.push(`${row.id}: ${update.error?.message ?? "Failed to update next execution date."}`);
        continue;
      }

      rowsById.set(row.id, update.data as RecurringRow);
      updatedSchedules += 1;
    }
  }

  return {
    rows: recurringRows.map((row) => rowsById.get(row.id) ?? row),
    insertedCount,
    updatedSchedules,
    errors,
  };
}

export async function GET(request: NextRequest) {
  const familyId = (request.nextUrl.searchParams.get("familyId") ?? "").trim();
  if (!familyId) {
    return NextResponse.json({ error: "familyId is required." }, { status: 400 });
  }

  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const access = await getAccessibleAccountIds(familyId, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const accessibleAccountIds = access.accountIds;
  if (!accessibleAccountIds.length) {
    return NextResponse.json({
      recurring: [],
      members: [],
      accounts: [],
      categories: [],
    });
  }

  const admin = supabaseAdmin();
  const recurringRes = await admin
    .from("recurring_transactions")
    .select("*")
    .eq("family_id", familyId)
    .in("bank_account_id", accessibleAccountIds)
    .order("next_execution_date", { ascending: true });

  if (recurringRes.error) {
    return NextResponse.json({ error: recurringRes.error.message }, { status: 400 });
  }

  const dedupe = await cleanupRecurringDuplicates(familyId, accessibleAccountIds);
  const reconciliation = await reconcileRecurringRows((recurringRes.data ?? []) as RecurringRow[], user.id);

  let categoriesRes = (await admin
    .from("categories")
    .select("id,name,color")
    .eq("family_id", familyId)) as CategoryQueryResult;
  let includeColor = true;
  if (categoriesRes.error && isMissingColorColumnError(categoriesRes.error.message)) {
    includeColor = false;
    categoriesRes = (await admin.from("categories").select("id,name").eq("family_id", familyId)) as CategoryQueryResult;
  }

  const [membersRes, accountsRes] = await Promise.all([
    admin.from("family_members").select("id,name,user_id").eq("family_id", familyId),
    admin.from("bank_accounts").select("id,name").eq("family_id", familyId).in("id", accessibleAccountIds),
  ]);

  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 400 });
  if (categoriesRes.error) return NextResponse.json({ error: categoriesRes.error.message }, { status: 400 });

  const familyMembers = (membersRes.data ?? []) as FamilyMemberRow[];
  const membersById = new Map(familyMembers.map((member) => [member.id, member.name]));
  const memberByUserId = new Map(
    familyMembers
      .filter((member) => Boolean(member.user_id))
      .map((member) => [member.user_id as string, member.id])
  );
  const accountsById = new Map((accountsRes.data ?? []).map((account) => [account.id, account.name]));
  const categoriesById = new Map((categoriesRes.data ?? []).map((category) => [category.id, category.name]));
  const accountMembership = await getAccountMembershipMap((accountsRes.data ?? []).map((account) => account.id as string));
  if (accountMembership.error) return NextResponse.json({ error: accountMembership.error }, { status: 400 });
  const realUserIds = Array.from(memberByUserId.keys());
  const accountsWithMeta = (accountsRes.data ?? []).map((account) => {
    const rows = accountMembership.map.get(account.id as string) ?? [];
    const visibleUserIds = rows.length
      ? Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)))
      : realUserIds;
    const memberIds = visibleUserIds
      .map((userId) => memberByUserId.get(userId))
      .filter((value): value is string => Boolean(value));
    return {
      id: account.id,
      name: account.name ?? "Account",
      is_shared: memberIds.length > 1,
      member_ids: memberIds,
    };
  });

  const recurring = (reconciliation.rows as RecurringRow[]).map((row) => {
    const normalized = normalizeRow(row);
    const memberIds = effectiveMemberIds(normalized.assigned_to, normalized.description);
    const memberNames = memberIds
      .map((memberId) => membersById.get(memberId))
      .filter((value): value is string => Boolean(value));
    return {
      ...normalized,
      member_name:
        memberNames.length > 1
          ? `All members (${memberNames.length})`
          : memberNames.length === 1
            ? memberNames[0]
            : null,
      account_name: accountsById.get(normalized.bank_account_id) ?? "Account",
      category_name: normalized.category_id ? categoriesById.get(normalized.category_id) ?? "Category" : null,
      description: stripMemberTag(normalized.description),
    };
  });

  return NextResponse.json({
    recurring,
    members: familyMembers.map((member) => ({ id: member.id, name: member.name ?? "Member" })),
    accounts: accountsWithMeta,
    categories: ((categoriesRes.data ?? []) as CategoryRow[]).map((category) => ({
      id: category.id,
      name: category.name ?? "Category",
      color: includeColor ? category.color ?? null : null,
    })),
    reconciliation: {
      inserted_occurrences: reconciliation.insertedCount,
      updated_schedules: reconciliation.updatedSchedules,
      removed_duplicates: dedupe.removedCount,
      fixed_duplicate_groups: dedupe.fixedGroups,
      errors: [...dedupe.errors, ...reconciliation.errors],
    },
  });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    action?: string;
    familyId?: string;
    bank_account_id?: string;
    assigned_to?: string | null;
    member_ids?: string[];
    amount?: number;
    category_id?: string | null;
    frequency?: string;
    next_execution_date?: string;
    description?: string;
  };

  const familyId = (payload.familyId ?? "").trim();
  const action = (payload.action ?? "").trim().toLowerCase();

  if (action === "recalculate") {
    if (!familyId) {
      return NextResponse.json({ error: "familyId is required." }, { status: 400 });
    }

    const membership = await ensureFamilyMember(familyId, user.id);
    if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

    const access = await getAccessibleAccountIds(familyId, user.id);
    if (access.error || !access.accountIds) {
      return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
    }
    if (!access.accountIds.length) {
      return NextResponse.json({
        success: true,
        processed_recurring: 0,
        inserted_occurrences: 0,
        updated_schedules: 0,
        errors: [],
      });
    }

    const admin = supabaseAdmin();
    const recurringRes = await admin
      .from("recurring_transactions")
      .select("*")
      .eq("family_id", familyId)
      .in("bank_account_id", access.accountIds)
      .order("next_execution_date", { ascending: true });

    if (recurringRes.error) {
      return NextResponse.json({ error: recurringRes.error.message }, { status: 400 });
    }

    const dedupe = await cleanupRecurringDuplicates(familyId, access.accountIds);
    const reconciliation = await reconcileRecurringRows((recurringRes.data ?? []) as RecurringRow[], user.id);

    return NextResponse.json({
      success: true,
      processed_recurring: (recurringRes.data ?? []).length,
      inserted_occurrences: reconciliation.insertedCount,
      updated_schedules: reconciliation.updatedSchedules,
      removed_duplicates: dedupe.removedCount,
      fixed_duplicate_groups: dedupe.fixedGroups,
      errors: [...dedupe.errors, ...reconciliation.errors],
    });
  }

  const bankAccountId = (payload.bank_account_id ?? "").trim();
  const assignedTo = (payload.assigned_to ?? "").trim();
  const memberIds = Array.from(
    new Set((payload.member_ids ?? []).map((value) => String(value).trim()).filter(Boolean))
  );
  const amount = Math.max(0, asNumber(payload.amount));
  const categoryId = (payload.category_id ?? "").trim();
  const frequency = normalizeFrequency(payload.frequency);
  const nextExecutionDate = (payload.next_execution_date ?? todayIsoDate()).slice(0, 10);
  const description = payload.description?.trim() || null;

  if (!familyId || !bankAccountId || !amount) {
    return NextResponse.json(
      { error: "familyId, bank_account_id and amount are required." },
      { status: 400 }
    );
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const accountAccess = await ensureAccountAccess(familyId, user.id, bankAccountId);
  if (!accountAccess.ok) {
    return NextResponse.json({ error: accountAccess.error }, { status: accountAccess.status });
  }

  const account = await getAccount(bankAccountId);
  if (account.error || !account.data) {
    return NextResponse.json({ error: account.error ?? "Bank account not found." }, { status: 404 });
  }
  if (account.data.family_id !== familyId) {
    return NextResponse.json({ error: "Bank account does not belong to this family." }, { status: 400 });
  }

  if (assignedTo) {
    const memberCheck = await memberBelongsToFamily(assignedTo, familyId);
    if (!memberCheck.ok) return NextResponse.json({ error: memberCheck.error }, { status: 400 });
  }
  for (const memberId of memberIds) {
    const memberCheck = await memberBelongsToFamily(memberId, familyId);
    if (!memberCheck.ok) return NextResponse.json({ error: memberCheck.error }, { status: 400 });
  }
  const effectiveAssignedTo = assignedTo || memberIds[0] || null;
  if (!effectiveAssignedTo) {
    return NextResponse.json({ error: "Recurring expense requires at least one member assignment." }, { status: 400 });
  }
  const descriptionWithMembers = withMemberIdsTag(
    description,
    memberIds.length ? memberIds : effectiveAssignedTo ? [effectiveAssignedTo] : []
  );

  if (categoryId) {
    const category = await getCategory(categoryId);
    if (category.error || !category.data) {
      return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
    }
    if (category.data.family_id !== familyId) {
      return NextResponse.json({ error: "Category does not belong to this family." }, { status: 400 });
    }
  }

  const admin = supabaseAdmin();
  const insert = await admin
    .from("recurring_transactions")
    .insert({
      family_id: familyId,
      bank_account_id: bankAccountId,
      assigned_to: effectiveAssignedTo,
      amount,
      category_id: categoryId || null,
      frequency,
      next_execution_date: nextExecutionDate,
      description: descriptionWithMembers,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (insert.error || !insert.data) {
    return NextResponse.json(
      { error: insert.error?.message ?? "Failed to create recurring transaction." },
      { status: 400 }
    );
  }

  let recurringRow = insert.data as RecurringRow;
  const backfill = await materializeRecurringBackfill({
    recurringId: recurringRow.id,
    familyId,
    bankAccountId,
    assignedTo: effectiveAssignedTo,
    amount,
    categoryId: categoryId || null,
    frequency,
    nextExecutionDate,
    description: descriptionWithMembers,
    createdBy: user.id,
  });

  if (backfill.error) {
    return NextResponse.json({ error: backfill.error }, { status: 400 });
  }

  if (backfill.nextExecutionDate !== recurringRow.next_execution_date) {
    const nextExecutionUpdate = await admin
      .from("recurring_transactions")
      .update({ next_execution_date: backfill.nextExecutionDate })
      .eq("id", recurringRow.id)
      .select("*")
      .single();
    if (nextExecutionUpdate.error || !nextExecutionUpdate.data) {
      return NextResponse.json(
        { error: nextExecutionUpdate.error?.message ?? "Failed to update recurring schedule." },
        { status: 400 }
      );
    }
    recurringRow = nextExecutionUpdate.data as RecurringRow;
  }

  return NextResponse.json(
    { recurring: normalizeRow(recurringRow), backfilled_occurrences: backfill.insertedCount },
    { status: 201 }
  );
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    recurringId?: string;
    bank_account_id?: string;
    assigned_to?: string | null;
    member_ids?: string[];
    amount?: number;
    category_id?: string | null;
    frequency?: string;
    next_execution_date?: string;
    description?: string | null;
  };

  const recurringId = (payload.recurringId ?? "").trim();
  if (!recurringId) return NextResponse.json({ error: "recurringId is required." }, { status: 400 });

  const admin = supabaseAdmin();
  const existingRes = await admin.from("recurring_transactions").select("*").eq("id", recurringId).maybeSingle();
  if (existingRes.error || !existingRes.data) {
    return NextResponse.json({ error: existingRes.error?.message ?? "Recurring transaction not found." }, { status: 404 });
  }

  const existing = existingRes.data as RecurringRow;
  const membership = await ensureFamilyMember(existing.family_id, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const access = await getAccessibleAccountIds(existing.family_id, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const accessibleSet = new Set(access.accountIds);
  if (!accessibleSet.has(existing.bank_account_id)) {
    return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
  }

  const nextAccountId = payload.bank_account_id?.trim() || existing.bank_account_id;
  if (nextAccountId !== existing.bank_account_id) {
    const account = await getAccount(nextAccountId);
    if (account.error || !account.data) {
      return NextResponse.json({ error: account.error ?? "Bank account not found." }, { status: 404 });
    }
    if (account.data.family_id !== existing.family_id) {
      return NextResponse.json({ error: "Bank account does not belong to this family." }, { status: 400 });
    }
    if (!accessibleSet.has(nextAccountId)) {
      return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
    }
  }

  const nextAssignedTo =
    payload.assigned_to !== undefined ? payload.assigned_to?.trim() || null : existing.assigned_to;
  const requestedMemberIds =
    payload.member_ids !== undefined
      ? Array.from(new Set((payload.member_ids ?? []).map((value) => String(value).trim()).filter(Boolean)))
      : null;
  const existingMemberIds = effectiveMemberIds(existing.assigned_to, existing.description);
  const nextMemberIds =
    requestedMemberIds
      ?? (payload.assigned_to !== undefined ? (nextAssignedTo ? [nextAssignedTo] : []) : existingMemberIds);
  const nextAssignedMember = nextAssignedTo || nextMemberIds[0] || null;
  if (!nextAssignedMember) {
    return NextResponse.json({ error: "Recurring expense requires at least one member assignment." }, { status: 400 });
  }
  if (nextAssignedTo) {
    const memberCheck = await memberBelongsToFamily(nextAssignedTo, existing.family_id);
    if (!memberCheck.ok) return NextResponse.json({ error: memberCheck.error }, { status: 400 });
  }
  for (const memberId of nextMemberIds) {
    const memberCheck = await memberBelongsToFamily(memberId, existing.family_id);
    if (!memberCheck.ok) return NextResponse.json({ error: memberCheck.error }, { status: 400 });
  }

  const nextCategoryId =
    payload.category_id !== undefined ? payload.category_id?.trim() || null : existing.category_id;
  if (nextCategoryId) {
    const category = await getCategory(nextCategoryId);
    if (category.error || !category.data) {
      return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
    }
    if (category.data.family_id !== existing.family_id) {
      return NextResponse.json({ error: "Category does not belong to this family." }, { status: 400 });
    }
  }

  const updatePayload: Record<string, unknown> = {
    bank_account_id: nextAccountId,
    assigned_to: nextAssignedMember,
    category_id: nextCategoryId,
  };
  if (payload.amount !== undefined) updatePayload.amount = Math.max(0, asNumber(payload.amount));
  if (payload.frequency !== undefined) updatePayload.frequency = normalizeFrequency(payload.frequency);
  if (payload.next_execution_date !== undefined) {
    updatePayload.next_execution_date = payload.next_execution_date.slice(0, 10);
  }
  const baseDescription =
    payload.description !== undefined ? payload.description?.trim() || null : stripMemberTag(existing.description);
  updatePayload.description = withMemberIdsTag(
    baseDescription,
    nextMemberIds.length ? nextMemberIds : nextAssignedMember ? [nextAssignedMember] : []
  );

  const update = await admin
    .from("recurring_transactions")
    .update(updatePayload)
    .eq("id", recurringId)
    .select("*")
    .single();

  if (update.error || !update.data) {
    return NextResponse.json(
      { error: update.error?.message ?? "Failed to update recurring transaction." },
      { status: 400 }
    );
  }

  return NextResponse.json({ recurring: normalizeRow(update.data as RecurringRow) });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { recurringId?: string };
  const recurringId = (payload.recurringId ?? "").trim();
  if (!recurringId) return NextResponse.json({ error: "recurringId is required." }, { status: 400 });

  const admin = supabaseAdmin();
  const existingRes = await admin
    .from("recurring_transactions")
    .select("id,family_id")
    .eq("id", recurringId)
    .maybeSingle();
  if (existingRes.error || !existingRes.data) {
    return NextResponse.json({ error: existingRes.error?.message ?? "Recurring transaction not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(existingRes.data.family_id as string, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const access = await getAccessibleAccountIds(existingRes.data.family_id as string, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }

  const accountLookup = await admin
    .from("recurring_transactions")
    .select("bank_account_id")
    .eq("id", recurringId)
    .maybeSingle();
  if (accountLookup.error || !accountLookup.data) {
    return NextResponse.json({ error: accountLookup.error?.message ?? "Recurring transaction not found." }, { status: 404 });
  }
  if (!access.accountIds.includes((accountLookup.data.bank_account_id as string) ?? "")) {
    return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
  }

  const del = await admin.from("recurring_transactions").delete().eq("id", recurringId);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
