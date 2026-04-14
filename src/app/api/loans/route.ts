import { NextRequest, NextResponse } from "next/server";
import {
  asNumber,
  ensureAccountAccess,
  ensureFamilyMember,
  ensureLegacyAccountForBankAccount,
  getAccessibleAccountIds,
  getAccount,
  getRequestUser,
} from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type LoanRow = {
  id: string;
  family_id?: string | null;
  name: string | null;
  total_amount: number | string | null;
  remaining_amount?: number | string | null;
  monthly_payment: number | string | null;
  account_id?: string | null;
  created_at?: string | null;
  bank_account_id?: string | null;
};
type LoanPayment = { id: string; loan_id: string; amount: number; paid_at: string | null };
type LoanPaymentRow = { id: string; loan_id: string; amount: number | string | null; paid_at: string | null };

const isMissingLoanBankAccountColumnError = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes("bank_account_id") && lower.includes("does not exist");
};

async function getLoanAccountRef(loanId: string) {
  const admin = supabaseAdmin();
  const res = await admin.from("loans").select("id,account_id,bank_account_id").eq("id", loanId).maybeSingle();
  if (res.error && isMissingLoanBankAccountColumnError(res.error.message)) {
    const fallback = await admin.from("loans").select("id,account_id").eq("id", loanId).maybeSingle();
    return {
      data: (fallback.data as { id: string; account_id?: string | null } | null)
        ? {
            id: (fallback.data as { id: string; account_id?: string | null }).id,
            account_id: (fallback.data as { id: string; account_id?: string | null }).account_id ?? null,
            bank_account_id: null,
          }
        : null,
      error: fallback.error,
    };
  }
  return {
    data: res.data as { id: string; account_id?: string | null; bank_account_id?: string | null } | null,
    error: res.error,
  };
}

const normalizeLoan = (loan: LoanRow) => ({
  id: loan.id,
  family_id: loan.family_id ?? null,
  name: loan.name ?? "Loan",
  total_amount: asNumber(loan.total_amount),
  remaining_amount: asNumber(loan.remaining_amount, asNumber(loan.total_amount)),
  monthly_payment: asNumber(loan.monthly_payment),
  account_id: loan.account_id ?? loan.bank_account_id ?? null,
});

