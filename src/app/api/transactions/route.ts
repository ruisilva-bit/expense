import { NextRequest, NextResponse } from "next/server";
import {
  asNumber,
  ensureAccountAccess,
  ensureLegacyAccountForBankAccount,
  ensureFamilyMember,
  getAccountMembershipMap,
  getAccessibleAccountIds,
  getAccount,
  getCategory,
  getLoan,
  getRequestUser,
  todayIsoDate,
} from "@/lib/api-auth";
import {
  effectiveMemberIds,
  matchesMemberFilter,
  stripMemberTag,
  withMemberIdsTag,
} from "@/lib/member-tags";
import { supabaseAdmin } from "@/lib/supabase-admin";

type TxnType = "income" | "expense" | "transfer";

type TransactionRow = {
  id: string;
  family_id: string;
  bank_account_id: string;
  assigned_to: string | null;
  amount: number | string | null;
  type: string | null;
  category_id: string | null;
  description: string | null;
  date: string | null;
  created_at: string | null;
};
type CategoryLookupRow = {
  id: string;
  name: string | null;
  type: string | null;
  affects_loan: boolean | null;
  color?: string | null;
};
type TransferRow = {
  id: string;
  family_id: string;
  source_account_id: string;
  dest_account_id: string;
  amount: number | string | null;
  description: string | null;
  date: string | null;
};
type QueryError = { message: string } | null;
type CategoryQueryResult = { data: CategoryLookupRow[] | null; error: QueryError };
type LoanQueryResult = {
  data: Array<{ id: string; name: string | null; remaining_amount?: number | string | null; account_id?: string | null; bank_account_id?: string | null }> | null;
  error: QueryError;
};
type TransferLookupRow = { id: string; source_account_id: string; dest_account_id: string };
type MemberRow = { id: string; name: string | null; user_id?: string | null };

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

type TransferSide = "source" | "dest";

const LOAN_TAG_REGEX = /\[loan:([0-9a-fA-F-]{36})\]/;
const LOAN_TAG_STRIP_REGEX = /\s*\[loan:[0-9a-fA-F-]{36}\]\s*/g;
const TRANSFER_TAG_REGEX = /\[transfer:([0-9a-fA-F-]{36})(?::(source|dest))?\]/;
const TRANSFER_TAG_STRIP_REGEX = /\s*\[transfer:[0-9a-fA-F-]{36}(?::(?:source|dest))?\]\s*/g;
const RECURRING_TAG_STRIP_REGEX = /\s*\[recurring:[0-9a-fA-F-]{36}:\d{4}-\d{2}-\d{2}\]\s*/g;

const normalizeType = (value: unknown): TxnType => {
  if (value === "income") return "income";
  if (value === "transfer" || value === "transfer_in" || value === "transfer_out") return "transfer";
  return "expense";
};

const parseCsvList = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const accountImpact = (type: TxnType, amount: number) => {
  if (type === "income") return amount;
  if (type === "expense") return -amount;
  return 0;
};

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
  stripMemberTag(stripLoanTag(stripTransferTag(stripRecurringTag(description))));

const withLoanTag = (description: string | null, loanId: string | null) => {
  const base = stripLoanTag(description);
  if (!loanId) return base;
  return base ? `${base} [loan:${loanId}]` : `[loan:${loanId}]`;
};

const withTransferTag = (description: string | null, transferId: string, side?: TransferSide) => {
  const base = stripTransferTag(description);
  const tag = side ? `[transfer:${transferId}:${side}]` : `[transfer:${transferId}]`;
  return base ? `${base} ${tag}` : tag;
};

const inferTransferSideFromDescription = (description: string | null | undefined) => {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (lower.includes("transfer to")) return "source" as const;
  if (lower.includes("transfer from")) return "dest" as const;
  return null;
};

const transferSideFromType = (value: string | null | undefined) => {
  const kind = (value ?? "").toLowerCase();
  if (kind === "transfer_in") return "dest" as const;
  if (kind === "transfer_out") return "source" as const;
  return null;
};

async function ensureAssignedMember(familyId: string, memberId: string) {
  const admin = supabaseAdmin();
  const memberRes = await admin
    .from("family_members")
    .select("id")
    .eq("id", memberId)
    .eq("family_id", familyId)
    .maybeSingle();
  if (memberRes.error) return { ok: false as const, error: memberRes.error.message };
  if (!memberRes.data) return { ok: false as const, error: "Assigned member does not belong to this family." };
  return { ok: true as const };
}

async function applyBalanceDelta(accountId: string, delta: number) {
  if (!delta) return { ok: true as const };
  const account = await getAccount(accountId);
  if (account.error || !account.data) {
    return { ok: false as const, error: account.error ?? "Bank account not found." };
  }

  const admin = supabaseAdmin();
  const nextBalance = asNumber(account.data.balance) + delta;
  const update = await admin.from("bank_accounts").update({ balance: nextBalance }).eq("id", accountId);
  if (update.error) {
    return { ok: false as const, error: update.error.message };
  }

  return { ok: true as const };
}

async function applyLoanRemainingDelta(loanId: string, delta: number) {
  if (!delta) return { ok: true as const };

  const loan = await getLoan(loanId);
  if (loan.error || !loan.data) {
    return { ok: false as const, error: loan.error ?? "Loan not found." };
  }

  const currentRemaining = asNumber(loan.data.remaining_amount, asNumber(loan.data.total_amount));
  const nextRemaining = Math.max(0, currentRemaining + delta);

  const admin = supabaseAdmin();
  const update = await admin.from("loans").update({ remaining_amount: nextRemaining }).eq("id", loanId);
  if (update.error) {
    return { ok: false as const, error: update.error.message };
  }

  return { ok: true as const };
}

