"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import { formatEur } from "@/lib/format";
import { resolveCategoryColor } from "@/lib/category-color";

export type FamilyMember = { id: string; name: string; user_id?: string | null };
export type BankAccount = { id: string; name: string; is_shared?: boolean; member_ids?: string[] };
export type Loan = { id: string; name: string; remaining_amount?: number | null };
export type Category = {
  id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  affects_loan?: boolean;
  color?: string | null;
};

type Step = "type" | "member" | "account" | "amount" | "category" | "review";

type Props = {
  familyId: string;
  members: FamilyMember[];
  accounts: BankAccount[];
  categories: Category[];
  loans: Loan[];
  currentUserId?: string | null;
  defaultAccountId?: string | null;
  categoryUsageCount?: Record<string, number>;
  onCreated?: () => void;
};

const todayIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const resolvePreferredAccountId = (accounts: BankAccount[], preferredId?: string | null) => {
  if (!accounts.length) return "";
  if (preferredId && accounts.some((account) => account.id === preferredId)) return preferredId;
  return accounts[0].id;
};
const resolvePreferredDestinationAccountId = (accounts: BankAccount[], sourceAccountId: string) => {
  const destination = accounts.find((account) => account.id !== sourceAccountId);
  return destination?.id ?? "";
};
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
const unique = (values: string[]) => Array.from(new Set(values));

