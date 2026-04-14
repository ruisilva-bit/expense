import { NextResponse } from "next/server";
import {
  asNumber,
  ensureAccountAccess,
  ensureLegacyAccountForBankAccount,
  ensureFamilyMember,
  getAccessibleAccountIds,
  getAccount,
  getCategory,
  getRequestUser,
  todayIsoDate,
} from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type LoanAccountRef = { account_id?: string | null; bank_account_id?: string | null } | null;

const isMissingLoanBankAccountColumnError = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes("bank_account_id") && lower.includes("does not exist");
};

async function getLoanAccountRef(loanId: string) {
  const admin = supabaseAdmin();
  const res = await admin.from("loans").select("account_id,bank_account_id").eq("id", loanId).maybeSingle();
  if (res.error && isMissingLoanBankAccountColumnError(res.error.message)) {
    const fallback = await admin.from("loans").select("account_id").eq("id", loanId).maybeSingle();
    return {
      data: (fallback.data as { account_id?: string | null } | null)
        ? { account_id: (fallback.data as { account_id?: string | null }).account_id ?? null, bank_account_id: null }
        : null,
      error: fallback.error,
    };
  }
  return { data: res.data as LoanAccountRef, error: res.error };
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

export async function POST(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as {
    loanId?: string;
    amount?: number;
    paidAt?: string;
    bank_account_id?: string;
    category_id?: string | null;
    description?: string | null;
  };

  const loanId = (payload.loanId ?? "").trim();
  const amount = Math.max(0, asNumber(payload.amount));
  const paidAt = (payload.paidAt ?? todayIsoDate()).slice(0, 10);
  const bankAccountId = (payload.bank_account_id ?? "").trim();
  const categoryId = (payload.category_id ?? "").trim();
  const description = payload.description?.trim() || null;
  let categoryName: string | null = null;

  if (!loanId || !amount) {
    return NextResponse.json({ error: "loanId and amount are required." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const loanRes = await admin
    .from("loans")
    .select("id,family_id,remaining_amount,total_amount")
    .eq("id", loanId)
    .maybeSingle();

  if (loanRes.error || !loanRes.data) {
    return NextResponse.json({ error: loanRes.error?.message ?? "Loan not found." }, { status: 404 });
  }

  const familyId = (loanRes.data.family_id as string | null) ?? null;
  if (!familyId) return NextResponse.json({ error: "Loan is missing family_id." }, { status: 400 });

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const access = await getAccessibleAccountIds(familyId, user.id);
  if (access.error || !access.accountIds) {
    return NextResponse.json({ error: access.error ?? "Failed to load account access." }, { status: 400 });
  }
  const loanAccountRes = await getLoanAccountRef(loanId);
  if (loanAccountRes.error) {
    return NextResponse.json({ error: loanAccountRes.error.message }, { status: 400 });
  }
  const loanAccountId =
    ((loanAccountRes.data as { account_id?: string | null; bank_account_id?: string | null } | null)?.account_id ??
      (loanAccountRes.data as { account_id?: string | null; bank_account_id?: string | null } | null)?.bank_account_id ??
      "")
      .trim();
  if (loanAccountId && !access.accountIds.includes(loanAccountId)) {
    return NextResponse.json({ error: "You do not have access to this loan account." }, { status: 403 });
  }

  if (bankAccountId) {
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
  }

  if (categoryId) {
    const category = await getCategory(categoryId);
    if (category.error || !category.data) {
      return NextResponse.json({ error: category.error ?? "Category not found." }, { status: 404 });
    }
    if (category.data.family_id !== familyId) {
      return NextResponse.json({ error: "Category does not belong to this family." }, { status: 400 });
    }
    categoryName = category.data.name;
  }

  const insert = await admin
    .from("loan_payments")
    .insert({
      loan_id: loanId,
      amount,
      paid_at: paidAt,
    })
    .select("id,loan_id,amount,paid_at")
    .single();

  if (insert.error || !insert.data) {
    return NextResponse.json({ error: insert.error?.message ?? "Failed to save payment." }, { status: 400 });
  }

  const currentRemaining = loanRes.data.remaining_amount ?? loanRes.data.total_amount;
  const nextRemaining = Math.max(0, asNumber(currentRemaining) - amount);
  await admin.from("loans").update({ remaining_amount: nextRemaining }).eq("id", loanId);

  if (bankAccountId) {
    const legacyAccount = await ensureLegacyAccountForBankAccount(bankAccountId);
    if (!legacyAccount.ok) {
      return NextResponse.json({ error: legacyAccount.error }, { status: 400 });
    }
    const transactionInsert = await admin.from("transactions").insert({
      family_id: familyId,
      bank_account_id: bankAccountId,
      account_id: bankAccountId,
      created_by: user.id,
      user_id: user.id,
      assigned_to: null,
      amount,
      type: "expense",
      category_id: categoryId || null,
      category: categoryName ?? "Loan payment",
      description: description || "Loan payment",
      date: paidAt,
    });

    if (transactionInsert.error) {
      return NextResponse.json(
        { error: `Payment saved but transaction failed: ${transactionInsert.error.message}` },
        { status: 400 }
      );
    }

    const balanceUpdate = await applyAccountDelta(bankAccountId, -amount);
    if (!balanceUpdate.ok) {
      return NextResponse.json(
        { error: `Payment saved but account balance update failed: ${balanceUpdate.error}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ payment: insert.data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const { user, error: userError } = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: userError ?? "Not signed in." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { paymentId?: string };
  const paymentId = (payload.paymentId ?? "").trim();
  if (!paymentId) return NextResponse.json({ error: "paymentId is required." }, { status: 400 });

  const admin = supabaseAdmin();
  const paymentRes = await admin
    .from("loan_payments")
    .select("id,loan_id,amount")
    .eq("id", paymentId)
    .maybeSingle();
  if (paymentRes.error || !paymentRes.data) {
    return NextResponse.json({ error: paymentRes.error?.message ?? "Payment not found." }, { status: 404 });
  }

  const payment = paymentRes.data as { id: string; loan_id: string; amount: number | string | null };

  const loanRes = await admin
    .from("loans")
    .select("id,family_id,remaining_amount")
    .eq("id", payment.loan_id)
    .maybeSingle();
  if (loanRes.error || !loanRes.data) {
    return NextResponse.json({ error: loanRes.error?.message ?? "Loan not found." }, { status: 404 });
  }

  const familyId = (loanRes.data.family_id as string | null) ?? null;
  if (!familyId) return NextResponse.json({ error: "Loan is missing family_id." }, { status: 400 });

  const membership = await ensureFamilyMember(familyId, user.id);
  if (!membership.ok) return NextResponse.json({ error: membership.error }, { status: membership.status });

  const loanAccountRes = await getLoanAccountRef(payment.loan_id);
  if (loanAccountRes.error) {
    return NextResponse.json({ error: loanAccountRes.error.message }, { status: 400 });
  }
  const accountId =
    ((loanAccountRes.data as { account_id?: string | null; bank_account_id?: string | null } | null)?.account_id ??
      (loanAccountRes.data as { account_id?: string | null; bank_account_id?: string | null } | null)?.bank_account_id ??
      "")
      .trim();
  if (accountId) {
    const accountAccess = await ensureAccountAccess(familyId, user.id, accountId);
    if (!accountAccess.ok) {
      return NextResponse.json({ error: accountAccess.error }, { status: accountAccess.status });
    }
  }

  const del = await admin.from("loan_payments").delete().eq("id", paymentId);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 400 });

  const currentRemaining = asNumber(loanRes.data.remaining_amount);
  const nextRemaining = Math.max(0, currentRemaining + asNumber(payment.amount));
  await admin.from("loans").update({ remaining_amount: nextRemaining }).eq("id", payment.loan_id);

  return NextResponse.json({ success: true });
}
