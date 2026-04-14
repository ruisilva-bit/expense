"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { PrettySelect } from "@/components/PrettySelect";
import { useAppState } from "@/context/AppState";
import { resolveCategoryColor } from "@/lib/category-color";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import { formatEur } from "@/lib/format";

type TxnType = "income" | "expense" | "transfer";
type Member = { id: string; name: string };
type Account = { id: string; name: string; is_shared?: boolean; member_ids?: string[] };
type Category = { id: string; name: string; type: TxnType; affects_loan?: boolean; color?: string | null };
type Transaction = {
  id: string;
  bank_account_id: string;
  assigned_to: string | null;
  member_ids?: string[];
  member_label?: string | null;
  amount: number;
  type: TxnType;
  transfer_side?: "source" | "dest" | null;
  category_id: string | null;
  description: string | null;
  date: string | null;
  member?: { id: string; name: string } | null;
  bank_account?: { id: string; name: string } | null;
  category?: { id: string; name: string; type: string; affects_loan?: boolean; color?: string | null } | null;
  loan?: { id: string; name: string } | null;
};

type TransactionsPayload = {
  transactions: Transaction[];
  members: Member[];
  accounts: Account[];
  categories: Category[];
  loans: Array<{ id: string; name: string }>;
};

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const toggleMultiValue = (current: string[], value: string, allValues: string[]) => {
  if (!allValues.length) return [];
  const allMode = current.length === 0;
  const nextSet = new Set(allMode ? allValues : current);
  if (nextSet.has(value)) {
    nextSet.delete(value);
  } else {
    nextSet.add(value);
  }
  if (nextSet.size === 0 || nextSet.size === allValues.length) return [];
  return allValues.filter((id) => nextSet.has(id));
};

const buildQuery = ({
  familyId,
  accountId,
  memberId,
  categoryId,
  dateFrom,
  dateTo,
}: {
  familyId: string;
  accountId?: string;
  memberId?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
}) => {
  const params = new URLSearchParams();
  params.set("familyId", familyId);
  params.set("page", "1");
  params.set("pageSize", "200");
  if (accountId) params.set("accountId", accountId);
  if (memberId) params.set("memberId", memberId);
  if (categoryId) params.set("categoryId", categoryId);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  return params.toString();
};

