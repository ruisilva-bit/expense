"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { EntityPopover } from "@/components/EntityPopover";
import { useAppState } from "@/context/AppState";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import { fetchAllPages } from "@/lib/fetch-all-pages";
import {
  calculateNetBalance,
  calculateTotalReceived,
  sumFinancialTransactions,
} from "@/lib/financial-totals";
import { formatEur } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase-browser";

const TRANSACTIONS_PAGE_SIZE = 100;

type FamilyUser = {
  id: string;
  user_id: string | null;
  name: string;
  role: "owner" | "member" | null;
};

type Account = {
  id: string;
  name: string;
  balance: number;
  visible_user_ids?: string[];
  owner_user_ids?: string[];
};

type Transaction = {
  id: string;
  bank_account_id: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  transfer_side?: "source" | "dest" | null;
  goal_move_type?: "allocate" | "release" | "spend" | null;
  balance_after?: number | null;
  description: string | null;
  date: string | null;
  category?: { id: string; name: string } | null;
  member?: { id: string; name: string } | null;
};

export default function AccountsPage() {
  const { user, selectedFamily, selectedAccount, setSelectedAccount, accounts, refresh, isAccountsLoading } = useAppState();
  const supabase = supabaseBrowser();
  const [createError, setCreateError] = useState<string | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editingAccountName, setEditingAccountName] = useState("");
  const [editingAccountBalance, setEditingAccountBalance] = useState("");
  const [adjustingAccount, setAdjustingAccount] = useState<Account | null>(null);
  const [adjustBalanceValue, setAdjustBalanceValue] = useState("");
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);

  const { data: familyUsersData } = useSWR(
    selectedFamily ? `family-users:${selectedFamily.id}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      return fetchClientJson<{ members: FamilyUser[] }>(
        `/api/family-members?familyId=${encodeURIComponent(selectedFamily!.id)}`,
        { method: "GET", headers }
      );
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const { data: transactionsData, error: transactionsError, isLoading: isTransactionsLoading } = useSWR(
    selectedFamily ? `account-transactions:${selectedFamily.id}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      const transactions = await fetchAllPages<Transaction>(async (page) => {
        const response = await fetchClientJson<{ transactions: Transaction[]; pageSize: number }>(
          `/api/transactions?familyId=${encodeURIComponent(selectedFamily!.id)}&page=${page}&pageSize=${TRANSACTIONS_PAGE_SIZE}`,
          { method: "GET", headers }
        );
        return { items: response.transactions, pageSize: response.pageSize };
      });
      return { transactions };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const realUsers = useMemo(
    () => (familyUsersData?.members ?? []).filter((member) => Boolean(member.user_id)),
    [familyUsersData?.members]
  );

  const activeAccount = useMemo(
    () => (accounts.find((account) => account.id === activeAccountId) as Account | undefined) ?? null,
    [accounts, activeAccountId]
  );

  const accountTransactions = useMemo(() => {
    if (!activeAccount) return [];
    return (transactionsData?.transactions ?? []).filter((transaction) => transaction.bank_account_id === activeAccount.id);
  }, [transactionsData?.transactions, activeAccount]);

  const accountMovementTotals = useMemo(
    () => sumFinancialTransactions(accountTransactions),
    [accountTransactions]
  );
  const accountTotalReceived = calculateTotalReceived(accountMovementTotals);
  const accountTotalSpent = accountMovementTotals.spent;
  const accountNetBalance = calculateNetBalance(accountMovementTotals);

  const createAccount = async (formData: FormData) => {
    if (!selectedFamily) return;
    setCreateError(null);
    const name = String(formData.get("name") || "Account");
    const balance = Number(formData.get("balance") || 0);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch("/api/bank-accounts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ familyId: selectedFamily.id, name, balance }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setCreateError(payload.error ?? "Failed to create account.");
        return;
      }

      refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create account.");
    }
  };

  const editAccount = async (accountId: string, name: string, balance: number) => {
    if (!name.trim() || !Number.isFinite(balance)) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch("/api/bank-accounts", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ accountId, name: name.trim(), balance }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setCreateError(payload.error ?? "Failed to update account.");
        return;
      }
      refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to update account.");
    }
  };

  const adjustBalance = async (accountId: string, balance: number) => {
    if (!Number.isFinite(balance)) {
      setCreateError("Balance must be a valid number.");
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch("/api/bank-accounts", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ accountId, balance }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setCreateError(payload.error ?? "Failed to update balance.");
        return;
      }
      refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to update balance.");
    }
  };

  const saveVisibility = async (accountId: string, visibleUserIds: string[], ownerUserIds: string[]) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch("/api/bank-accounts", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ accountId, visible_user_ids: visibleUserIds, owner_user_ids: ownerUserIds }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setCreateError(payload.error ?? "Failed to update account visibility.");
        return;
      }
      refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to update account visibility.");
    }
  };

  const deleteAccount = async (accountId: string) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch("/api/bank-accounts", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ accountId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setCreateError(payload.error ?? "Failed to delete account.");
        return false;
      }
      if (selectedAccount?.id === accountId) {
        setSelectedAccount(null);
      }
      refresh();
      return true;
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to delete account.");
      return false;
    }
  };

  return (
    <div className="min-h-screen app-shell">
      <AppNav />
      <main className="app-main page-accounts max-w-5xl space-y-8">
        <div className="page-header">
          <div>
            <p className="page-kicker">Accounts</p>
            <h1 className="page-title">{selectedFamily?.name || "Select a family"}</h1>
            <p className="page-subtitle">Balances and account access in one clear view.</p>
          </div>
        </div>

        {!selectedFamily && <div className="card p-4">Choose a family first.</div>}

        {selectedFamily && (
          <>
            <form action={createAccount} className="card editorial-form space-y-3 p-4">
              <p className="text-sm text-slate-600">Create account</p>
              <input name="name" className="input" placeholder="Account name" required />
              <input name="balance" type="number" step="0.01" className="input" placeholder="Starting balance" />
              <button className="btn btn-primary w-fit">Create</button>
              {createError && <p className="text-sm text-red-600">{createError}</p>}
              {transactionsError && (
                <p className="text-sm text-red-600">Could not load transactions: {transactionsError.message}</p>
              )}
            </form>

            <section className="ledger-selector-list space-y-3">
              {accounts.map((account) => {
                const currentAccount = account as Account;
                return (
                  <button
                    key={currentAccount.id}
                    className={`card flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:border-emerald-300 ${
                      selectedAccount?.id === currentAccount.id ? "border-emerald-500" : ""
                    }`}
                    onClick={() => {
                      setActiveAccountId(currentAccount.id);
                    }}
                    type="button"
                  >
                    <div>
                      <p className="text-sm text-slate-500">Bank account</p>
                      <p className="text-lg font-semibold">{currentAccount.name}</p>
                      {selectedAccount?.id === currentAccount.id && (
                        <p className="mt-0.5 text-xs font-medium text-emerald-700">Main account</p>
                      )}
                    </div>
                    <p className="text-xl font-semibold">{formatEur(Number(currentAccount.balance || 0))}</p>
                  </button>
                );
              })}

              {isAccountsLoading && <div className="card p-4">Loading accounts...</div>}
              {!isAccountsLoading && !accounts.length && <div className="card p-4">No accounts yet.</div>}
            </section>
          </>
        )}
      </main>

      {activeAccount && (
        <EntityPopover
          title={activeAccount.name}
          subtitle={`Balance ${formatEur(Number(activeAccount.balance || 0))}`}
          onClose={() => setActiveAccountId(null)}
        >
          {(() => {
            const visibleUserIds = activeAccount.visible_user_ids?.length
              ? activeAccount.visible_user_ids
              : realUsers
                  .map((member) => member.user_id)
                  .filter((userId): userId is string => Boolean(userId));
            const ownerUserIds = activeAccount.owner_user_ids?.length ? activeAccount.owner_user_ids : visibleUserIds.slice(0, 1);
            const canManageAccess = ownerUserIds.includes(user?.id ?? "");

            return (
              <>
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Total received</p>
                    <p className="text-lg font-semibold">{formatEur(accountTotalReceived)}</p>
                    <p className="text-[11px] text-slate-500">income - transfer out + transfer in + goal releases</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Total spent</p>
                    <p className="text-lg font-semibold text-red-600">{formatEur(accountTotalSpent)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Net balance</p>
                    <p className={`text-lg font-semibold ${accountNetBalance >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatEur(accountNetBalance)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">Current balance</p>
                    <p className="text-lg font-semibold">{formatEur(Number(activeAccount.balance || 0))}</p>
                  </div>
                </section>

                <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedAccount?.id === activeAccount.id}
                      onChange={(event) => {
                        if (event.target.checked) setSelectedAccount(activeAccount);
                      }}
                    />
                    Main account
                  </label>
                  <button
                    className="btn btn-ghost border border-slate-200"
                    type="button"
                    onClick={() => {
                      setAdjustingAccount(activeAccount);
                      setAdjustBalanceValue(String(Number(activeAccount.balance || 0)));
                    }}
                  >
                    Adjust balance
                  </button>
                  <button
                    className="btn btn-ghost border border-slate-200"
                    type="button"
                    onClick={() => {
                      setEditingAccount(activeAccount);
                      setEditingAccountName(activeAccount.name);
                      setEditingAccountBalance(String(Number(activeAccount.balance || 0)));
                    }}
                  >
                    Edit name/balance
                  </button>
                  <button
                    className="btn btn-ghost border border-red-200 text-red-600 hover:bg-red-50"
                    type="button"
                    onClick={() => {
                      setDeletingAccount(activeAccount);
                    }}
                  >
                    Delete account
                  </button>
                </section>

                {realUsers.length > 1 && (
                  <section className="space-y-3 rounded-xl border border-slate-200 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Account visibility</p>
                      <p className="text-xs text-slate-500">New accounts start owner-only.</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {realUsers.map((member) => {
                        const userId = member.user_id as string;
                        const isVisible = visibleUserIds.includes(userId);
                        return (
                          <label key={`${member.id}-visibility`} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              disabled={!canManageAccess}
                              checked={isVisible}
                              onChange={() => {
                                const nextVisible = isVisible
                                  ? visibleUserIds.filter((id) => id !== userId)
                                  : [...visibleUserIds, userId];
                                const nextOwners = isVisible
                                  ? ownerUserIds.filter((id) => id !== userId)
                                  : ownerUserIds;

                                if (!nextVisible.length) {
                                  setCreateError("At least one user must have account access.");
                                  return;
                                }
                                if (!nextOwners.length) {
                                  setCreateError("At least one account owner is required.");
                                  return;
                                }

                                void saveVisibility(activeAccount.id, nextVisible, nextOwners);
                              }}
                            />
                            {member.name}
                          </label>
                        );
                      })}
                    </div>

                    <div>
                      <p className="text-sm font-medium text-slate-700">Account owners</p>
                      <p className="text-xs text-slate-500">Only owners can change visibility and owners.</p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {realUsers.map((member) => {
                        const userId = member.user_id as string;
                        const isOwner = ownerUserIds.includes(userId);
                        return (
                          <label key={`${member.id}-owner`} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              disabled={!canManageAccess}
                              checked={isOwner}
                              onChange={() => {
                                const nextOwners = isOwner
                                  ? ownerUserIds.filter((id) => id !== userId)
                                  : [...ownerUserIds, userId];
                                const nextVisible = visibleUserIds.includes(userId)
                                  ? visibleUserIds
                                  : [...visibleUserIds, userId];

                                if (!nextOwners.length) {
                                  setCreateError("At least one account owner is required.");
                                  return;
                                }

                                void saveVisibility(activeAccount.id, nextVisible, nextOwners);
                              }}
                            />
                            {member.name}
                          </label>
                        );
                      })}
                    </div>

                    {!canManageAccess && (
                      <p className="text-xs text-slate-500">You are not an owner of this account, so settings are read-only.</p>
                    )}
                  </section>
                )}

                <section className="space-y-3">
                  <h3 className="text-lg font-semibold">Past transactions</h3>
                  {isTransactionsLoading && <div className="card p-3 text-sm text-slate-500">Loading transactions...</div>}
                  {!isTransactionsLoading && !accountTransactions.length && (
                    <div className="card p-3 text-sm text-slate-500">No transactions yet for this account.</div>
                  )}
                  {!!accountTransactions.length && (
                    <ul className="card divide-y divide-slate-200 px-4">
                      {accountTransactions.slice(0, 25).map((transaction) => (
                        <li key={transaction.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                          <div>
                            <p className="font-medium text-slate-900">
                              {transaction.category?.name ?? (transaction.type === "transfer" ? "Transfer" : "Uncategorized")}
                            </p>
                            <p className="text-sm text-slate-600">{transaction.description || "No description"}</p>
                            <p className="text-xs text-slate-500">
                              {transaction.date ?? "No date"} · {transaction.member?.name ?? "Unassigned"}
                            </p>
                          </div>
                          <div className="sm:text-right">
                            <p
                              className={`font-semibold ${
                                transaction.type === "income"
                                  ? "text-emerald-700"
                                  : transaction.type === "expense"
                                    ? "text-red-600"
                                    : "text-slate-700"
                              }`}
                            >
                              {transaction.type === "income" ? "+" : transaction.type === "expense" ? "-" : ""}
                              {formatEur(Number(transaction.amount ?? 0))}
                            </p>
                            <p className="text-xs text-slate-500">
                              Saldo ap&oacute;s: {transaction.balance_after == null ? "-" : formatEur(transaction.balance_after)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            );
          })()}
        </EntityPopover>
      )}

      <AppDialog
        open={Boolean(editingAccount)}
        onClose={() => setEditingAccount(null)}
        title="Edit bank account"
        subtitle="Account settings"
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingAccount) return;
            void (async () => {
              await editAccount(editingAccount.id, editingAccountName, Number(editingAccountBalance));
              setEditingAccount(null);
            })();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Account name</span>
            <input
              className="input"
              value={editingAccountName}
              onChange={(event) => setEditingAccountName(event.target.value)}
              placeholder="Account name"
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Current balance</span>
            <input
              className="input"
              type="number"
              step="0.01"
              value={editingAccountBalance}
              onChange={(event) => setEditingAccountBalance(event.target.value)}
              required
            />
          </label>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingAccount(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={Boolean(adjustingAccount)}
        onClose={() => setAdjustingAccount(null)}
        title="Adjust balance"
        subtitle={adjustingAccount?.name ?? "Bank account"}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!adjustingAccount) return;
            void (async () => {
              await adjustBalance(adjustingAccount.id, Number(adjustBalanceValue));
              setAdjustingAccount(null);
            })();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">New current balance</span>
            <input
              className="input"
              type="number"
              step="0.01"
              value={adjustBalanceValue}
              onChange={(event) => setAdjustBalanceValue(event.target.value)}
              required
            />
          </label>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setAdjustingAccount(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Update balance
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingAccount)}
        title="Delete account"
        description={`Delete "${deletingAccount?.name ?? "this account"}"? This cannot be undone.`}
        confirmLabel="Delete account"
        destructive
        onClose={() => setDeletingAccount(null)}
        onConfirm={() => {
          if (!deletingAccount) return;
          void (async () => {
            const deleted = await deleteAccount(deletingAccount.id);
            if (deleted && activeAccountId === deletingAccount.id) setActiveAccountId(null);
            setDeletingAccount(null);
          })();
        }}
      />
    </div>
  );
}