async function getTransfer(transferId: string) {
  const admin = supabaseAdmin();
  const transfer = await admin
    .from("transfers")
    .select("id,family_id,source_account_id,dest_account_id,amount,description,date")
    .eq("id", transferId)
    .maybeSingle();
  if (transfer.error) return { data: null, error: transfer.error.message };
  return { data: (transfer.data as TransferRow | null) ?? null, error: null };
}

async function findLegacyTransfer(input: {
  familyId: string;
  sourceAccountId: string;
  amount: number;
  date: string | null;
}) {
  if (!input.date) return { data: null, error: null };
  const admin = supabaseAdmin();
  const transfer = await admin
    .from("transfers")
    .select("id,family_id,source_account_id,dest_account_id,amount,description,date")
    .eq("family_id", input.familyId)
    .eq("source_account_id", input.sourceAccountId)
    .eq("amount", input.amount)
    .eq("date", input.date)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (transfer.error) return { data: null, error: transfer.error.message };
  return { data: (transfer.data as TransferRow | null) ?? null, error: null };
}

async function getLinkedTransferTransactions(familyId: string, transferId: string) {
  const admin = supabaseAdmin();
  const rows = await admin
    .from("transactions")
    .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
    .eq("family_id", familyId)
    .ilike("description", `%[transfer:${transferId}%`);
  if (rows.error) return { data: null, error: rows.error.message };
  return { data: (rows.data as TransactionRow[] | null) ?? [], error: null };
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

  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") ?? 50)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const accountId = request.nextUrl.searchParams.get("accountId");
  const categoryId = request.nextUrl.searchParams.get("categoryId");
  const memberIds = Array.from(
    new Set([
      ...parseCsvList(request.nextUrl.searchParams.get("memberIds")),
      ...(request.nextUrl.searchParams.get("memberId") ? [request.nextUrl.searchParams.get("memberId") as string] : []),
    ])
  );
  const dateFrom = request.nextUrl.searchParams.get("dateFrom");
  const dateTo = request.nextUrl.searchParams.get("dateTo");

  const access = await getAccessibleAccountIds(familyId, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const accessibleAccountIds = access.accountIds;
  const accessibleSet = new Set(accessibleAccountIds);
  if (accountId && !accessibleSet.has(accountId)) {
    return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
  }
  if (!accessibleAccountIds.length) {
    return NextResponse.json({
      transactions: [],
      page,
      pageSize,
      members: [],
      accounts: [],
      categories: [],
      loans: [],
    });
  }

  const admin = supabaseAdmin();
  let query = admin
    .from("transactions")
    .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
    .eq("family_id", familyId)
    .in("bank_account_id", accessibleAccountIds)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (accountId) query = query.eq("bank_account_id", accountId);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (dateFrom) query = query.gte("date", dateFrom);
  if (dateTo) query = query.lte("date", dateTo);
  if (!memberIds.length) {
    query = query.range(from, to);
  } else {
    query = query.limit(1000);
  }

  const txRes = await query;
  if (txRes.error) {
    return NextResponse.json({ error: txRes.error.message }, { status: 400 });
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

  const [accountsRes, membersRes, loansBundle] = await Promise.all([
    admin.from("bank_accounts").select("id,name").eq("family_id", familyId).in("id", accessibleAccountIds),
    admin.from("family_members").select("id,name,user_id").eq("family_id", familyId),
    loansPromise,
  ]);

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

  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 400 });
  if (categoriesRes.error) return NextResponse.json({ error: categoriesRes.error.message }, { status: 400 });
  if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
  if (loansBundle.loansRes.error) return NextResponse.json({ error: loansBundle.loansRes.error.message }, { status: 400 });

  const familyMembers = (membersRes.data ?? []) as MemberRow[];
  const memberById = new Map(
    familyMembers.map((member) => [member.id as string, member.name ?? "Member"])
  );
  const memberByUserId = new Map(
    familyMembers
      .filter((member) => Boolean(member.user_id))
      .map((member) => [member.user_id as string, member.id])
  );
  const realUserIds = Array.from(memberByUserId.keys());
  const accountMembership = await getAccountMembershipMap(
    (accountsRes.data ?? []).map((account) => account.id as string)
  );
  if (accountMembership.error) {
    return NextResponse.json({ error: accountMembership.error }, { status: 400 });
  }
  const accountsWithMeta = (accountsRes.data ?? []).map((account) => {
    const rows = accountMembership.map.get(account.id as string) ?? [];
    const visibleUserIds = rows.length
      ? Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)))
      : realUserIds;
    const memberIds = visibleUserIds
      .map((userId) => memberByUserId.get(userId))
      .filter((value): value is string => Boolean(value));
    return {
      id: account.id as string,
      name: (account.name as string | null) ?? "Account",
      is_shared: memberIds.length > 1,
      member_ids: memberIds,
    };
  });

  const accountById = new Map(
    (accountsRes.data ?? []).map((account) => [account.id as string, (account.name as string | null) ?? "Account"])
  );
  const categoryById = new Map<string, CategoryLookupRow>(
    ((categoriesRes.data ?? []) as CategoryLookupRow[]).map((category) => [category.id, category])
  );
  const loanById = new Map(
    (loansBundle.loansRes.data ?? [])
      .filter((loan) => {
        const accountRef = (loan as { account_id?: string | null; bank_account_id?: string | null }).account_id
          ?? (loansBundle.includeBankAccountId
            ? (loan as { account_id?: string | null; bank_account_id?: string | null }).bank_account_id
            : null)
          ?? null;
        return accountRef ? accessibleSet.has(accountRef) : false;
      })
      .map((loan) => [loan.id as string, (loan.name as string | null) ?? "Loan"])
  );

  const allRawTransactions = (txRes.data ?? []) as TransactionRow[];
  const memberFilteredTransactions = allRawTransactions.filter((txn) =>
    matchesMemberFilter(txn.assigned_to, txn.description, memberIds)
  );
  const rawTransactions = memberIds.length
    ? memberFilteredTransactions.slice(from, to + 1)
    : memberFilteredTransactions;
  const transferIds = Array.from(
    new Set(
      rawTransactions
        .filter((txn) => {
          const kind = (txn.type ?? "").toLowerCase();
          return kind === "transfer" || kind === "transfer_in" || kind === "transfer_out";
        })
        .map((txn) => extractTransferTag(txn.description)?.id ?? null)
        .filter((id): id is string => Boolean(id))
    )
  );

  let transferById = new Map<string, { sourceAccountId: string; destAccountId: string }>();
  if (transferIds.length) {
    const transferRes = await admin
      .from("transfers")
      .select("id,source_account_id,dest_account_id")
      .in("id", transferIds);
    if (transferRes.error) {
      return NextResponse.json({ error: transferRes.error.message }, { status: 400 });
    }
    transferById = new Map(
      ((transferRes.data ?? []) as TransferLookupRow[]).map((transfer) => [
        transfer.id,
        {
          sourceAccountId: transfer.source_account_id,
          destAccountId: transfer.dest_account_id,
        },
      ])
    );
  }

  const transactions = rawTransactions.map((txn) => {
    const normalizedType = normalizeType(txn.type);
    const category = txn.category_id ? categoryById.get(txn.category_id) : null;
    const linkedLoanId = extractLoanId(txn.description);
    const transferTag = extractTransferTag(txn.description);
    let transferSide = transferSideFromType(txn.type) ?? transferTag?.side ?? null;
    if (!transferSide && transferTag?.id) {
      const transfer = transferById.get(transferTag.id);
      if (transfer) {
        if (txn.bank_account_id === transfer.sourceAccountId) transferSide = "source";
        if (txn.bank_account_id === transfer.destAccountId) transferSide = "dest";
      }
    }
    if (!transferSide) {
      transferSide = inferTransferSideFromDescription(txn.description);
    }
    const transactionMemberIds = effectiveMemberIds(txn.assigned_to, txn.description);
    const memberNameList = transactionMemberIds
      .map((memberId) => memberById.get(memberId))
      .filter((value): value is string => Boolean(value));
    const memberLabel =
      memberNameList.length > 1
        ? `All members (${memberNameList.length})`
        : memberNameList.length === 1
          ? memberNameList[0]
          : "Unassigned";
    return {
      ...txn,
      type: normalizedType,
      description: stripSystemTags(txn.description),
      member_ids: transactionMemberIds,
      member_label: memberLabel,
      amount: asNumber(txn.amount),
      transfer_side: transferSide,
      category: category
        ? {
            id: category.id,
            name: category.name,
            type: category.type,
            affects_loan: Boolean(category.affects_loan),
            color: includeColor ? (category as { color?: string | null }).color ?? null : null,
          }
        : null,
      bank_account: { id: txn.bank_account_id, name: accountById.get(txn.bank_account_id) ?? "Account" },
      member:
        memberNameList.length === 1
          ? { id: transactionMemberIds[0], name: memberNameList[0] }
          : memberNameList.length > 1
            ? { id: "all", name: memberLabel }
            : null,
      loan: linkedLoanId ? { id: linkedLoanId, name: loanById.get(linkedLoanId) ?? "Loan" } : null,
    };
  });

  return NextResponse.json({
    transactions,
    page,
    pageSize,
    members: familyMembers.map((member) => ({ id: member.id, name: member.name ?? "Member" })),
    accounts: accountsWithMeta,
    categories: ((categoriesRes.data ?? []) as CategoryLookupRow[]).map((category) => ({
      id: category.id,
      name: category.name,
      type: category.type,
      affects_loan: category.affects_loan,
      color: includeColor ? (category as { color?: string | null }).color ?? null : null,
    })),
    loans: Array.from(loanById.entries()).map(([id, name]) => ({ id, name })),
  });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    bank_account_id?: string;
    to_bank_account_id?: string;
    assigned_to?: string | null;
    member_ids?: string[];
    amount?: number;
    type?: TxnType;
    category_id?: string | null;
    loan_id?: string | null;
    description?: string;
    date?: string;
  };

  const familyId = (payload.familyId ?? "").trim();
  const bankAccountId = (payload.bank_account_id ?? "").trim();
  const toBankAccountId = (payload.to_bank_account_id ?? "").trim();
  const assignedTo = (payload.assigned_to ?? "").trim();
  const memberIds = Array.from(
    new Set((payload.member_ids ?? []).map((value) => String(value).trim()).filter(Boolean))
  );
  const categoryId = (payload.category_id ?? "").trim();
  const loanId = (payload.loan_id ?? "").trim();
  const description = payload.description?.trim() || null;
  const amount = Math.abs(asNumber(payload.amount));
  const type = normalizeType(payload.type);
  const date = (payload.date ?? todayIsoDate()).slice(0, 10);

  if (!familyId || !bankAccountId || !amount) {
    return NextResponse.json(
      { error: "familyId, bank_account_id and amount are required." },
      { status: 400 }
    );
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const sourceAccess = await ensureAccountAccess(familyId, user.id, bankAccountId);
  if (!sourceAccess.ok) {
    return NextResponse.json({ error: sourceAccess.error }, { status: sourceAccess.status });
  }

  const sourceAccount = await getAccount(bankAccountId);
  if (sourceAccount.error || !sourceAccount.data) {
    return NextResponse.json({ error: sourceAccount.error ?? "Source account not found." }, { status: 404 });
  }
  if (sourceAccount.data.family_id !== familyId) {
    return NextResponse.json({ error: "Source account is not in selected family." }, { status: 400 });
  }

  if (assignedTo) {
    const assignedCheck = await ensureAssignedMember(familyId, assignedTo);
    if (!assignedCheck.ok) return NextResponse.json({ error: assignedCheck.error }, { status: 400 });
  }
  for (const memberId of memberIds) {
    const assignedCheck = await ensureAssignedMember(familyId, memberId);
    if (!assignedCheck.ok) return NextResponse.json({ error: assignedCheck.error }, { status: 400 });
  }
  const effectiveAssignedTo = assignedTo || memberIds[0] || null;
  const taggedDescription = withMemberIdsTag(description, memberIds.length ? memberIds : effectiveAssignedTo ? [effectiveAssignedTo] : []);
  if (type === "expense" && !effectiveAssignedTo) {
    return NextResponse.json({ error: "Expense requires at least one member assignment." }, { status: 400 });
  }

  let affectsLoan = false;
  let categoryName: string | null = null;
  if (categoryId) {
    const category = await getCategory(categoryId);
    if (category.error || !category.data) {
      return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
    }
    if (category.data.family_id !== familyId) {
      return NextResponse.json({ error: "Category is not in selected family." }, { status: 400 });
    }
    affectsLoan = Boolean(category.data.affects_loan);
    categoryName = category.data.name;
  }

  const legacySource = await ensureLegacyAccountForBankAccount(bankAccountId);
  if (!legacySource.ok) {
    return NextResponse.json({ error: legacySource.error }, { status: 400 });
  }

  if (type === "expense" && affectsLoan && !loanId) {
    return NextResponse.json(
      { error: "This category affects loan balance. Please select which loan to apply." },
      { status: 400 }
    );
  }

  if (loanId) {
    const loan = await getLoan(loanId);
    if (loan.error || !loan.data) {
      return NextResponse.json({ error: loan.error ?? "Loan not found." }, { status: 404 });
    }
    if (loan.data.family_id !== familyId) {
      return NextResponse.json({ error: "Loan is not in selected family." }, { status: 400 });
    }
  }

  const admin = supabaseAdmin();

  if (type === "transfer") {
    if (!toBankAccountId) {
      return NextResponse.json({ error: "to_bank_account_id is required for transfers." }, { status: 400 });
    }
    const destinationAccess = await ensureAccountAccess(familyId, user.id, toBankAccountId);
    if (!destinationAccess.ok) {
      return NextResponse.json({ error: destinationAccess.error }, { status: destinationAccess.status });
    }
    if (toBankAccountId === bankAccountId) {
      return NextResponse.json({ error: "Transfer accounts must be different." }, { status: 400 });
    }

    const destinationAccount = await getAccount(toBankAccountId);
    if (destinationAccount.error || !destinationAccount.data) {
      return NextResponse.json(
        { error: destinationAccount.error ?? "Destination account not found." },
        { status: 404 }
      );
    }
    if (destinationAccount.data.family_id !== familyId) {
      return NextResponse.json({ error: "Destination account is not in selected family." }, { status: 400 });
    }
    const legacyDestination = await ensureLegacyAccountForBankAccount(toBankAccountId);
    if (!legacyDestination.ok) {
      return NextResponse.json({ error: legacyDestination.error }, { status: 400 });
    }

    const transferInsert = await admin
      .from("transfers")
      .insert({
        family_id: familyId,
        source_account_id: bankAccountId,
        dest_account_id: toBankAccountId,
        amount,
        created_by: user.id,
        description: description ?? null,
        date,
      })
      .select("id")
      .single();

    if (transferInsert.error || !transferInsert.data) {
      return NextResponse.json({ error: transferInsert.error?.message ?? "Failed to create transfer." }, { status: 400 });
    }

    const transferId = transferInsert.data.id as string;
    const sourceDescription = withTransferTag(
      taggedDescription ?? `Transfer to ${destinationAccount.data.name}`,
      transferId,
      "source"
    );
    const destinationDescription = withTransferTag(
      taggedDescription ?? `Transfer from ${sourceAccount.data.name}`,
      transferId,
      "dest"
    );

    const insert = await admin
      .from("transactions")
      .insert([
        {
          family_id: familyId,
          bank_account_id: bankAccountId,
          account_id: bankAccountId,
          created_by: user.id,
          user_id: user.id,
          assigned_to: effectiveAssignedTo,
          amount,
          type: "transfer",
          category_id: categoryId || null,
          category: categoryName ?? "Transfer",
          description: sourceDescription,
          date,
        },
        {
          family_id: familyId,
          bank_account_id: toBankAccountId,
          account_id: toBankAccountId,
          created_by: user.id,
          user_id: user.id,
          assigned_to: effectiveAssignedTo,
          amount,
          type: "transfer",
          category_id: categoryId || null,
          category: categoryName ?? "Transfer",
          description: destinationDescription,
          date,
        },
      ])
      .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at");

    if (insert.error || !insert.data || insert.data.length < 2) {
      await admin.from("transfers").delete().eq("id", transferId);
      return NextResponse.json(
        { error: insert.error?.message ?? "Failed to create transfer transactions." },
        { status: 400 }
      );
    }

    const sourceBalanceUpdate = await applyBalanceDelta(bankAccountId, -amount);
    if (!sourceBalanceUpdate.ok) {
      return NextResponse.json({ error: sourceBalanceUpdate.error }, { status: 400 });
    }
    const destinationBalanceUpdate = await applyBalanceDelta(toBankAccountId, amount);
    if (!destinationBalanceUpdate.ok) {
      return NextResponse.json({ error: destinationBalanceUpdate.error }, { status: 400 });
    }

    const transactions = (insert.data as TransactionRow[]).sort((a, b) =>
      a.bank_account_id === bankAccountId ? -1 : b.bank_account_id === bankAccountId ? 1 : 0
    );

    return NextResponse.json(
      { transaction: transactions[0], transactions, transfer_id: transferId },
      { status: 201 }
    );
  }

  const insert = await admin
    .from("transactions")
    .insert({
      family_id: familyId,
      bank_account_id: bankAccountId,
      account_id: bankAccountId,
      created_by: user.id,
      user_id: user.id,
      assigned_to: effectiveAssignedTo,
      amount,
      type,
      category_id: categoryId || null,
      category: categoryName ?? "Other",
      description: withLoanTag(taggedDescription, type === "expense" && affectsLoan ? loanId : null),
      date,
    })
    .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
    .single();

  if (insert.error || !insert.data) {
    return NextResponse.json({ error: insert.error?.message ?? "Failed to create transaction." }, { status: 400 });
  }

  const delta = accountImpact(type, amount);
  const balanceUpdate = await applyBalanceDelta(bankAccountId, delta);
  if (!balanceUpdate.ok) {
    return NextResponse.json({ error: balanceUpdate.error }, { status: 400 });
  }

  if (type === "expense" && affectsLoan && loanId) {
    const loanUpdate = await applyLoanRemainingDelta(loanId, -amount);
    if (!loanUpdate.ok) {
      return NextResponse.json({ error: loanUpdate.error }, { status: 400 });
    }
  }

  return NextResponse.json({ transaction: insert.data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    transactionId?: string;
    bank_account_id?: string;
    to_bank_account_id?: string;
    assigned_to?: string | null;
    member_ids?: string[];
    amount?: number;
    type?: TxnType;
    category_id?: string | null;
    loan_id?: string | null;
    description?: string | null;
    date?: string;
  };

  const transactionId = (payload.transactionId ?? "").trim();
  if (!transactionId) {
    return NextResponse.json({ error: "transactionId is required." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const existingRes = await admin
    .from("transactions")
    .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
    .eq("id", transactionId)
    .maybeSingle();

  if (existingRes.error || !existingRes.data) {
    return NextResponse.json({ error: existingRes.error?.message ?? "Transaction not found." }, { status: 404 });
  }
  const existing = existingRes.data as TransactionRow;

  const membership = await ensureFamilyMember(existing.family_id, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const access = await getAccessibleAccountIds(existing.family_id, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const accessibleSet = new Set(access.accountIds);
  if (!accessibleSet.has(existing.bank_account_id)) {
    return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
  }

  const nextType = payload.type ? normalizeType(payload.type) : normalizeType(existing.type);
  const nextAmount = payload.amount !== undefined ? Math.abs(asNumber(payload.amount)) : asNumber(existing.amount);
  const nextBankAccountId = (payload.bank_account_id ?? existing.bank_account_id).trim();
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
  const nextCategoryId =
    payload.category_id !== undefined ? payload.category_id?.trim() || null : existing.category_id;
  const oldLoanId = extractLoanId(existing.description);
  const requestedLoanId =
    payload.loan_id !== undefined ? payload.loan_id?.trim() || null : oldLoanId;
  const visibleDescription =
    payload.description !== undefined ? payload.description?.trim() || null : stripSystemTags(existing.description);
  const descriptionWithMembers = withMemberIdsTag(
    visibleDescription,
    nextMemberIds.length ? nextMemberIds : nextAssignedMember ? [nextAssignedMember] : []
  );
  const explicitCategoryChange = payload.category_id !== undefined;
  if (nextType === "expense" && !nextAssignedMember) {
    return NextResponse.json({ error: "Expense requires at least one member assignment." }, { status: 400 });
  }

  if (nextAssignedTo) {
    const memberCheck = await ensureAssignedMember(existing.family_id, nextAssignedTo);
    if (!memberCheck.ok) return NextResponse.json({ error: memberCheck.error }, { status: 400 });
  }
  for (const memberId of nextMemberIds) {
    const memberCheck = await ensureAssignedMember(existing.family_id, memberId);
    if (!memberCheck.ok) return NextResponse.json({ error: memberCheck.error }, { status: 400 });
  }

  const existingType = normalizeType(existing.type);
  if (existingType === "transfer" || nextType === "transfer") {
    if (existingType !== "transfer" || nextType !== "transfer") {
      return NextResponse.json(
        { error: "Changing a transfer into another type is not supported. Delete and recreate it." },
        { status: 400 }
      );
    }

    const taggedTransfer = extractTransferTag(existing.description);
    const transfer =
      taggedTransfer?.id
        ? await getTransfer(taggedTransfer.id)
        : await findLegacyTransfer({
            familyId: existing.family_id,
            sourceAccountId: existing.bank_account_id,
            amount: asNumber(existing.amount),
            date: existing.date,
          });

    if (transfer.error || !transfer.data) {
      return NextResponse.json({ error: transfer.error ?? "Transfer metadata not found." }, { status: 404 });
    }
    const transferData = transfer.data;
    if (transferData.family_id !== existing.family_id) {
      return NextResponse.json({ error: "Transfer does not belong to this family." }, { status: 400 });
    }

    const linkedTxRes = await getLinkedTransferTransactions(existing.family_id, transferData.id);
    if (linkedTxRes.error || !linkedTxRes.data) {
      return NextResponse.json({ error: linkedTxRes.error ?? "Failed to load linked transfer transactions." }, { status: 400 });
    }

    let sourceTxn =
      linkedTxRes.data.find((row) => extractTransferTag(row.description)?.side === "source") ?? null;
    let destinationTxn =
      linkedTxRes.data.find((row) => extractTransferTag(row.description)?.side === "dest") ?? null;

    if (!sourceTxn) {
      sourceTxn =
        linkedTxRes.data.find((row) => row.bank_account_id === transferData.source_account_id) ?? null;
    }
    if (!destinationTxn) {
      destinationTxn =
        linkedTxRes.data.find(
          (row) => row.id !== sourceTxn?.id && row.bank_account_id === transferData.dest_account_id
        ) ?? null;
    }

    if (!sourceTxn && !destinationTxn) {
      sourceTxn = existing;
    }

    const editedSide =
      taggedTransfer?.side ??
      (existing.bank_account_id === transferData.dest_account_id ? "dest" : "source");

    let nextSourceAccountId = transferData.source_account_id;
    let nextDestinationAccountId = transferData.dest_account_id;

    const requestedBankAccount = payload.bank_account_id?.trim();
    const requestedDestinationAccount = payload.to_bank_account_id?.trim();
    if (requestedBankAccount) {
      if (editedSide === "dest" && !requestedDestinationAccount) {
        nextDestinationAccountId = requestedBankAccount;
      } else {
        nextSourceAccountId = requestedBankAccount;
      }
    }
    if (requestedDestinationAccount) {
      nextDestinationAccountId = requestedDestinationAccount;
    }

    if (!nextDestinationAccountId) {
      return NextResponse.json({ error: "Destination account is required for transfer." }, { status: 400 });
    }
    if (nextSourceAccountId === nextDestinationAccountId) {
      return NextResponse.json({ error: "Transfer accounts must be different." }, { status: 400 });
    }

    const [sourceAccount, destinationAccount] = await Promise.all([
      getAccount(nextSourceAccountId),
      getAccount(nextDestinationAccountId),
    ]);
    if (sourceAccount.error || !sourceAccount.data) {
      return NextResponse.json({ error: sourceAccount.error ?? "Source account not found." }, { status: 404 });
    }
    if (destinationAccount.error || !destinationAccount.data) {
      return NextResponse.json({ error: destinationAccount.error ?? "Destination account not found." }, { status: 404 });
    }
    if (sourceAccount.data.family_id !== existing.family_id || destinationAccount.data.family_id !== existing.family_id) {
      return NextResponse.json({ error: "Transfer accounts must belong to the same family." }, { status: 400 });
    }
    if (!accessibleSet.has(nextSourceAccountId) || !accessibleSet.has(nextDestinationAccountId)) {
      return NextResponse.json({ error: "You do not have access to one of the transfer accounts." }, { status: 403 });
    }

    const [legacySource, legacyDestination] = await Promise.all([
      ensureLegacyAccountForBankAccount(nextSourceAccountId),
      ensureLegacyAccountForBankAccount(nextDestinationAccountId),
    ]);
    if (!legacySource.ok) {
      return NextResponse.json({ error: legacySource.error }, { status: 400 });
    }
    if (!legacyDestination.ok) {
      return NextResponse.json({ error: legacyDestination.error }, { status: 400 });
    }

    const oldSourceAccountId = transferData.source_account_id;
    const oldDestinationAccountId = transferData.dest_account_id;
    const oldAmount = asNumber(transferData.amount, asNumber(existing.amount));
    const transferId = transferData.id;
    const nextDate = payload.date !== undefined ? payload.date.slice(0, 10) : existing.date ?? todayIsoDate();
    const sourceDescription = withTransferTag(
      descriptionWithMembers ?? `Transfer to ${destinationAccount.data.name}`,
      transferId,
      "source"
    );
    const destinationDescription = withTransferTag(
      descriptionWithMembers ?? `Transfer from ${sourceAccount.data.name}`,
      transferId,
      "dest"
    );

    const undoSource = await applyBalanceDelta(oldSourceAccountId, oldAmount);
    if (!undoSource.ok) return NextResponse.json({ error: undoSource.error }, { status: 400 });
    const undoDestination = await applyBalanceDelta(oldDestinationAccountId, -oldAmount);
    if (!undoDestination.ok) return NextResponse.json({ error: undoDestination.error }, { status: 400 });

    const applySource = await applyBalanceDelta(nextSourceAccountId, -nextAmount);
    if (!applySource.ok) return NextResponse.json({ error: applySource.error }, { status: 400 });
    const applyDestination = await applyBalanceDelta(nextDestinationAccountId, nextAmount);
    if (!applyDestination.ok) return NextResponse.json({ error: applyDestination.error }, { status: 400 });

    const transferUpdate = await admin
      .from("transfers")
      .update({
        source_account_id: nextSourceAccountId,
        dest_account_id: nextDestinationAccountId,
        amount: nextAmount,
        date: nextDate,
        description: descriptionWithMembers,
      })
      .eq("id", transferId);
    if (transferUpdate.error) {
      return NextResponse.json({ error: transferUpdate.error.message }, { status: 400 });
    }

    const redundantIds = linkedTxRes.data
      .filter((row) => row.id !== sourceTxn?.id && row.id !== destinationTxn?.id)
      .map((row) => row.id);
    if (redundantIds.length) {
      const cleanup = await admin.from("transactions").delete().in("id", redundantIds);
      if (cleanup.error) {
        return NextResponse.json({ error: cleanup.error.message }, { status: 400 });
      }
    }

    const commonTransferPayload = {
      family_id: existing.family_id,
      created_by: user.id,
      user_id: user.id,
      assigned_to: nextAssignedMember,
      amount: nextAmount,
      type: "transfer" as const,
      category_id: null,
      category: "Transfer",
      date: nextDate,
    };

    let updatedSource: TransactionRow | null = null;
    if (sourceTxn) {
      const sourceUpdate = await admin
        .from("transactions")
        .update({
          ...commonTransferPayload,
          bank_account_id: nextSourceAccountId,
          account_id: nextSourceAccountId,
          description: sourceDescription,
        })
        .eq("id", sourceTxn.id)
        .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
        .single();
      if (sourceUpdate.error || !sourceUpdate.data) {
        return NextResponse.json({ error: sourceUpdate.error?.message ?? "Failed to update source transfer transaction." }, { status: 400 });
      }
      updatedSource = sourceUpdate.data as TransactionRow;
    } else {
      const sourceInsert = await admin
        .from("transactions")
        .insert({
          ...commonTransferPayload,
          bank_account_id: nextSourceAccountId,
          account_id: nextSourceAccountId,
          description: sourceDescription,
        })
        .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
        .single();
      if (sourceInsert.error || !sourceInsert.data) {
        return NextResponse.json({ error: sourceInsert.error?.message ?? "Failed to create source transfer transaction." }, { status: 400 });
      }
      updatedSource = sourceInsert.data as TransactionRow;
    }

    let updatedDestination: TransactionRow | null = null;
    if (destinationTxn) {
      const destinationUpdate = await admin
        .from("transactions")
        .update({
          ...commonTransferPayload,
          bank_account_id: nextDestinationAccountId,
          account_id: nextDestinationAccountId,
          description: destinationDescription,
        })
        .eq("id", destinationTxn.id)
        .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
        .single();
      if (destinationUpdate.error || !destinationUpdate.data) {
        return NextResponse.json({ error: destinationUpdate.error?.message ?? "Failed to update destination transfer transaction." }, { status: 400 });
      }
      updatedDestination = destinationUpdate.data as TransactionRow;
    } else {
      const destinationInsert = await admin
        .from("transactions")
        .insert({
          ...commonTransferPayload,
          bank_account_id: nextDestinationAccountId,
          account_id: nextDestinationAccountId,
          description: destinationDescription,
        })
        .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
        .single();
      if (destinationInsert.error || !destinationInsert.data) {
        return NextResponse.json({ error: destinationInsert.error?.message ?? "Failed to create destination transfer transaction." }, { status: 400 });
      }
      updatedDestination = destinationInsert.data as TransactionRow;
    }

    const responseTransaction =
      updatedSource?.id === transactionId
        ? updatedSource
        : updatedDestination?.id === transactionId
          ? updatedDestination
          : editedSide === "dest"
            ? updatedDestination
            : updatedSource;

    return NextResponse.json({
      transaction: responseTransaction,
      transactions: [updatedSource, updatedDestination].filter(Boolean),
      transfer_id: transferId,
    });
  }

  let oldCategoryAffectsLoan = false;
  let oldCategoryName: string | null = null;
  if (existing.category_id) {
    const oldCategory = await getCategory(existing.category_id);
    if (!oldCategory.error && oldCategory.data) {
      oldCategoryAffectsLoan = Boolean(oldCategory.data.affects_loan);
      oldCategoryName = oldCategory.data.name;
    }
  }

  let nextCategoryAffectsLoan = false;
  let nextCategoryName: string | null = null;
  if (nextCategoryId) {
    const category = await getCategory(nextCategoryId);
    if (category.error || !category.data) {
      return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
    }
    if (category.data.family_id !== existing.family_id) {
      return NextResponse.json({ error: "Category does not belong to this family." }, { status: 400 });
    }
    nextCategoryAffectsLoan = Boolean(category.data.affects_loan);
    nextCategoryName = category.data.name;
  }

  const account = await getAccount(nextBankAccountId);
  if (account.error || !account.data) {
    return NextResponse.json({ error: account.error ?? "Bank account not found." }, { status: 404 });
  }
  if (account.data.family_id !== existing.family_id) {
    return NextResponse.json({ error: "Bank account does not belong to this family." }, { status: 400 });
  }
  if (!accessibleSet.has(nextBankAccountId)) {
    return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
  }

  const legacyAccount = await ensureLegacyAccountForBankAccount(nextBankAccountId);
  if (!legacyAccount.ok) {
    return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
  }

  if (nextType === "expense" && nextCategoryAffectsLoan && !requestedLoanId) {
    return NextResponse.json(
      { error: "This category affects loan balance. Please select which loan to apply." },
      { status: 400 }
    );
  }

  if (requestedLoanId) {
    const loan = await getLoan(requestedLoanId);
    if (loan.error || !loan.data) {
      return NextResponse.json({ error: loan.error ?? "Loan not found." }, { status: 404 });
    }
    if (loan.data.family_id !== existing.family_id) {
      return NextResponse.json({ error: "Loan does not belong to this family." }, { status: 400 });
    }
  }

  const nextLoanId = nextType === "expense" && nextCategoryAffectsLoan ? requestedLoanId : null;
  const categoryLabel = nextCategoryName ?? (explicitCategoryChange ? "Other" : oldCategoryName ?? "Other");

  const updatePayload: Record<string, unknown> = {
    bank_account_id: nextBankAccountId,
    account_id: nextBankAccountId,
    assigned_to: nextAssignedMember,
    amount: nextAmount,
    type: nextType,
    category_id: nextCategoryId,
    category: categoryLabel,
    description: withLoanTag(descriptionWithMembers, nextLoanId),
  };
  if (payload.date !== undefined) updatePayload.date = payload.date.slice(0, 10);

  const update = await admin
    .from("transactions")
    .update(updatePayload)
    .eq("id", transactionId)
    .select("id,family_id,bank_account_id,assigned_to,amount,type,category_id,description,date,created_at")
    .single();

  if (update.error || !update.data) {
    return NextResponse.json({ error: update.error?.message ?? "Failed to update transaction." }, { status: 400 });
  }

  const oldImpact = accountImpact(existingType, asNumber(existing.amount));
  const newImpact = accountImpact(nextType, nextAmount);

  if (existing.bank_account_id === nextBankAccountId) {
    const delta = -oldImpact + newImpact;
    const balanceUpdate = await applyBalanceDelta(existing.bank_account_id, delta);
    if (!balanceUpdate.ok) return NextResponse.json({ error: balanceUpdate.error }, { status: 400 });
  } else {
    const sourceUpdate = await applyBalanceDelta(existing.bank_account_id, -oldImpact);
    if (!sourceUpdate.ok) return NextResponse.json({ error: sourceUpdate.error }, { status: 400 });
    const targetUpdate = await applyBalanceDelta(nextBankAccountId, newImpact);
    if (!targetUpdate.ok) return NextResponse.json({ error: targetUpdate.error }, { status: 400 });
  }

  const oldLoanAffects = existingType === "expense" && oldCategoryAffectsLoan && !!oldLoanId;
  const newLoanAffects = nextType === "expense" && nextCategoryAffectsLoan && !!nextLoanId;
  const oldLoanDelta = oldLoanAffects ? -asNumber(existing.amount) : 0;
  const newLoanDelta = newLoanAffects ? -nextAmount : 0;

  if (oldLoanId && nextLoanId && oldLoanId === nextLoanId) {
    const loanDelta = -oldLoanDelta + newLoanDelta;
    const updateLoan = await applyLoanRemainingDelta(oldLoanId, loanDelta);
    if (!updateLoan.ok) return NextResponse.json({ error: updateLoan.error }, { status: 400 });
  } else {
    if (oldLoanId && oldLoanAffects) {
      const undoOldLoan = await applyLoanRemainingDelta(oldLoanId, -oldLoanDelta);
      if (!undoOldLoan.ok) return NextResponse.json({ error: undoOldLoan.error }, { status: 400 });
    }
    if (nextLoanId && newLoanAffects) {
      const applyNewLoan = await applyLoanRemainingDelta(nextLoanId, newLoanDelta);
      if (!applyNewLoan.ok) return NextResponse.json({ error: applyNewLoan.error }, { status: 400 });
    }
  }

  return NextResponse.json({ transaction: update.data });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { transactionId?: string };
  const transactionId = (payload.transactionId ?? "").trim();
  if (!transactionId) {
    return NextResponse.json({ error: "transactionId is required." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const existingRes = await admin
    .from("transactions")
    .select("id,family_id,bank_account_id,amount,type,category_id,description,date")
    .eq("id", transactionId)
    .maybeSingle();

  if (existingRes.error || !existingRes.data) {
    return NextResponse.json({ error: existingRes.error?.message ?? "Transaction not found." }, { status: 404 });
  }

  const membership = await ensureFamilyMember(existingRes.data.family_id as string, user.id);
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }

  const access = await getAccessibleAccountIds(existingRes.data.family_id as string, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  if (!access.accountIds.includes(existingRes.data.bank_account_id as string)) {
    return NextResponse.json({ error: "You do not have access to this account." }, { status: 403 });
  }

  const existingType = normalizeType(existingRes.data.type);
  if (existingType === "transfer") {
    const taggedTransfer = extractTransferTag((existingRes.data.description as string | null) ?? null);
    const transfer =
      taggedTransfer?.id
        ? await getTransfer(taggedTransfer.id)
        : await findLegacyTransfer({
            familyId: existingRes.data.family_id as string,
            sourceAccountId: existingRes.data.bank_account_id as string,
            amount: asNumber(existingRes.data.amount),
            date: (existingRes.data.date as string | null) ?? null,
          });

    if (transfer.error || !transfer.data) {
      return NextResponse.json({ error: transfer.error ?? "Transfer metadata not found." }, { status: 404 });
    }
    if (transfer.data.family_id !== (existingRes.data.family_id as string)) {
      return NextResponse.json({ error: "Transfer does not belong to this family." }, { status: 400 });
    }
    if (
      !access.accountIds.includes(transfer.data.source_account_id) ||
      !access.accountIds.includes(transfer.data.dest_account_id)
    ) {
      return NextResponse.json({ error: "You do not have access to one of the transfer accounts." }, { status: 403 });
    }

    const amount = asNumber(transfer.data.amount, asNumber(existingRes.data.amount));
    const sourceUndo = await applyBalanceDelta(transfer.data.source_account_id, amount);
    if (!sourceUndo.ok) {
      return NextResponse.json({ error: sourceUndo.error }, { status: 400 });
    }
    const destinationUndo = await applyBalanceDelta(transfer.data.dest_account_id, -amount);
    if (!destinationUndo.ok) {
      return NextResponse.json({ error: destinationUndo.error }, { status: 400 });
    }

    const linkedTxRes = await getLinkedTransferTransactions(existingRes.data.family_id as string, transfer.data.id);
    if (linkedTxRes.error || !linkedTxRes.data) {
      return NextResponse.json({ error: linkedTxRes.error ?? "Failed to load linked transfer transactions." }, { status: 400 });
    }

    const transferDelete = await admin.from("transfers").delete().eq("id", transfer.data.id);
    if (transferDelete.error) {
      return NextResponse.json({ error: transferDelete.error.message }, { status: 400 });
    }

    const linkedIds = Array.from(new Set(linkedTxRes.data.map((row) => row.id)));
    const transferTxnDelete = linkedIds.length
      ? await admin.from("transactions").delete().in("id", linkedIds)
      : await admin.from("transactions").delete().eq("id", transactionId);
    if (transferTxnDelete.error) {
      return NextResponse.json({ error: transferTxnDelete.error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  }

  const del = await admin.from("transactions").delete().eq("id", transactionId);
  if (del.error) {
    return NextResponse.json({ error: del.error.message }, { status: 400 });
  }

  const impact = accountImpact(existingType, asNumber(existingRes.data.amount));
  const balanceUpdate = await applyBalanceDelta(existingRes.data.bank_account_id as string, -impact);
  if (!balanceUpdate.ok) {
    return NextResponse.json({ error: balanceUpdate.error }, { status: 400 });
  }

  const existingCategoryId = (existingRes.data.category_id as string | null) ?? null;
  const existingLoanId = extractLoanId((existingRes.data.description as string | null) ?? null);
  if (existingCategoryId && existingLoanId && existingType === "expense") {
    const category = await getCategory(existingCategoryId);
    if (!category.error && category.data && category.data.affects_loan) {
      const loanUpdate = await applyLoanRemainingDelta(existingLoanId, asNumber(existingRes.data.amount));
      if (!loanUpdate.ok) {
        return NextResponse.json({ error: loanUpdate.error }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ success: true });
}