export function TransactionWizard({
  familyId,
  members,
  accounts,
  categories,
  loans,
  currentUserId,
  defaultAccountId,
  categoryUsageCount = {},
  onCreated,
}: Props) {
  const [step, setStep] = useState<Step>("type");
  const [type, setType] = useState<"income" | "expense" | "transfer">("expense");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(members[0]?.id ? [members[0].id] : []);
  const [memberAmounts, setMemberAmounts] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState<string>(() => resolvePreferredAccountId(accounts, defaultAccountId));
  const [selectedIncomeAccountIds, setSelectedIncomeAccountIds] = useState<string[]>(() => {
    const preferred = resolvePreferredAccountId(accounts, defaultAccountId);
    return preferred ? [preferred] : [];
  });
  const [incomeAccountAmounts, setIncomeAccountAmounts] = useState<Record<string, string>>({});
  const [toAccountId, setToAccountId] = useState<string>(() =>
    resolvePreferredDestinationAccountId(accounts, resolvePreferredAccountId(accounts, defaultAccountId))
  );
  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState<string>(todayIso());
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id || "");
  const [loanId, setLoanId] = useState<string>("");
  const [otherDescription, setOtherDescription] = useState<string>("");
  const [descriptionNote, setDescriptionNote] = useState<string>("");
  const [applyToAllSharedMembers, setApplyToAllSharedMembers] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flowSteps: Step[] =
    type === "transfer"
      ? ["type", "account", "amount", "review"]
      : type === "expense"
        ? ["type", "account", "member", "amount", "category", "review"]
        : ["type", "account", "member", "amount", "category", "review"];

  const filteredCategories = useMemo(() => {
    const base = categories.filter((category) => category.type === type);
    if (type !== "expense") {
      return base.sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
    }
    return base.sort((a, b) => {
      const usageDelta = (categoryUsageCount[b.id] ?? 0) - (categoryUsageCount[a.id] ?? 0);
      if (usageDelta !== 0) return usageDelta;
      return a.name.localeCompare(b.name, "pt-PT");
    });
  }, [categories, type, categoryUsageCount]);
  const selectedCategory = useMemo(
    () => filteredCategories.find((category) => category.id === categoryId) ?? null,
    [filteredCategories, categoryId]
  );
  const hasInvalidTransferPair = type === "transfer" && !!accountId && !!toAccountId && accountId === toAccountId;
  const mustChooseLoan = type === "expense" && Boolean(selectedCategory?.affects_loan);
  const selectedIncomeAccounts = useMemo(
    () =>
      selectedIncomeAccountIds.length === 0
        ? accounts
        : accounts.filter((account) => selectedIncomeAccountIds.includes(account.id)),
    [accounts, selectedIncomeAccountIds]
  );
  const selectedExpenseAccount = accounts.find((account) => account.id === accountId) ?? null;
  const sharedExpenseMemberIds = useMemo(
    () =>
      unique(
        (selectedExpenseAccount?.member_ids ?? []).filter((memberId) =>
          members.some((member) => member.id === memberId)
        )
      ),
    [selectedExpenseAccount, members]
  );
  const expenseSelectableMembers = useMemo(() => {
    if (!sharedExpenseMemberIds.length) return members;
    return members.filter((member) => sharedExpenseMemberIds.includes(member.id));
  }, [members, sharedExpenseMemberIds]);
  const incomeSelectableMembers = useMemo(() => {
    const scopedSets = selectedIncomeAccounts
      .map((account) =>
        unique(
          (account.member_ids ?? []).filter((memberId) =>
            members.some((member) => member.id === memberId)
          )
        )
      )
      .filter((ids) => ids.length > 0);
    if (!scopedSets.length) return members;
    const intersection = scopedSets.reduce((current, ids) => current.filter((id) => ids.includes(id)));
    const effectiveIds = intersection.length ? intersection : scopedSets[0];
    return members.filter((member) => effectiveIds.includes(member.id));
  }, [members, selectedIncomeAccounts]);
  const selectableMembers = type === "income" ? incomeSelectableMembers : expenseSelectableMembers;
  const currentScopedMemberId = useMemo(
    () => selectableMembers.find((member) => member.user_id && member.user_id === currentUserId)?.id ?? "",
    [selectableMembers, currentUserId]
  );
  const preferredSelectableMemberId = currentScopedMemberId || selectableMembers[0]?.id || "";
  const canApplyAllSharedMembers =
    type === "expense" && Boolean(selectedExpenseAccount?.is_shared) && expenseSelectableMembers.length > 1;
  const applyAllMembersMode = canApplyAllSharedMembers && applyToAllSharedMembers;
  const hasIncomeMultiAccountMode = type === "income" && selectedIncomeAccounts.length > 1;

  useEffect(() => {
    if (!mustChooseLoan) {
      setLoanId("");
      return;
    }

    if (loanId && loans.some((loan) => loan.id === loanId)) return;
    if (loans.length === 1) {
      setLoanId(loans[0].id);
      return;
    }
    setLoanId("");
  }, [mustChooseLoan, loanId, loans]);

  useEffect(() => {
    if (type !== "transfer") return;
    setMemberAmounts({});
    setSelectedMemberIds([]);
  }, [type]);

  useEffect(() => {
    if (type !== "income") return;
    setMemberAmounts({});
    setSelectedMemberIds((current) => {
      const firstValid = current.find((id) => incomeSelectableMembers.some((member) => member.id === id));
      return firstValid ? [firstValid] : incomeSelectableMembers[0]?.id ? [incomeSelectableMembers[0].id] : [];
    });
  }, [type, incomeSelectableMembers]);

  useEffect(() => {
    if (!canApplyAllSharedMembers) {
      setApplyToAllSharedMembers(false);
      return;
    }
    setApplyToAllSharedMembers(true);
  }, [canApplyAllSharedMembers]);

  useEffect(() => {
    if (!applyAllMembersMode) return;
    setMemberAmounts({});
    setSelectedMemberIds(expenseSelectableMembers.map((member) => member.id));
  }, [applyAllMembersMode, expenseSelectableMembers]);

  useEffect(() => {
    if (type === "transfer" && step === "member") {
      setStep("account");
    }
  }, [type, step]);

  useEffect(() => {
    if (type === "transfer") return;
    const scopedIds = selectableMembers.map((member) => member.id);
    setSelectedMemberIds((current) => {
      const valid = current.filter((id) => scopedIds.includes(id));
      if (type === "income") {
        if (valid[0]) return [valid[0]];
        return preferredSelectableMemberId ? [preferredSelectableMemberId] : scopedIds[0] ? [scopedIds[0]] : [];
      }
      if (applyAllMembersMode) return scopedIds;
      if (valid.length) return valid;
      return preferredSelectableMemberId ? [preferredSelectableMemberId] : scopedIds[0] ? [scopedIds[0]] : [];
    });
  }, [type, selectableMembers, applyAllMembersMode, preferredSelectableMemberId]);

  useEffect(() => {
    setAccountId((current) => {
      if (current && accounts.some((account) => account.id === current)) return current;
      return resolvePreferredAccountId(accounts, defaultAccountId);
    });
  }, [accounts, defaultAccountId]);

  useEffect(() => {
    setSelectedIncomeAccountIds((current) => {
      const valid = current.filter((id) => accounts.some((account) => account.id === id));
      if (valid.length) return valid;
      const preferred = resolvePreferredAccountId(accounts, defaultAccountId);
      return preferred ? [preferred] : [];
    });
  }, [accounts, defaultAccountId]);

  useEffect(() => {
    setToAccountId((current) => {
      if (current && current !== accountId && accounts.some((account) => account.id === current)) return current;
      return resolvePreferredDestinationAccountId(accounts, accountId);
    });
  }, [accounts, accountId]);

  const next = () => {
    const idx = flowSteps.indexOf(step);
    if (idx < flowSteps.length - 1) setStep(flowSteps[idx + 1]);
  };
  const prev = () => {
    const idx = flowSteps.indexOf(step);
    if (idx > 0) setStep(flowSteps[idx - 1]);
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const expenseMemberIds = applyAllMembersMode
      ? expenseSelectableMembers.map((member) => member.id)
      : selectedMemberIds;
    const multiMemberMode = type === "expense" && !applyAllMembersMode && expenseMemberIds.length > 1;

    if (type === "income" && !selectedMemberIds.length) {
      setLoading(false);
      setError("Select at least one member.");
      return;
    }
    if (type === "expense" && !expenseMemberIds.length) {
      setLoading(false);
      setError("Select at least one member.");
      return;
    }

    if (!multiMemberMode && !hasIncomeMultiAccountMode) {
      const singleAmount = Number(amount);
      if (!Number.isFinite(singleAmount) || singleAmount <= 0) {
        setLoading(false);
        setError("Amount must be greater than zero.");
        return;
      }
    }
    if (type === "income" && !selectedIncomeAccounts.length) {
      setLoading(false);
      setError("Select at least one account.");
      return;
    }
    if (mustChooseLoan && !loanId) {
      setLoading(false);
      setError("Select which loan this expense should affect.");
      return;
    }
    const category = filteredCategories.find((c) => c.id === categoryId);
    const customOtherDescription =
      type !== "transfer" && (categoryId === "other" || category?.name === "Other") ? otherDescription.trim() : "";
    if (type !== "transfer" && (categoryId === "other" || category?.name === "Other") && !customOtherDescription) {
      setLoading(false);
      setError("Add a description for 'Other' category.");
      return;
    }
    const descriptionParts = [customOtherDescription, descriptionNote.trim()].filter(Boolean);
    const description = descriptionParts.length ? descriptionParts.join(" - ") : undefined;

    try {
      const headers = await getClientAuthHeaders();
      const baseBody = {
        familyId,
        bank_account_id: type === "income" ? selectedIncomeAccounts[0]?.id ?? accountId : accountId,
        to_bank_account_id: type === "transfer" ? toAccountId : undefined,
        type,
        category_id: type === "transfer" || categoryId === "other" ? null : categoryId,
        loan_id: type === "expense" && mustChooseLoan ? loanId : null,
        description,
        date,
      };

      if (type === "income" && selectedIncomeAccounts.length > 1) {
        const entries = selectedIncomeAccounts.map((account) => ({
          bank_account_id: account.id,
          amount: Number(incomeAccountAmounts[account.id] ?? 0),
        }));
        const invalidEntry = entries.find((entry) => !Number.isFinite(entry.amount) || entry.amount <= 0);
        if (invalidEntry) {
          setLoading(false);
          setError("Set a valid amount for each selected account.");
          return;
        }
        for (const entry of entries) {
          await fetchClientJson<{ transaction: { id: string } }>("/api/transactions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              ...baseBody,
              bank_account_id: entry.bank_account_id,
              assigned_to: selectedMemberIds[0] ?? null,
              member_ids: selectedMemberIds[0] ? [selectedMemberIds[0]] : [],
              amount: entry.amount,
            }),
          });
        }
      } else if (multiMemberMode) {
        const entries = expenseMemberIds.map((id) => ({
          assigned_to: id,
          amount: Number(memberAmounts[id] ?? 0),
        }));
        const invalidEntry = entries.find((entry) => !Number.isFinite(entry.amount) || entry.amount <= 0);
        if (invalidEntry) {
          setLoading(false);
          setError("Set a valid amount for each selected member.");
          return;
        }

        for (const entry of entries) {
          await fetchClientJson<{ transaction: { id: string } }>("/api/transactions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              ...baseBody,
              assigned_to: entry.assigned_to,
              member_ids: [entry.assigned_to],
              amount: entry.amount,
            }),
          });
        }
      } else {
        const singleMemberIds =
          type === "transfer"
            ? []
            : type === "expense"
              ? expenseMemberIds
              : selectedMemberIds[0]
                ? [selectedMemberIds[0]]
                : [];
        await fetchClientJson<{ transaction: { id: string } }>("/api/transactions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({
              ...baseBody,
              assigned_to: type === "transfer" ? null : singleMemberIds[0] ?? null,
              member_ids: singleMemberIds,
              amount: Number(amount || 0),
          }),
        });
      }

      onCreated?.();
      setAmount("");
      setMemberAmounts({});
      setIncomeAccountAmounts({});
      setSelectedMemberIds(members[0]?.id ? [members[0].id] : []);
      setSelectedIncomeAccountIds(() => {
        const preferred = resolvePreferredAccountId(accounts, defaultAccountId);
        return preferred ? [preferred] : [];
      });
      setOtherDescription("");
      setDescriptionNote("");
      setApplyToAllSharedMembers(true);
      setLoanId("");
      setDate(todayIso());
      setStep("type");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save transaction.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Add transaction</h3>
        <p className="text-sm text-slate-500">
          Step {Math.max(1, flowSteps.indexOf(step) + 1)} / {flowSteps.length}
        </p>
      </div>
      {step === "type" && (
        <div className="grid grid-cols-3 gap-2">
          {(["income", "expense", "transfer"] as Array<"income" | "expense" | "transfer">).map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                setStep("account");
              }}
              className={`btn ${type === t ? "btn-primary" : "btn-ghost"}`}
            >
              {t === "income" ? "IN" : t === "expense" ? "OUT" : "TRANSFER"}
            </button>
          ))}
        </div>
      )}

      {step === "member" && (
        <div className="space-y-2">
          {type === "transfer" ? (
            <>
              <p className="text-sm text-slate-500">Who is this for?</p>
              <p className="text-xs text-slate-500">Transfers are not assigned to members.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500">Who is this for?</p>
              {type === "expense" && canApplyAllSharedMembers ? (
                <div className="space-y-2">
                  <div className="rounded-xl border border-slate-200 p-1">
                    <div className="grid grid-cols-2 gap-1 text-sm">
                      <button
                        type="button"
                        className={`rounded-lg px-3 py-2 transition ${
                          applyToAllSharedMembers
                            ? "bg-emerald-500 text-emerald-950 font-semibold shadow-sm"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                        onClick={() => setApplyToAllSharedMembers(true)}
                      >
                        All members
                      </button>
                      <button
                        type="button"
                        className={`rounded-lg px-3 py-2 transition ${
                          !applyToAllSharedMembers
                            ? "bg-emerald-500 text-emerald-950 font-semibold shadow-sm"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                        onClick={() => {
                          setApplyToAllSharedMembers(false);
                          setSelectedMemberIds(preferredSelectableMemberId ? [preferredSelectableMemberId] : []);
                        }}
                      >
                        Choose members
                      </button>
                    </div>
                  </div>
                  {applyToAllSharedMembers ? (
                    <p className="text-xs text-slate-500">
                      One expense row will include {expenseSelectableMembers.length} members.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">
                        Select one or more members. If you select multiple members, you can set custom amounts in the next step.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {expenseSelectableMembers.map((member) => {
                          const selected = selectedMemberIds.includes(member.id);
                          return (
                            <button
                              key={member.id}
                              onClick={() =>
                                setSelectedMemberIds((current) => {
                                  if (current.includes(member.id)) {
                                    return current.filter((id) => id !== member.id);
                                  }
                                  return [...current, member.id];
                                })
                              }
                              className={`btn ${selected ? "btn-primary" : "btn-ghost"}`}
                            >
                              {member.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500">
                    {type === "income"
                      ? "Select one member for this income."
                      : "Select one or more members. If you select multiple members, you can set custom amounts in the next step."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectableMembers.map((member) => {
                      const selected = selectedMemberIds.includes(member.id);
                      return (
                        <button
                          key={member.id}
                          onClick={() =>
                            setSelectedMemberIds((current) => {
                              if (type === "income") return [member.id];
                              if (current.includes(member.id)) {
                                return current.filter((id) => id !== member.id);
                              }
                              return [...current, member.id];
                            })
                          }
                          className={`btn ${selected ? "btn-primary" : "btn-ghost"}`}
                        >
                          {member.name}
                        </button>
                      );
                    })}
                  </div>
                  {type !== "income" && selectableMembers.length > 1 && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="text-xs text-emerald-700 hover:underline"
                        onClick={() => setSelectedMemberIds(selectableMembers.map((member) => member.id))}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:underline"
                        onClick={() => setSelectedMemberIds([])}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </>
              )}
              {!selectableMembers.length && (
                <p className="text-xs text-amber-600">
                  No members have visibility to the selected account(s). Change account selection first.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {step === "account" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            {type === "income" ? "Select one or more accounts" : "Select account"}
          </p>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => {
              const selected = type === "income" ? selectedIncomeAccounts.some((account) => account.id === a.id) : accountId === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    if (type === "income") {
                      setSelectedIncomeAccountIds((current) =>
                        toggleMultiValue(
                          current,
                          a.id,
                          accounts.map((account) => account.id)
                        )
                      );
                      return;
                    }
                    setAccountId(a.id);
                  }}
                  className={`btn ${selected ? "btn-primary" : "btn-ghost"}`}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
          {type === "income" && accounts.length > 1 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="text-xs text-emerald-700 hover:underline"
                onClick={() => setSelectedIncomeAccountIds(accounts.map((account) => account.id))}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-xs text-slate-500 hover:underline"
                onClick={() => {
                  const preferred = resolvePreferredAccountId(accounts, defaultAccountId);
                  setSelectedIncomeAccountIds(preferred ? [preferred] : []);
                }}
              >
                Clear
              </button>
            </div>
          )}
          {type === "transfer" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Destination account</p>
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <button
                    key={`to-${a.id}`}
                    onClick={() => setToAccountId(a.id)}
                    className={`btn ${toAccountId === a.id ? "btn-primary" : "btn-ghost"}`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              {hasInvalidTransferPair && (
                <p className="text-xs text-red-600">Source and destination must be different accounts.</p>
              )}
            </div>
          )}
        </div>
      )}

      {step === "amount" && (
        <div className="space-y-2">
          {!((type === "expense" && !applyAllMembersMode && selectedMemberIds.length > 1) || hasIncomeMultiAccountMode) && (
            <>
              <p className="text-sm text-slate-500">Amount</p>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                placeholder="0.00"
              />
              <p className="text-xs text-slate-500">{amount ? formatEur(Number(amount)) : ""}</p>
            </>
          )}
          {hasIncomeMultiAccountMode && (
            <>
              <p className="text-sm text-slate-500">Amounts by account</p>
              <div className="space-y-2">
                {selectedIncomeAccounts.map((account) => (
                  <label
                    key={account.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <span className="text-sm text-slate-700">{account.name}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      className="input w-36"
                      value={incomeAccountAmounts[account.id] ?? ""}
                      placeholder="0.00"
                      onChange={(event) =>
                        setIncomeAccountAmounts((current) => ({
                          ...current,
                          [account.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Total:{" "}
                {formatEur(
                  selectedIncomeAccounts.reduce((sum, account) => {
                    const value = incomeAccountAmounts[account.id] ?? "";
                    const parsed = Number(value);
                    return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
                  }, 0)
                )}
              </p>
            </>
          )}
          <div className="space-y-1">
            <p className="text-sm text-slate-500">Date</p>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          {type === "expense" && !applyAllMembersMode && selectedMemberIds.length > 1 && (
            <>
              <p className="text-sm text-slate-500">Member amounts</p>
              <div className="space-y-2">
                {selectedMemberIds
                  .map((memberId) => members.find((member) => member.id === memberId))
                  .filter((member): member is FamilyMember => Boolean(member))
                  .map((member) => (
                  <label
                    key={member.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <span className="text-sm text-slate-700">{member.name}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      className="input w-36"
                      value={memberAmounts[member.id] ?? ""}
                      placeholder="0.00"
                      onChange={(event) =>
                        setMemberAmounts((current) => ({
                          ...current,
                          [member.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Total:{" "}
                {formatEur(
                  selectedMemberIds.reduce((sum, memberId) => {
                    const value = memberAmounts[memberId] ?? "";
                    const parsed = Number(value);
                    return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
                  }, 0)
                )}
              </p>
            </>
          )}
        </div>
      )}

      {step === "category" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Category</p>
          <div className="flex flex-wrap gap-2">
            {filteredCategories.map((c) => {
              const categoryColor = resolveCategoryColor(c.color, c.name);
              return (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  categoryId === c.id
                    ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: categoryColor }}
                  aria-hidden="true"
                />
                {c.name}
                {c.affects_loan ? " · loan" : ""}
              </button>
              );
            })}
            <button
              onClick={() => {
                setCategoryId("other");
              }}
              className={`btn ${categoryId === "other" ? "btn-primary" : "btn-ghost"}`}
            >
              Other
            </button>
          </div>
          {categoryId === "other" && (
            <input
              className="input"
              placeholder="Describe this category"
              value={otherDescription}
              onChange={(e) => setOtherDescription(e.target.value)}
            />
          )}
          {mustChooseLoan && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Which loan should this expense affect?</p>
              <div className="flex flex-wrap gap-2">
                {loans.map((loan) => (
                  <button
                    key={loan.id}
                    onClick={() => setLoanId(loan.id)}
                    className={`btn ${loanId === loan.id ? "btn-primary" : "btn-ghost"}`}
                  >
                    {loan.name}
                  </button>
                ))}
              </div>
              {loans.length > 1 && !loanId && (
                <p className="text-xs text-amber-700">Pick one loan before saving.</p>
              )}
              {!loans.length && <p className="text-xs text-red-600">No loans available in this family.</p>}
            </div>
          )}
        </div>
      )}

      {step === "review" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Review and optional note</p>
          <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 space-y-1">
            <p>Type: {type}</p>
            <p>Date: {date || "-"}</p>
            <p>
              Amount:{" "}
              {type === "income" && hasIncomeMultiAccountMode
                ? formatEur(
                    selectedIncomeAccounts.reduce((sum, account) => {
                      const value = incomeAccountAmounts[account.id] ?? "";
                      const parsed = Number(value);
                      return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
                    }, 0)
                  )
                : type === "expense" && !applyAllMembersMode && selectedMemberIds.length > 1
                ? formatEur(
                    selectedMemberIds.reduce((sum, memberId) => {
                      const value = memberAmounts[memberId] ?? "";
                      const parsed = Number(value);
                      return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
                    }, 0)
                  )
                : formatEur(Number(amount || 0))}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-slate-500">Description (optional)</p>
            <input
              className="input"
              placeholder="Add a note for this transaction"
              value={descriptionNote}
              onChange={(event) => setDescriptionNote(event.target.value)}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <button onClick={prev} className="btn btn-ghost" disabled={step === flowSteps[0]}>
          Back
        </button>
        {step === flowSteps[flowSteps.length - 1] ? (
          <button onClick={submit} disabled={loading} className="btn btn-primary">
            {loading ? "Saving..." : "Save"}
          </button>
        ) : (
          <button
            onClick={next}
            className="btn btn-primary"
            disabled={
              (step === "member" &&
                type === "income" &&
                !selectedMemberIds.length) ||
              (step === "member" &&
                type === "expense" &&
                !applyAllMembersMode &&
                !selectedMemberIds.length) ||
              (step === "account" && hasInvalidTransferPair) ||
              (step === "category" &&
                type !== "transfer" &&
                categoryId === "other" &&
                !otherDescription.trim())
            }
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
