import { NextRequest, NextResponse } from "next/server";
import { ensureFamilyMember, getAccessibleAccountIds, getAccountMembershipMap } from "@/lib/api-auth";
import { extractGoalMove, stripGoalTags } from "@/lib/goal-moves";
import { filterHumanMembers } from "@/lib/member-kind";
import { matchesMemberFilter, stripMemberTag } from "@/lib/member-tags";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { supabaseServer } from "@/lib/supabase-server";
import {
  BALANCE_TIMELINE_REUSE_LIMIT,
  buildBalanceAfterMapFromRows,
  buildTransferLookupMap,
  canReusePrefetchedBalanceTimeline,
  collectTransferIds,
  inferTransferSideFromDescription,
  normalizeTransactionType,
  transferSideFromType,
  type BalanceTimelineRow,
  type TransferLookupRow,
} from "@/lib/transaction-balance";

const LOAN_TAG_REGEX = /\[loan:([0-9a-fA-F-]{36})\]/;
const LOAN_TAG_STRIP_REGEX = /\s*\[loan:[0-9a-fA-F-]{36}\]\s*/g;
const TRANSFER_TAG_REGEX = /\[transfer:([0-9a-fA-F-]{36})(?::(source|dest))?\]/;
const TRANSFER_TAG_STRIP_REGEX = /\s*\[transfer:[0-9a-fA-F-]{36}(?::(?:source|dest))?\]\s*/g;
const RECURRING_TAG_STRIP_REGEX = /\s*\[recurring:[0-9a-fA-F-]{36}:\d{4}-\d{2}-\d{2}\]\s*/g;

const extractLoanId = (description: string | null | undefined) => {
  if (!description) return null;
  const match = description.match(LOAN_TAG_REGEX);
  return match?.[1] ?? null;
};

const extractTransferTag = (description: string | null | undefined) => {
  if (!description) return null;
  const match = description.match(TRANSFER_TAG_REGEX);
  if (!match?.[1]) return null;
  const side = match[2] === "source" || match[2] === "dest" ? match[2] : null;
  return { id: match[1], side };
};

const stripLoanTag = (description: string | null | undefined) => {
  if (!description) return null;
  const stripped = description.replace(LOAN_TAG_STRIP_REGEX, " ").trim();
  return stripped || null;
};

const stripTransferTag = (description: string | null | undefined) => {
  if (!description) return null;
  const stripped = description.replace(TRANSFER_TAG_STRIP_REGEX, " ").trim();
  return stripped || null;
};

const stripRecurringTag = (description: string | null | undefined) => {
  if (!description) return null;
  const stripped = description.replace(RECURRING_TAG_STRIP_REGEX, " ").trim();
  return stripped || null;
};

const stripSystemTags = (description: string | null | undefined) =>
  stripMemberTag(stripLoanTag(stripTransferTag(stripRecurringTag(stripGoalTags(description)))));

type CategoryRow = {
  id: string;
  name: string | null;
  type: string | null;
  affects_loan: boolean | null;
  color?: string | null;
};
type AccountRow = { id: string; name: string | null; balance: number | string | null };
type FamilyMemberRow = { id: string; name: string | null; user_id: string | null };
type LoanRow = {
  id: string;
  name: string | null;
  remaining_amount: number | string | null;
  account_id?: string | null;
  bank_account_id?: string | null;
};
type TxnRow = {
  id: string;
  amount: number | string | null;
  type: string | null;
  date: string | null;
  description: string | null;
  assigned_to: string | null;
  category_id: string | null;
  bank_account_id: string | null;
};
type GoalRow = {
  current_amount: number | string | null;
  bank_account_id?: string | null;
  account_id?: string | null;
};
type QueryError = { message: string } | null;
type CategoryQueryResult = { data: CategoryRow[] | null; error: QueryError };
type LoanQueryResult = { data: LoanRow[] | null; error: QueryError };
type RecurringRow = {
  id: string;
  bank_account_id: string;
  assigned_to: string | null;
  amount: number | string | null;
  category_id: string | null;
  frequency: string | null;
  next_execution_date: string | null;
  description?: string | null;
};

const isMissingColorColumnError = (message: string) => {
  const lower = message.toLowerCase();
  const mentionsColorColumn = lower.includes("color") && (lower.includes("column") || lower.includes("schema cache"));
  const missingSignal = lower.includes("does not exist") || lower.includes("could not find");
  return mentionsColorColumn && missingSignal;
};