const exportTransactionsToXls = (transactions: Transaction[]) => {
  const headers = ["Date", "Type", "Category", "Member", "Account", "Amount", "Description", "Loan"];
  const rows = transactions.map((transaction) => [
    transaction.date ?? "",
    transaction.type,
    transaction.category?.name ?? (transaction.type === "transfer" ? "Transfer" : "Uncategorized"),
    transaction.member?.name ?? "Unassigned",
    transaction.bank_account?.name ?? "",
    transaction.amount.toFixed(2),
    transaction.description ?? "",
    transaction.loan?.name ?? "",
  ]);

  const escapeCell = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const html = `
    <table>
      <thead>
        <tr>${headers.map((header) => `<th>${escapeCell(header)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeCell(cell)}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;

  const blob = new Blob([`\ufeff${html}`], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `transactions-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default function TransactionsPage() {
  const { selectedFamily, selectedAccount } = useAppState();
  const [filterAccountId, setFilterAccountId] = useState("");
  const [filterMemberId, setFilterMemberId] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editingAmount, setEditingAmount] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingDate, setEditingDate] = useState(new Date().toISOString().slice(0, 10));
  const [editingAccountId, setEditingAccountId] = useState("");
  const [editingAssignedTo, setEditingAssignedTo] = useState("");
  const [editingMemberIds, setEditingMemberIds] = useState<string[]>([]);
  const [editingApplyAllMembers, setEditingApplyAllMembers] = useState(false);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);

  useEffect(() => {
    const next = !selectedFamily?.id ? "" : selectedAccount?.id ?? "";
    queueMicrotask(() => {
      setFilterAccountId(next);
    });
  }, [selectedFamily?.id, selectedAccount?.id]);

  const query = useMemo(() => {
    if (!selectedFamily) return null;
    return buildQuery({
      familyId: selectedFamily.id,
      accountId: filterAccountId || undefined,
      memberId: filterMemberId || undefined,
      categoryId: filterCategoryId || undefined,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
    });
  }, [selectedFamily, filterAccountId, filterMemberId, filterCategoryId, filterDateFrom, filterDateTo]);

  const { data, error, mutate, isLoading } = useSWR(
    query ? `transactions:${query}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      return fetchClientJson<TransactionsPayload>(`/api/transactions?${query}`, {
        method: "GET",
        headers,
      });
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const accountOptions = useMemo(
    () => [
      { value: "", label: "All accounts" },
      ...(data?.accounts ?? []).map((account) => ({ value: account.id, label: account.name })),
    ],
    [data?.accounts]
  );
  const memberOptions = useMemo(
    () => [
      { value: "", label: "All members" },
      ...(data?.members ?? []).map((member) => ({ value: member.id, label: member.name })),
    ],
    [data?.members]
  );
  const categoryOptions = useMemo(
    () => [
      { value: "", label: "All categories" },
      ...(data?.categories ?? []).map((category) => ({
        value: category.id,
        label: category.name,
        color: resolveCategoryColor(category.color, category.name),
      })),
    ],
    [data?.categories]
  );
  const editAccountOptions = useMemo(
    () => (data?.accounts ?? []).map((account) => ({ value: account.id, label: account.name })),
    [data?.accounts]
  );
  const selectedEditingAccount = useMemo(
    () => (data?.accounts ?? []).find((account) => account.id === editingAccountId) ?? null,
    [data?.accounts, editingAccountId]
  );
  const sharedEditingMemberIds = useMemo(
    () =>
      Array.from(
        new Set(
          (selectedEditingAccount?.member_ids ?? []).filter((memberId) =>
            (data?.members ?? []).some((member) => member.id === memberId)
          )
        )
      ),
    [selectedEditingAccount, data?.members]
  );
  const editingMembersPool = useMemo(() => {
    const allMembers = data?.members ?? [];
    const byId = new Map(allMembers.map((member) => [member.id, member]));
    if (selectedEditingAccount?.is_shared) {
      const scoped = sharedEditingMemberIds
        .map((memberId) => byId.get(memberId))
        .filter((member): member is Member => Boolean(member));
      if (scoped.length) return scoped;
    }
    return allMembers;
  }, [data?.members, selectedEditingAccount?.is_shared, sharedEditingMemberIds]);
  const editMemberOptions = useMemo(
    () => editingMembersPool.map((member) => ({ value: member.id, label: member.name })),
    [editingMembersPool]
  );
  const canApplyAllMembersOnEdit =
    Boolean(selectedEditingAccount?.is_shared) && sharedEditingMemberIds.length > 1;
  const isEditingTransfer = editingTransaction?.type === "transfer";
  const isEditingExpense = editingTransaction?.type === "expense";

  useEffect(() => {
    if (!editingTransaction || isEditingTransfer) return;
    if (!editingMembersPool.length) return;
    if (canApplyAllMembersOnEdit && editingApplyAllMembers) {
      const nextIds = sharedEditingMemberIds;
      const nextAssigned = sharedEditingMemberIds[0] ?? editingMembersPool[0].id;
      if (!sameIds(editingMemberIds, nextIds)) setEditingMemberIds(nextIds);
      if (editingAssignedTo !== nextAssigned) setEditingAssignedTo(nextAssigned);
      return;
    }

    const validSelected = editingMemberIds.filter((memberId) =>
      editingMembersPool.some((member) => member.id === memberId)
    );
    const fallback =
      validSelected[0] ??
      editingMembersPool.find((member) => member.id === editingAssignedTo)?.id ??
      editingMembersPool[0].id;
    const nextIds = validSelected.length ? validSelected : [fallback];
    if (!sameIds(editingMemberIds, nextIds)) setEditingMemberIds(nextIds);
    if (editingAssignedTo !== fallback) setEditingAssignedTo(fallback);
  }, [
    editingTransaction,
    isEditingTransfer,
    editingMembersPool,
    canApplyAllMembersOnEdit,
    editingApplyAllMembers,
    sharedEditingMemberIds,
    editingMemberIds,
    editingAssignedTo,
  ]);

  const editTransaction = async (
    transactionId: string,
    nextAmount: number,
    nextDescription: string,
    nextDate: string,
    nextAccountId: string,
    nextAssignedMemberId: string,
    nextMemberIds: string[]
  ) => {
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ transaction: Transaction }>("/api/transactions", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          transactionId,
          amount: nextAmount,
          description: nextDescription || null,
          date: nextDate,
          bank_account_id: nextAccountId,
          assigned_to: nextAssignedMemberId || null,
          member_ids: nextMemberIds,
        }),
      });
      await mutate();
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : "Failed to update transaction.");
    }
  };

  const deleteTransaction = async (transactionId: string) => {
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ success: true }>("/api/transactions", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ transactionId }),
      });
      await mutate();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "Failed to delete transaction.");
    }
  };

  if (!selectedFamily) {
    return (
      <div className="min-h-screen">
        <AppNav />
        <main className="p-6 lg:pl-64">Select a family first.</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6 lg:pl-64">
        <div>
          <p className="text-sm text-slate-500">Activity</p>
          <h1 className="text-2xl font-semibold">{selectedFamily.name}</h1>
        </div>

        {(error || actionError) && (
          <div className="card p-3 text-sm text-red-700 bg-red-50 border-red-200">
            {error ? `Could not load transactions: ${error.message}` : actionError}
          </div>
        )}

        <section className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Activity list</h2>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard" className="btn btn-ghost">
                Add from dashboard
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => exportTransactionsToXls(data?.transactions ?? [])}
                disabled={!data?.transactions?.length}
              >
                Export .xls
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <PrettySelect
              value={filterAccountId}
              onChange={setFilterAccountId}
              options={accountOptions}
              placeholder="All accounts"
            />
            <PrettySelect
              value={filterMemberId}
              onChange={setFilterMemberId}
              options={memberOptions}
              placeholder="All members"
            />
            <PrettySelect
              value={filterCategoryId}
              onChange={setFilterCategoryId}
              options={categoryOptions}
              placeholder="All categories"
            />
            <input className="input" type="date" value={filterDateFrom} onChange={(event) => setFilterDateFrom(event.target.value)} />
            <input className="input" type="date" value={filterDateTo} onChange={(event) => setFilterDateTo(event.target.value)} />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setFilterAccountId("");
                setFilterMemberId("");
                setFilterCategoryId("");
                setFilterDateFrom("");
                setFilterDateTo("");
              }}
            >
              Clear filters
            </button>
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent activity</h2>
          </div>
          {isLoading && <p className="text-sm text-slate-500">Loading transactions...</p>}
          {!isLoading && !(data?.transactions ?? []).length && (
            <p className="text-sm text-slate-500">No transactions yet.</p>
          )}
          <ul className="divide-y divide-slate-200">
            {(data?.transactions ?? []).map((transaction) => {
              const categoryName =
                transaction.category?.name ?? (transaction.type === "transfer" ? "Transfer" : "Uncategorized");
              const categoryColor = resolveCategoryColor(transaction.category?.color, categoryName);
              return (
                <li key={transaction.id} className="py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: categoryColor }} />
                      {categoryName}
                    </p>
                    <p className="text-sm text-slate-600">{transaction.description || "No description"}</p>
                    <p className="text-xs text-slate-500">
                      {transaction.date} · {transaction.bank_account?.name} · {transaction.member?.name ?? "Unassigned"}
                    </p>
                    {transaction.loan?.name && (
                      <p className="text-xs text-amber-700">Affects loan: {transaction.loan.name}</p>
                    )}
                  </div>
                  <div className="space-y-2 sm:text-right">
                    <p
                      className={`font-semibold ${
                        transaction.type === "income"
                          ? "text-emerald-700"
                          : transaction.type === "expense"
                            ? "text-red-600"
                            : "text-slate-700"
                      }`}
                    >
                      {transaction.type === "income"
                        ? "+"
                        : transaction.type === "expense"
                          ? "-"
                          : "↔ "}
                      {formatEur(transaction.amount)}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={() => {
                          const allMemberIds = unique((data?.members ?? []).map((member) => member.id));
                          const account = (data?.accounts ?? []).find(
                            (item) => item.id === transaction.bank_account_id
                          );
                          const accountMemberIds = unique(
                            (account?.member_ids ?? []).filter((memberId) => allMemberIds.includes(memberId))
                          );
                          const rowMemberIds = unique(
                            (transaction.member_ids ??
                              (transaction.assigned_to ? [transaction.assigned_to] : []))
                              .filter((memberId) => allMemberIds.includes(memberId))
                          );
                          const isAllSharedMembers =
                            Boolean(account?.is_shared) &&
                            accountMemberIds.length > 1 &&
                            rowMemberIds.length === accountMemberIds.length &&
                            accountMemberIds.every((memberId) => rowMemberIds.includes(memberId));
                          const initialMemberIds = isAllSharedMembers ? accountMemberIds : rowMemberIds;

                          setEditingTransaction(transaction);
                          setEditingAmount(String(transaction.amount));
                          setEditingDescription(transaction.description ?? "");
                          setEditingDate(transaction.date ?? new Date().toISOString().slice(0, 10));
                          setEditingAccountId(transaction.bank_account_id ?? "");
                          setEditingApplyAllMembers(isAllSharedMembers);
                          setEditingMemberIds(initialMemberIds);
                          setEditingAssignedTo(
                            initialMemberIds[0] ??
                              transaction.assigned_to ??
                              (data?.members ?? [])[0]?.id ??
                              accountMemberIds[0] ??
                              ""
                          );
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs text-red-600"
                        onClick={() => {
                          setDeletingTransactionId(transaction.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </main>

      <AppDialog
        open={Boolean(editingTransaction)}
        onClose={() => {
          setEditingTransaction(null);
          setEditingMemberIds([]);
          setEditingApplyAllMembers(false);
        }}
        title="Edit transaction"
        subtitle={editingTransaction?.category?.name ?? editingTransaction?.type ?? "Transaction"}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingTransaction) return;
            if (!editingAccountId) {
              setActionError("Select an account.");
              return;
            }
            const memberIdsForSave = (() => {
              if (!editingTransaction || isEditingTransfer) return [];
              if (canApplyAllMembersOnEdit && editingApplyAllMembers) return sharedEditingMemberIds;
              if (editingMemberIds.length) return editingMemberIds;
              return editingAssignedTo ? [editingAssignedTo] : [];
            })();
            const assignedMemberForSave = memberIdsForSave[0] ?? editingAssignedTo;
            if (!isEditingTransfer && !memberIdsForSave.length && !assignedMemberForSave) {
              setActionError("Select at least one member.");
              return;
            }
            void (async () => {
              await editTransaction(
                editingTransaction.id,
                Number(editingAmount),
                editingDescription,
                editingDate,
                editingAccountId,
                assignedMemberForSave,
                memberIdsForSave
              );
              setEditingTransaction(null);
            })();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Account</span>
            <PrettySelect
              value={editingAccountId}
              onChange={(nextAccountId) => {
                setEditingAccountId(nextAccountId);
                const account = (data?.accounts ?? []).find((item) => item.id === nextAccountId);
                const memberIds = unique((data?.members ?? []).map((member) => member.id));
                const accountMemberIds = unique(
                  (account?.member_ids ?? []).filter((memberId) => memberIds.includes(memberId))
                );
                const isSharedWithMany = Boolean(account?.is_shared) && accountMemberIds.length > 1;
                if (isSharedWithMany && editingApplyAllMembers) {
                  setEditingMemberIds(accountMemberIds);
                  setEditingAssignedTo(accountMemberIds[0] ?? "");
                  return;
                }
                if (!isSharedWithMany) {
                  setEditingApplyAllMembers(false);
                }
                const allowedMemberIds = isSharedWithMany ? accountMemberIds : memberIds;
                const kept = editingMemberIds.filter((memberId) => allowedMemberIds.includes(memberId));
                const fallback = kept[0] ?? (allowedMemberIds.includes(editingAssignedTo) ? editingAssignedTo : "");
                setEditingMemberIds(kept);
                setEditingAssignedTo(fallback || allowedMemberIds[0] || "");
              }}
              options={editAccountOptions}
              placeholder="Select account"
            />
          </label>
          {!isEditingTransfer && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-600">Member</span>
              {canApplyAllMembersOnEdit && (
                <div className="rounded-xl border border-slate-200 p-1">
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    <button
                      type="button"
                      className={`rounded-lg px-3 py-2 transition ${
                        editingApplyAllMembers
                          ? "bg-emerald-500 text-emerald-950 font-semibold shadow-sm"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                      onClick={() => {
                        setEditingApplyAllMembers(true);
                        setEditingMemberIds(sharedEditingMemberIds);
                        setEditingAssignedTo(sharedEditingMemberIds[0] ?? editingMembersPool[0]?.id ?? "");
                      }}
                    >
                      All members
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg px-3 py-2 transition ${
                        !editingApplyAllMembers
                          ? "bg-emerald-500 text-emerald-950 font-semibold shadow-sm"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                      onClick={() => {
                        setEditingApplyAllMembers(false);
                        const fallback = editingMembersPool[0]?.id ?? "";
                        setEditingMemberIds(fallback ? [fallback] : []);
                        setEditingAssignedTo(fallback);
                      }}
                    >
                      Choose members
                    </button>
                  </div>
                </div>
              )}
              {canApplyAllMembersOnEdit && editingApplyAllMembers ? (
                <p className="text-xs text-slate-500">
                  This transaction will include {sharedEditingMemberIds.length} members in one row.
                </p>
              ) : canApplyAllMembersOnEdit && !editingApplyAllMembers ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">Choose one or more members from this shared account.</p>
                  <div className="flex flex-wrap gap-2">
                    {editingMembersPool.map((member) => {
                      const selected = editingMemberIds.includes(member.id);
                      return (
                        <button
                          key={member.id}
                          type="button"
                          className={`btn ${selected ? "btn-primary" : "btn-ghost"}`}
                          onClick={() => {
                            setEditingMemberIds((current) => {
                              const scope = sharedEditingMemberIds.length
                                ? sharedEditingMemberIds
                                : editingMembersPool.map((item) => item.id);
                              const next = toggleMultiValue(current, member.id, scope);
                              const normalized = next.length ? next : isEditingExpense ? [member.id] : [];
                              setEditingAssignedTo(normalized[0] ?? "");
                              return normalized;
                            });
                          }}
                        >
                          {member.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <PrettySelect
                  value={editingAssignedTo}
                  onChange={(memberId) => {
                    setEditingAssignedTo(memberId);
                    setEditingMemberIds(memberId ? [memberId] : editingMemberIds);
                  }}
                  options={editMemberOptions}
                  placeholder="Select member"
                />
              )}
            </div>
          )}
          {isEditingTransfer && <p className="text-xs text-slate-500">Transfers are not assigned to members.</p>}
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Amount</span>
            <input
              className="input"
              type="number"
              step="0.01"
              value={editingAmount}
              onChange={(event) => setEditingAmount(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Date</span>
            <input
              className="input"
              type="date"
              value={editingDate}
              onChange={(event) => setEditingDate(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Description</span>
            <input
              className="input"
              value={editingDescription}
              onChange={(event) => setEditingDescription(event.target.value)}
              placeholder="Description"
            />
          </label>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingTransaction(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingTransactionId)}
        title="Delete transaction"
        description="Delete this transaction? This cannot be undone."
        confirmLabel="Delete transaction"
        destructive
        onClose={() => setDeletingTransactionId(null)}
        onConfirm={() => {
          if (!deletingTransactionId) return;
          void (async () => {
            await deleteTransaction(deletingTransactionId);
            setDeletingTransactionId(null);
          })();
        }}
      />
    </div>
  );
}
