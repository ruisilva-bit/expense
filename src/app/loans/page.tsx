"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { PrettySelect } from "@/components/PrettySelect";
import { SafeResponsiveContainer } from "@/components/SafeResponsiveContainer";
import { useAppState } from "@/context/AppState";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import { formatEur, formatEurAxis } from "@/lib/format";

type Loan = {
  id: string;
  family_id: string | null;
  name: string;
  total_amount: number;
  remaining_amount: number;
  account_id: string | null;
};

type LoansPayload = {
  loans: Loan[];
};

type LoanTxn = {
  id: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  date: string | null;
  assigned_to: string | null;
  description: string | null;
  category?: { id: string; name: string } | null;
  member?: { id: string; name: string } | null;
  loan?: { id: string; name: string } | null;
};

type LoanTransactionsPayload = {
  transactions: LoanTxn[];
};

const monthLabel = (value: string) => {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};

const USER_CHART_COLORS = [
  "#06b6d4",
  "#22c55e",
  "#f59e0b",
  "#f97316",
  "#a855f7",
  "#e11d48",
  "#6366f1",
  "#14b8a6",
];

export default function LoansPage() {
  const { selectedFamily, selectedAccount, accounts } = useAppState();
  const [name, setName] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [activeLoanId, setActiveLoanId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [didInitAccountPreset, setDidInitAccountPreset] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [editingLoanName, setEditingLoanName] = useState("");
  const [editingLoanTotal, setEditingLoanTotal] = useState("");
  const [editingLoanRemaining, setEditingLoanRemaining] = useState("");
  const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
  const accountOptions = [
    { value: "", label: "Choose account" },
    ...accounts.map((account) => ({ value: account.id, label: account.name })),
  ];

  useEffect(() => {
    setDidInitAccountPreset(false);
  }, [selectedFamily?.id]);

  useEffect(() => {
    if (didInitAccountPreset) return;
    if (!accounts.length) return;

    const preferred = selectedAccount?.id && accounts.some((account) => account.id === selectedAccount.id)
      ? selectedAccount.id
      : accounts[0].id;

    setAccountId(preferred);
    setDidInitAccountPreset(true);
  }, [didInitAccountPreset, accounts, selectedAccount?.id]);

  const { data, error, mutate, isLoading } = useSWR(
    selectedFamily ? `loans:${selectedFamily.id}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      return fetchClientJson<LoansPayload>(`/api/loans?familyId=${encodeURIComponent(selectedFamily!.id)}`, {
        method: "GET",
        headers,
      });
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const { data: txData, error: txError } = useSWR(
    selectedFamily ? `loan-transactions:${selectedFamily.id}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      return fetchClientJson<LoanTransactionsPayload>(
        `/api/transactions?familyId=${encodeURIComponent(selectedFamily!.id)}&page=1&pageSize=500`,
        { method: "GET", headers }
      );
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const loanTransactions = useMemo(
    () => (txData?.transactions ?? []).filter((transaction) => transaction.type === "expense" && transaction.loan?.id),
    [txData?.transactions]
  );

  const activeLoan = useMemo(
    () => (data?.loans ?? []).find((loan) => loan.id === activeLoanId) ?? null,
    [data?.loans, activeLoanId]
  );

  useEffect(() => {
    const loans = data?.loans ?? [];
    if (!loans.length) {
      if (activeLoanId) setActiveLoanId(null);
      return;
    }
    if (!activeLoanId || !loans.some((loan) => loan.id === activeLoanId)) {
      setActiveLoanId(loans[0].id);
    }
  }, [data?.loans, activeLoanId]);

  const activeLoanTransactions = useMemo(() => {
    if (!activeLoan) return [];
    return loanTransactions.filter((transaction) => transaction.loan?.id === activeLoan.id);
  }, [loanTransactions, activeLoan]);

  const activeRemainingChart = useMemo(() => {
    if (!activeLoan) return [];
    const paid = Math.max(0, activeLoan.total_amount - activeLoan.remaining_amount);
    return [
      {
        metric: "Paid",
        amount: paid,
        color: "#16a34a",
      },
      {
        metric: "Remaining",
        amount: activeLoan.remaining_amount,
        color: "#ef4444",
      },
    ];
  }, [activeLoan]);

  const activeMonthlyPayments = useMemo(() => {
    const buckets = new Map<string, number>();
    activeLoanTransactions.forEach((transaction) => {
      if (!transaction.date) return;
      const month = transaction.date.slice(0, 7);
      buckets.set(month, (buckets.get(month) ?? 0) + Number(transaction.amount ?? 0));
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({
        month: monthLabel(month),
        amount,
      }));
  }, [activeLoanTransactions]);

  const activePaymentByMember = useMemo(() => {
    const buckets = new Map<string, number>();
    activeLoanTransactions.forEach((transaction) => {
      const key = transaction.member?.name ?? "Unassigned";
      buckets.set(key, (buckets.get(key) ?? 0) + Number(transaction.amount ?? 0));
    });
    return Array.from(buckets.entries()).map(([member, amount]) => ({ member, amount }));
  }, [activeLoanTransactions]);

  const loanSummary = useMemo(() => {
    const loans = data?.loans ?? [];
    const total = loans.reduce((sum, loan) => sum + Number(loan.total_amount ?? 0), 0);
    const remaining = loans.reduce((sum, loan) => sum + Number(loan.remaining_amount ?? 0), 0);
    const paid = Math.max(0, total - remaining);
    return { total, paid, remaining };
  }, [data?.loans]);

  const createLoan = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFamily) return;
    if (!name.trim() || !totalAmount || !accountId) return;

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ loan: Loan }>("/api/loans", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          familyId: selectedFamily.id,
          name: name.trim(),
          total_amount: Number(totalAmount),
          bank_account_id: accountId,
        }),
      });
      setName("");
      setTotalAmount("");
      setAccountId(accounts[0]?.id ?? "");
      await mutate();
    } catch (createError) {
      setErrorMessage(createError instanceof Error ? createError.message : "Failed to create loan.");
    } finally {
      setIsSaving(false);
    }
  };

  const editLoan = async (loanId: string, nextName: string, nextTotal: string, nextRemaining: string) => {
    if (!nextName.trim()) return;
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ loan: Loan }>("/api/loans", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          loanId,
          name: nextName.trim(),
          total_amount: Number(nextTotal),
          remaining_amount: Number(nextRemaining),
        }),
      });
      await mutate();
    } catch (updateError) {
      setErrorMessage(updateError instanceof Error ? updateError.message : "Failed to update loan.");
    }
  };

  const deleteLoan = async (loanId: string) => {
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ success: true }>("/api/loans", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ loanId }),
      });
      await mutate();
      return true;
    } catch (deleteError) {
      setErrorMessage(deleteError instanceof Error ? deleteError.message : "Failed to delete loan.");
      return false;
    }
  };

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 lg:pl-64">
        <div>
          <p className="text-sm text-slate-500">Loans</p>
          <h1 className="text-2xl font-semibold">{selectedFamily ? "Shared debt tracking" : "Select a family"}</h1>
        </div>

        {(error || errorMessage || txError) && (
          <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error
              ? `Could not load loans: ${error.message}`
              : txError
                ? `Could not load loan transactions: ${txError.message}`
                : errorMessage}
          </div>
        )}

        {!selectedFamily && <div className="card p-4">Select a family first.</div>}

        {selectedFamily && (
          <>
            <section className="grid gap-4 sm:grid-cols-3">
              <div className="card p-4">
                <p className="text-sm text-slate-500">Total loan amount</p>
                <p className="text-2xl font-semibold">{formatEur(loanSummary.total)}</p>
              </div>
              <div className="card p-4">
                <p className="text-sm text-slate-500">Total paid</p>
                <p className="text-2xl font-semibold text-emerald-700">{formatEur(loanSummary.paid)}</p>
              </div>
              <div className="card p-4">
                <p className="text-sm text-slate-500">Remaining amount</p>
                <p className="text-2xl font-semibold text-red-600">{formatEur(loanSummary.remaining)}</p>
              </div>
            </section>

            {accounts.length > 0 ? (
              <form onSubmit={createLoan} className="card space-y-3 p-4">
                <h2 className="text-lg font-semibold">Create loan</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <input
                    className="input"
                    placeholder="Loan name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="Total amount"
                    value={totalAmount}
                    onChange={(event) => setTotalAmount(event.target.value)}
                    required
                  />
                  <PrettySelect
                    value={accountId}
                    onChange={setAccountId}
                    options={accountOptions}
                    placeholder="Choose account"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Payments are tracked through normal expense transactions using categories marked as loan-affecting.
                </p>
                <button className="btn btn-primary w-fit" type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Create"}
                </button>
              </form>
            ) : (
              <div className="card p-4">Create a bank account first.</div>
            )}

            <section className="space-y-3">
              {isLoading && <div className="card p-4">Loading loans...</div>}
              {(data?.loans ?? []).map((loan) => {
                const accountName = accounts.find((account) => account.id === loan.account_id)?.name ?? "Unlinked account";
                const isSelected = loan.id === activeLoanId;
                return (
                  <button
                    key={loan.id}
                    type="button"
                    className={`card flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:border-emerald-300 ${
                      isSelected ? "border-emerald-500" : ""
                    }`}
                    onClick={() => setActiveLoanId(loan.id)}
                  >
                    <div>
                      <p className="text-sm text-slate-500">Loan · {accountName}</p>
                      <p className="text-lg font-semibold">{loan.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">Remaining</p>
                      <p className="text-xl font-semibold text-red-600">{formatEur(loan.remaining_amount)}</p>
                      {isSelected && <p className="text-xs text-emerald-700">Selected</p>}
                    </div>
                  </button>
                );
              })}
              {!isLoading && !(data?.loans ?? []).length && <div className="card p-4 text-slate-600">No loans yet.</div>}
            </section>

            {activeLoan && (
              <section className="card space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-slate-500">Loan details</p>
                    <h2 className="text-xl font-semibold">{activeLoan.name}</h2>
                    <p className="text-sm text-slate-500">
                      Remaining {formatEur(activeLoan.remaining_amount)} / Total {formatEur(activeLoan.total_amount)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn btn-ghost border border-slate-200"
                      type="button"
                      onClick={() => {
                        setEditingLoan(activeLoan);
                        setEditingLoanName(activeLoan.name);
                        setEditingLoanTotal(String(activeLoan.total_amount));
                        setEditingLoanRemaining(String(activeLoan.remaining_amount));
                      }}
                    >
                      Edit loan
                    </button>
                    <button
                      className="btn btn-ghost border border-red-200 text-red-600 hover:bg-red-50"
                      type="button"
                      onClick={() => {
                        setDeletingLoan(activeLoan);
                      }}
                    >
                      Delete loan
                    </button>
                  </div>
                </div>

                <section className="grid gap-4 lg:grid-cols-2">
                  <div className="card min-w-0 space-y-2 p-4">
                    <h3 className="text-lg font-semibold">Paid vs remaining</h3>
                    <div className="h-64 min-w-0">
                      <SafeResponsiveContainer minHeight={220}>
                        <BarChart data={activeRemainingChart} margin={{ top: 8, right: 16, bottom: 8, left: 18 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="metric" interval={0} minTickGap={18} tick={{ fontSize: 12 }} />
                          <YAxis width={64} tickFormatter={(value) => formatEurAxis(Number(value ?? 0))} />
                          <Tooltip formatter={(value) => formatEur(Number(value ?? 0))} />
                          <Bar dataKey="amount" radius={[8, 8, 0, 0]} name="Amount">
                            {activeRemainingChart.map((entry) => (
                              <Cell key={`remaining-${entry.metric}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </SafeResponsiveContainer>
                    </div>
                  </div>

                  <div className="card min-w-0 space-y-2 p-4">
                    <h3 className="text-lg font-semibold">Payments by month</h3>
                    <div className="h-64 min-w-0">
                      <SafeResponsiveContainer minHeight={220}>
                        <LineChart data={activeMonthlyPayments} margin={{ top: 8, right: 16, bottom: 8, left: 18 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis width={64} tickFormatter={(value) => formatEurAxis(Number(value ?? 0))} />
                          <Tooltip formatter={(value) => formatEur(Number(value ?? 0))} />
                          <Legend />
                          <Line type="monotone" dataKey="amount" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Paid" />
                        </LineChart>
                      </SafeResponsiveContainer>
                    </div>
                  </div>
                </section>

                <section className="card min-w-0 space-y-2 p-4">
                  <h3 className="text-lg font-semibold">Payments by user</h3>
                  <div className="h-64 min-w-0">
                    <SafeResponsiveContainer minHeight={220}>
                      <BarChart data={activePaymentByMember} margin={{ top: 8, right: 16, bottom: 8, left: 18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="member" interval={0} minTickGap={18} tick={{ fontSize: 11 }} />
                        <YAxis width={64} tickFormatter={(value) => formatEurAxis(Number(value ?? 0))} />
                        <Tooltip formatter={(value) => formatEur(Number(value ?? 0))} />
                        <Bar dataKey="amount" radius={[8, 8, 0, 0]}>
                          {activePaymentByMember.map((entry, index) => (
                            <Cell
                              key={`member-${entry.member}`}
                              fill={USER_CHART_COLORS[index % USER_CHART_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </SafeResponsiveContainer>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-lg font-semibold">Past loan transactions</h3>
                  {!activeLoanTransactions.length && (
                    <div className="card p-3 text-sm text-slate-500">No loan transactions yet.</div>
                  )}
                  {!!activeLoanTransactions.length && (
                    <ul className="card divide-y divide-slate-200 px-4">
                      {activeLoanTransactions.slice(0, 30).map((transaction) => (
                        <li key={transaction.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div>
                            <p className="font-medium text-slate-900">{transaction.category?.name ?? "Loan payment"}</p>
                            <p className="text-sm text-slate-600">{transaction.description || "No description"}</p>
                            <p className="text-xs text-slate-500">
                              {transaction.date ?? "No date"} · {transaction.member?.name ?? "Unassigned"}
                            </p>
                          </div>
                          <p className="font-semibold text-red-600">-{formatEur(Number(transaction.amount ?? 0))}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </section>
            )}
          </>
        )}
      </main>

      <AppDialog
        open={Boolean(editingLoan)}
        onClose={() => setEditingLoan(null)}
        title="Edit loan"
        subtitle={editingLoan?.name ?? "Loan"}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingLoan) return;
            void (async () => {
              await editLoan(editingLoan.id, editingLoanName, editingLoanTotal, editingLoanRemaining);
              setEditingLoan(null);
            })();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Name</span>
            <input
              className="input"
              value={editingLoanName}
              onChange={(event) => setEditingLoanName(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Total amount</span>
            <input
              className="input"
              type="number"
              step="0.01"
              value={editingLoanTotal}
              onChange={(event) => setEditingLoanTotal(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Remaining amount</span>
            <input
              className="input"
              type="number"
              step="0.01"
              value={editingLoanRemaining}
              onChange={(event) => setEditingLoanRemaining(event.target.value)}
              required
            />
          </label>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingLoan(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingLoan)}
        title="Delete loan"
        description={`Delete "${deletingLoan?.name ?? "this loan"}"?`}
        confirmLabel="Delete loan"
        destructive
        onClose={() => setDeletingLoan(null)}
        onConfirm={() => {
          if (!deletingLoan) return;
          void (async () => {
            const deleted = await deleteLoan(deletingLoan.id);
            if (deleted && activeLoanId === deletingLoan.id) setActiveLoanId(null);
            setDeletingLoan(null);
          })();
        }}
      />
    </div>
  );
}