const isMissingLoanBankAccountColumnError = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes("bank_account_id") && lower.includes("does not exist");
};

const parseCsvList = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

async function computeBalanceAfterMap(input: {
  familyId: string;
  accountCurrentBalance: Map<string, number>;
  accountIds: string[];
  sinceDate?: string | null;
}) {
  const { familyId, accountCurrentBalance, accountIds, sinceDate } = input;
  const map = new Map<string, number>();
  if (!accountIds.length) return map;

  const admin = supabaseAdmin();
  let timelineQuery = admin
    .from("transactions")
    .select("id,bank_account_id,amount,type,description,date,created_at")
    .eq("family_id", familyId)
    .in("bank_account_id", accountIds);

  if (sinceDate) timelineQuery = timelineQuery.gte("date", sinceDate);

  const timelineRes = await timelineQuery
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (timelineRes.error) return map;

  const timelineRows = (timelineRes.data ?? []) as BalanceTimelineRow[];
  const transferIds = collectTransferIds(timelineRows);

  let transferById = new Map<string, { sourceAccountId: string; destAccountId: string }>();
  if (transferIds.length) {
    const transferRes = await admin
      .from("transfers")
      .select("id,source_account_id,dest_account_id")
      .in("id", transferIds);
    if (!transferRes.error) {
      transferById = buildTransferLookupMap((transferRes.data ?? []) as TransferLookupRow[]);
    }
  }

  return buildBalanceAfterMapFromRows({
    accountCurrentBalance,
    accountIds,
    rows: timelineRows,
    transferById,
  });
}

async function getUserFromAuthHeader(request: Request) {
  const admin = supabaseAdmin();
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    try {
      const supabase = await supabaseServer();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) return { user: null, error: "Missing bearer token." };
      return { user, error: null };
    } catch {
      return { user: null, error: "Missing bearer token." };
    }
  }

  const token = header.slice(7).trim();
  if (!token) return { user: null, error: "Missing bearer token." };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { user: null, error: error?.message ?? "Invalid token." };
  return { user: data.user, error: null };
}