async function loadFamilyLoanBundle(familyId: string) {
  const admin = supabaseAdmin();
  let loansRes = await admin.from("loans").select("*").eq("family_id", familyId).order("created_at", { ascending: false });
  if (loansRes.error) {
    loansRes = await admin.from("loans").select("*");
    if (loansRes.error) return { loans: null, payments: null, error: loansRes.error.message };
  }

  const loans = ((loansRes.data ?? []) as LoanRow[]).filter((loan) => {
    if (loan.family_id) return loan.family_id === familyId;
    return false;
  });

  const loanIds = loans.map((loan) => loan.id);
  if (!loanIds.length) {
    return { loans: loans.map(normalizeLoan), payments: [], error: null };
  }

  const paymentsRes = await admin
    .from("loan_payments")
    .select("id,loan_id,amount,paid_at")
    .in("loan_id", loanIds)
    .order("paid_at", { ascending: false });
  if (paymentsRes.error) return { loans: null, payments: null, error: paymentsRes.error.message };

  const payments: LoanPayment[] = ((paymentsRes.data ?? []) as LoanPaymentRow[]).map((payment) => ({
    id: payment.id,
    loan_id: payment.loan_id,
    amount: asNumber(payment.amount),
    paid_at: payment.paid_at,
  }));

  return {
    loans: loans.map(normalizeLoan),
    payments,
    error: null,
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
  const accessibleSet = new Set(access.accountIds);

  const bundle = await loadFamilyLoanBundle(familyId);
  if (bundle.error) return NextResponse.json({ error: bundle.error }, { status: 400 });
  const visibleLoans = (bundle.loans ?? []).filter((loan) => {
    const accountId = loan.account_id ?? null;
    return accountId ? accessibleSet.has(accountId) : false;
  });
  const visibleLoanIds = new Set(visibleLoans.map((loan) => loan.id));
  return NextResponse.json({
    loans: visibleLoans,
    payments: (bundle.payments ?? []).filter((payment) => visibleLoanIds.has(payment.loan_id)),
  });
}

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    familyId?: string;
    name?: string;
    total_amount?: number;
    monthly_payment?: number;
    remaining_amount?: number;
    bank_account_id?: string;
    account_id?: string;
  };

  const familyId = (payload.familyId ?? "").trim();
  const name = (payload.name ?? "").trim();
  const totalAmount = Math.max(0, asNumber(payload.total_amount));
  const monthlyPayment =
    payload.monthly_payment !== undefined ? Math.max(0, asNumber(payload.monthly_payment)) : 0;
  const remainingAmount =
    payload.remaining_amount !== undefined
      ? Math.max(0, asNumber(payload.remaining_amount))
      : totalAmount;
  const accountId = (payload.bank_account_id ?? payload.account_id ?? "").trim();

  if (!familyId || !name || !totalAmount || !accountId) {
    return NextResponse.json(
      { error: "familyId, name, total_amount and bank_account_id are required." },
      { status: 400 }
    );
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const access = await ensureAccountAccess(familyId, user.id, accountId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const account = await getAccount(accountId);
  if (account.error || !account.data) {
    return NextResponse.json({ error: account.error ?? "Bank account not found." }, { status: 404 });
  }
  if (account.data.family_id !== familyId) {
    return NextResponse.json({ error: "Bank account does not belong to this family." }, { status: 400 });
  }
  const legacyAccount = await ensureLegacyAccountForBankAccount(accountId);
  if (!legacyAccount.ok) {
    return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const variants: Array<Record<string, unknown>> = [
    {
      family_id: familyId,
      name,
      total_amount: totalAmount,
      remaining_amount: remainingAmount,
      monthly_payment: monthlyPayment,
      account_id: accountId,
    },
    {
      family_id: familyId,
      name,
      total_amount: totalAmount,
      monthly_payment: monthlyPayment,
      account_id: accountId,
    },
    {
      name,
      total_amount: totalAmount,
      monthly_payment: monthlyPayment,
      account_id: accountId,
    },
    {
      family_id: familyId,
      name,
      total_amount: totalAmount,
      remaining_amount: remainingAmount,
      monthly_payment: monthlyPayment,
      bank_account_id: accountId,
    },
    {
      family_id: familyId,
      name,
      total_amount: totalAmount,
      monthly_payment: monthlyPayment,
      bank_account_id: accountId,
    },
  ];

  let insertError: string | null = null;
  let inserted: LoanRow | null = null;
  for (const variant of variants) {
    const attempt = await admin.from("loans").insert(variant).select("*").single();
    if (!attempt.error && attempt.data) {
      inserted = attempt.data as LoanRow;
      insertError = null;
      break;
    }
    insertError = attempt.error?.message ?? "Failed to create loan.";
  }

  if (!inserted) {
    return NextResponse.json({ error: insertError ?? "Failed to create loan." }, { status: 400 });
  }

  return NextResponse.json({ loan: normalizeLoan(inserted) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    loanId?: string;
    name?: string;
    total_amount?: number;
    remaining_amount?: number;
    monthly_payment?: number;
    bank_account_id?: string;
    account_id?: string;
  };

  const loanId = (payload.loanId ?? "").trim();
  if (!loanId) return NextResponse.json({ error: "loanId is required." }, { status: 400 });

  const admin = supabaseAdmin();
  const existing = await admin.from("loans").select("*").eq("id", loanId).maybeSingle();
  if (existing.error || !existing.data) {
    return NextResponse.json({ error: existing.error?.message ?? "Loan not found." }, { status: 404 });
  }

  const existingLoan = existing.data as LoanRow;
  const familyId = existingLoan.family_id ?? null;
  if (!familyId) {
    return NextResponse.json({ error: "Loan is missing family_id." }, { status: 400 });
  }

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const currentLoanAccountId = (existingLoan.account_id ?? existingLoan.bank_account_id ?? "").trim();
  if (currentLoanAccountId) {
    const accountAccess = await ensureAccountAccess(familyId, user.id, currentLoanAccountId);
    if (!accountAccess.ok) {
      return NextResponse.json({ error: accountAccess.error }, { status: accountAccess.status });
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (payload.name !== undefined) updatePayload.name = payload.name.trim();
  if (payload.total_amount !== undefined) updatePayload.total_amount = Math.max(0, asNumber(payload.total_amount));
  if (payload.remaining_amount !== undefined) {
    updatePayload.remaining_amount = Math.max(0, asNumber(payload.remaining_amount));
  }
  if (payload.monthly_payment !== undefined) {
    updatePayload.monthly_payment = Math.max(0, asNumber(payload.monthly_payment));
  }
  const nextAccountId = (payload.bank_account_id ?? payload.account_id ?? "").trim();
  if (nextAccountId) {
    const account = await getAccount(nextAccountId);
    if (account.error || !account.data) {
      return NextResponse.json({ error: account.error ?? "Bank account not found." }, { status: 404 });
    }
    if (account.data.family_id !== familyId) {
      return NextResponse.json({ error: "Bank account does not belong to this family." }, { status: 400 });
    }
    const accountAccess = await ensureAccountAccess(familyId, user.id, nextAccountId);
    if (!accountAccess.ok) {
      return NextResponse.json({ error: accountAccess.error }, { status: accountAccess.status });
    }
    const legacyAccount = await ensureLegacyAccountForBankAccount(nextAccountId);
    if (!legacyAccount.ok) {
      return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
    }
    updatePayload.account_id = nextAccountId;
    updatePayload.bank_account_id = nextAccountId;
  }

  if (!Object.keys(updatePayload).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const update = await admin.from("loans").update(updatePayload).eq("id", loanId).select("*").single();
  if (update.error || !update.data) {
    return NextResponse.json({ error: update.error?.message ?? "Failed to update loan." }, { status: 400 });
  }

  return NextResponse.json({ loan: normalizeLoan(update.data as LoanRow) });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { loanId?: string };
  const loanId = (payload.loanId ?? "").trim();
  if (!loanId) return NextResponse.json({ error: "loanId is required." }, { status: 400 });

  const admin = supabaseAdmin();
  const existing = await admin.from("loans").select("id,family_id").eq("id", loanId).maybeSingle();
  if (existing.error || !existing.data) {
    return NextResponse.json({ error: existing.error?.message ?? "Loan not found." }, { status: 404 });
  }

  const existingLoan = existing.data as { id: string; family_id: string | null };
  const familyId = existingLoan.family_id ?? null;
  if (!familyId) return NextResponse.json({ error: "Loan is missing family_id." }, { status: 400 });

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const loanDetails = await getLoanAccountRef(loanId);
  if (loanDetails.error || !loanDetails.data) {
    return NextResponse.json({ error: loanDetails.error?.message ?? "Loan not found." }, { status: 404 });
  }
  const currentLoanAccountId =
    ((loanDetails.data as { account_id?: string | null; bank_account_id?: string | null }).account_id ??
      (loanDetails.data as { account_id?: string | null; bank_account_id?: string | null }).bank_account_id ??
      "")
      .trim();
  if (currentLoanAccountId) {
    const accountAccess = await ensureAccountAccess(familyId, user.id, currentLoanAccountId);
    if (!accountAccess.ok) {
      return NextResponse.json({ error: accountAccess.error }, { status: accountAccess.status });
    }
  }

  const del = await admin.from("loans").delete().eq("id", loanId);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 });

  return NextResponse.json({ success: true });
}