export async function GET(request: NextRequest) {
  const familyId = request.nextUrl.searchParams.get("familyId");
  if (!familyId) {
    return NextResponse.json({ error: "familyId is required." }, { status: 400 });
  }

  const dateFrom = request.nextUrl.searchParams.get("dateFrom");
  const dateTo = request.nextUrl.searchParams.get("dateTo");
  const accountIds = parseCsvList(request.nextUrl.searchParams.get("accountIds"));
  const memberIds = parseCsvList(request.nextUrl.searchParams.get("memberIds"));

  const { user, error: userError } = await getUserFromAuthHeader(request);
  if (!user) {
    return NextResponse.json({ error: userError ?? "Not signed in" }, { status: 401 });
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const admin = supabaseAdmin();
  const access = await getAccessibleAccountIds(familyId, user.id, { membership: membership.membership });
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const accessibleAccountIds = access.accountIds;
  const accessibleSet = new Set(accessibleAccountIds);

  if (accountIds.length && accountIds.some((accountId) => !accessibleSet.has(accountId))) {
    return NextResponse.json({ error: "One or more selected accounts are not accessible." }, { status: 403 });
  }

  if (!accessibleAccountIds.length) {
    const membersRes = await admin.from("family_members").select("id,name,user_id").eq("family_id", familyId);
    let categoriesRes = (await admin
      .from("categories")
      .select("id,name,type,affects_loan,color")
      .eq("family_id", familyId)) as CategoryQueryResult;
    let includeColor = true;
    if (categoriesRes.error && isMissingColorColumnError(categoriesRes.error.message)) {
      includeColor = false;
      categoriesRes = (await admin
        .from("categories")
        .select("id,name,type,affects_loan")
        .eq("family_id", familyId)) as CategoryQueryResult;
    }

    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
    if (categoriesRes.error) return NextResponse.json({ error: categoriesRes.error.message }, { status: 400 });

    const visibleMembers = await filterHumanMembers((membersRes.data ?? []) as FamilyMemberRow[]);

    return NextResponse.json({
      members: visibleMembers.map((member) => ({
        id: member.id,
        name: member.name ?? "Member",
      })),
      accounts: [],
      categories: (categoriesRes.data ?? []).map((category) => ({
        ...category,
        color: includeColor ? (category as { color?: string | null }).color ?? null : null,
      })),
      loans: [],
      txns: [],
      category_usage: {},
      recurring_month_paid: 0,
      recurring_month_to_pay: 0,
    });
  }

  const loansPromise = (async () => {
    let includeBankAccountId = true;
    let loansRes = (await admin
      .from("loans")
      .select("id,name,remaining_amount,account_id,bank_account_id")
      .eq("family_id", familyId)) as LoanQueryResult;

    if (loansRes.error && isMissingLoanBankAccountColumnError(loansRes.error.message)) {
      includeBankAccountId = false;
      loansRes = (await admin
        .from("loans")
        .select("id,name,remaining_amount,account_id")
        .eq("family_id", familyId)) as LoanQueryResult;
    }

    return { includeBankAccountId, loansRes };
  })();

  const categoriesPromise = (async () => {
    let categoriesRes = (await admin
      .from("categories")
      .select("id,name,type,affects_loan,color")
      .eq("family_id", familyId)) as CategoryQueryResult;
    let includeColor = true;
    if (categoriesRes.error && isMissingColorColumnError(categoriesRes.error.message)) {
      includeColor = false;
      categoriesRes = (await admin
        .from("categories")
        .select("id,name,type,affects_loan")
        .eq("family_id", familyId)) as CategoryQueryResult;
    }

    return { categoriesRes, includeColor };
  })();

  let txnsQuery = admin
    .from("transactions")
    .select("id,amount,type,date,description,assigned_to,category_id,bank_account_id,created_at")
    .eq("family_id", familyId)
    .in("bank_account_id", accessibleAccountIds)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(BALANCE_TIMELINE_REUSE_LIMIT);

  if (dateFrom) txnsQuery = txnsQuery.gte("date", dateFrom);
  if (dateTo) txnsQuery = txnsQuery.lte("date", dateTo);
  if (accountIds.length) txnsQuery = txnsQuery.in("bank_account_id", accountIds);

  const [membersRes, accountsRes, loansBundle, categoriesBundle, txnsRes, usageRes] = await Promise.all([
    admin.from("family_members").select("id,name,user_id").eq("family_id", familyId),
    admin.from("bank_accounts").select("id,name,balance").eq("family_id", familyId).in("id", accessibleAccountIds),
    loansPromise,
    categoriesPromise,
    txnsQuery,
    admin
      .from("transactions")
      .select("category_id")
      .eq("family_id", familyId)
      .in("bank_account_id", accessibleAccountIds)
      .eq("type", "expense"),
  ]);

  const { categoriesRes, includeColor } = categoriesBundle;

  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 400 });
  if (categoriesRes.error) return NextResponse.json({ error: categoriesRes.error.message }, { status: 400 });
  if (loansBundle.loansRes.error) return NextResponse.json({ error: loansBundle.loansRes.error.message }, { status: 400 });
  if (txnsRes.error) return NextResponse.json({ error: txnsRes.error.message }, { status: 400 });
  if (usageRes.error) return NextResponse.json({ error: usageRes.error.message }, { status: 400 });

  const categories = (categoriesRes.data ?? []) as CategoryRow[];
  const familyMembers = await filterHumanMembers((membersRes.data ?? []) as FamilyMemberRow[]);
  const accounts = (accountsRes.data ?? []) as AccountRow[];
  const accountMembership = await getAccountMembershipMap(accounts.map((account) => account.id));
  if (accountMembership.error) {
    return NextResponse.json({ error: accountMembership.error }, { status: 400 });
  }
  const memberByUserId = new Map(
    familyMembers
      .filter((member) => Boolean(member.user_id))
      .map((member) => [member.user_id as string, member.id])
  );
  const realUserIds = Array.from(memberByUserId.keys());
  const accountsWithMeta = accounts.map((account) => {
    const membershipRows = accountMembership.map.get(account.id) ?? [];
    const visibleUserIds = membershipRows.length
      ? Array.from(new Set(membershipRows.map((row) => row.user_id).filter(Boolean)))
      : realUserIds;
    const memberIds = visibleUserIds
      .map((userId) => memberByUserId.get(userId))
      .filter((value): value is string => Boolean(value));
    return {
      id: account.id,
      name: account.name ?? "Account",
      balance: Number(account.balance ?? 0),
      is_shared: memberIds.length > 1,
      member_ids: memberIds,
    };
  });
  const loans = ((loansBundle.loansRes.data ?? []) as LoanRow[]).filter(
    (loan) => {
      const accountId =
        loan.account_id ?? (loansBundle.includeBankAccountId ? loan.bank_account_id ?? null : null);
      if (!accountId) return false;
      return accessibleSet.has(accountId);
    }
  );
  const categoryById = new Map<string, { name: string; color: string | null }>(
    categories.map((category) => [
      category.id,
      {
        name: category.name ?? "Uncategorized",
        color: includeColor ? category.color ?? null : null,
      },
    ])
  );
  const accountById = new Map(accounts.map((account) => [account.id, account.name ?? "Account"]));
  const loanById = new Map(loans.map((loan) => [loan.id, loan.name ?? "Loan"]));

  const rawTxns = ((txnsRes.data ?? []) as TxnRow[]).filter((txn) =>
    matchesMemberFilter(txn.assigned_to, txn.description, memberIds)
  );
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const scopedAccountIds = accountIds.length ? accountIds : accessibleAccountIds;

  const recurringPaidQuery = admin
    .from("transactions")
    .select("amount,assigned_to,description")
    .eq("family_id", familyId)
    .in("bank_account_id", scopedAccountIds)
    .eq("type", "expense")
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .ilike("description", "%[recurring:%");

  const recurringScheduleQuery = admin
    .from("recurring_transactions")
    .select("id,bank_account_id,assigned_to,amount,category_id,frequency,next_execution_date,description")
    .eq("family_id", familyId)
    .in("bank_account_id", scopedAccountIds);

  const [recurringPaidRes, recurringScheduleRes] = await Promise.all([recurringPaidQuery, recurringScheduleQuery]);
  if (recurringPaidRes.error) return NextResponse.json({ error: recurringPaidRes.error.message }, { status: 400 });
  if (recurringScheduleRes.error) return NextResponse.json({ error: recurringScheduleRes.error.message }, { status: 400 });

  const recurringMonthPaid = (recurringPaidRes.data ?? []).reduce((sum, row) => {
    const recurringRow = row as { amount?: number | string | null; assigned_to?: string | null; description?: string | null };
    if (!matchesMemberFilter(recurringRow.assigned_to ?? null, recurringRow.description ?? null, memberIds)) {
      return sum;
    }
    const value = Number((row as { amount?: number | string | null }).amount ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  const categoryTypeById = new Map<string, string | null>(
    categories.map((category) => [category.id, (category.type ?? "").toLowerCase() || null])
  );
  const recurringMonthToPay = ((recurringScheduleRes.data ?? []) as RecurringRow[]).reduce((sum, recurring) => {
    if (!matchesMemberFilter(recurring.assigned_to, (recurring as { description?: string | null }).description ?? null, memberIds)) return sum;
    const categoryType = recurring.category_id ? categoryTypeById.get(recurring.category_id) : null;
    if (categoryType === "income") return sum;

    const amount = Number(recurring.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return sum;
    let occurrenceDate = recurring.next_execution_date ?? monthStart;
    let accumulator = 0;
    let safety = 0;

    while (occurrenceDate <= monthEnd && safety < 500) {
      safety += 1;
      if (occurrenceDate >= monthStart) accumulator += amount;
      occurrenceDate = nextDateFromFrequency(occurrenceDate, recurring.frequency);
    }

    return sum + accumulator;
  }, 0);

  const transferIds = collectTransferIds(rawTxns);

  let transferById = new Map<string, { sourceAccountId: string; destAccountId: string }>();
  if (transferIds.length) {
    const transferRes = await admin
      .from("transfers")
      .select("id,source_account_id,dest_account_id")
      .in("id", transferIds);
    if (transferRes.error) {
      return NextResponse.json({ error: transferRes.error.message }, { status: 400 });
    }
    transferById = buildTransferLookupMap((transferRes.data ?? []) as TransferLookupRow[]);
  }

  const txns = rawTxns.map((txn) => {
    const loanId = extractLoanId(txn.description as string | null | undefined);
    const transferTag = extractTransferTag(txn.description as string | null | undefined);
    const goalMove = extractGoalMove(txn.description as string | null | undefined);
    const normalizedType = goalMove && goalMove.moveType !== "spend"
      ? "transfer"
      : normalizeTransactionType(txn.type as string | null | undefined);
    let transferSide = transferSideFromType(txn.type as string | null | undefined) ?? transferTag?.side ?? null;
    if (!transferSide && transferTag?.id) {
      const transfer = transferById.get(transferTag.id);
      if (transfer) {
        if (txn.bank_account_id === transfer.sourceAccountId) transferSide = "source";
        if (txn.bank_account_id === transfer.destAccountId) transferSide = "dest";
      }
    }
    if (!transferSide) {
      transferSide = inferTransferSideFromDescription(txn.description as string | null | undefined);
    }
    return {
      id: txn.id,
      bank_account_id: txn.bank_account_id,
      amount: txn.amount,
      type: normalizedType,
      transfer_side: goalMove && goalMove.moveType !== "spend" ? null : transferSide,
      goal_move_type: goalMove?.moveType ?? null,
      date: txn.date,
      description: stripSystemTags(txn.description as string | null | undefined),
      assigned_to: txn.assigned_to,
      category: {
        id: txn.category_id,
        name:
          goalMove?.moveType === "allocate"
            ? "Reserva para goal"
            : goalMove?.moveType === "release"
              ? "Libertar do goal"
              : categoryById.get(txn.category_id as string)?.name
                ?? (goalMove?.moveType === "spend"
                  ? "Despesa do goal"
                  : normalizedType === "transfer"
                    ? "Transfer"
                    : "Uncategorized"),
        color: categoryById.get(txn.category_id as string)?.color ?? null,
      },
      bank_account: { name: accountById.get(txn.bank_account_id as string) ?? "Account" },
      loan: loanId ? { id: loanId, name: loanById.get(loanId) ?? "Loan" } : null,
    };
  });

  const goalsRes = await admin.from("goals").select("current_amount,bank_account_id,account_id");
  if (goalsRes.error) {
    return NextResponse.json({ error: goalsRes.error.message }, { status: 400 });
  }
  const reservedGoalAmount = ((goalsRes.data ?? []) as Array<GoalRow>).reduce((sum, goal) => {
    const accountId = goal.bank_account_id ?? goal.account_id ?? null;
    if (!accountId || !scopedAccountIds.includes(accountId)) return sum;
    return sum + Number(goal.current_amount ?? 0);
  }, 0);

  const recentTxnsForBalance = txns.slice(0, 10);
  const oldestRecentTxnDate = recentTxnsForBalance.reduce<string | null>((oldest, txn) => {
    if (!txn.date) return oldest;
    if (!oldest) return txn.date;
    return txn.date < oldest ? txn.date : oldest;
  }, null);
  const recentBalanceAccountIds = Array.from(
    new Set(
      recentTxnsForBalance
        .map((txn) => txn.bank_account_id)
        .filter((accountId): accountId is string => Boolean(accountId))
    )
  );
  const accountCurrentBalance = new Map(accountsWithMeta.map((account) => [account.id, Number(account.balance ?? 0)]));
  const canReuseTimeline =
    Boolean(oldestRecentTxnDate) &&
    recentBalanceAccountIds.length > 0 &&
    canReusePrefetchedBalanceTimeline({
      hasUpperDateBound: Boolean(dateTo),
      fetchedRowCount: (txnsRes.data ?? []).length,
      fetchLimit: BALANCE_TIMELINE_REUSE_LIMIT,
    });

  const balanceAfterById = canReuseTimeline
    ? buildBalanceAfterMapFromRows({
        accountCurrentBalance,
        accountIds: recentBalanceAccountIds,
        rows: ((txnsRes.data ?? []) as BalanceTimelineRow[]).filter(
          (row) =>
            recentBalanceAccountIds.includes(row.bank_account_id) &&
            Boolean(row.date) &&
            (row.date as string) >= (oldestRecentTxnDate as string)
        ),
        transferById,
      })
    : await computeBalanceAfterMap({
        familyId,
        accountCurrentBalance,
        accountIds: recentBalanceAccountIds,
        sinceDate: oldestRecentTxnDate,
      });

  const txnsWithBalance = txns.map((txn) => ({
    ...txn,
    balance_after: balanceAfterById.get(txn.id) ?? null,
  }));

  const categoryUsage = ((usageRes.data ?? []) as Array<{ category_id: string | null }>).reduce(
    (acc, row) => {
      if (!row.category_id) return acc;
      acc[row.category_id] = (acc[row.category_id] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return NextResponse.json({
    members: familyMembers.map((member) => ({
      id: member.id,
      name: member.name ?? "Member",
      user_id: member.user_id ?? null,
    })),
    accounts: accountsWithMeta,
    categories: categories.map((category) => ({
      ...category,
      color: includeColor ? category.color ?? null : null,
    })),
    loans,
    txns: txnsWithBalance,
    category_usage: categoryUsage,
    recurring_month_paid: recurringMonthPaid,
    recurring_month_to_pay: recurringMonthToPay,
    reserved_goal_amount: reservedGoalAmount,
  });
}
