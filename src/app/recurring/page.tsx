"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { PrettySelect } from "@/components/PrettySelect";
import { useAppState } from "@/context/AppState";
import { resolveCategoryColor } from "@/lib/category-color";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import { formatEur } from "@/lib/format";

type Member = { id: string; name: string };
type Account = { id: string; name: string; is_shared?: boolean; member_ids?: string[] };
type Category = { id: string; name: string; color?: string | null };
type RecurringRow = {
  id: string;
  bank_account_id: string;
  assigned_to: string | null;
  amount: number;
  category_id: string | null;
  frequency: string;
  next_execution_date: string;
  description: string | null;
  member_name?: string | null;
  account_name?: string | null;
  category_name?: string | null;
};

type RecurringPayload = {
  recurring: RecurringRow[];
  members: Member[];
  accounts: Account[];
  categories: Category[];
};

type FrequencyUnit = "day" | "week" | "month" | "year";

const encodeFrequency = (interval: number, unit: FrequencyUnit) => `every:${Math.max(1, interval)}:${unit}`;

const parseFrequency = (frequency: string | null | undefined): { interval: number; unit: FrequencyUnit } => {
  const raw = (frequency ?? "").trim().toLowerCase();
  const modern = raw.match(/^every:(\d+):(day|days|week|weeks|month|months|year|years)$/);
  if (modern) {
    const interval = Math.max(1, Number(modern[1] ?? 1));
    const unitRaw = modern[2] ?? "month";
    const unit = (unitRaw.endsWith("s") ? unitRaw.slice(0, -1) : unitRaw) as FrequencyUnit;
    return { interval, unit };
  }
  if (raw === "daily") return { interval: 1, unit: "day" };
  if (raw === "weekly") return { interval: 1, unit: "week" };
  if (raw === "monthly") return { interval: 1, unit: "month" };
  if (raw === "quarterly") return { interval: 3, unit: "month" };
  if (raw === "yearly") return { interval: 1, unit: "year" };
  return { interval: 1, unit: "month" };
};
const unique = (values: string[]) => Array.from(new Set(values));

const frequencyLabel = (frequency: string | null | undefined) => {
  const parsed = parseFrequency(frequency);
  return `Every ${parsed.interval} ${parsed.unit}${parsed.interval > 1 ? "s" : ""}`;
};

export default function RecurringPage() {
  const { selectedFamily, selectedAccount, accounts: contextAccounts } = useAppState();
  const [accountId, setAccountId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [applyToAllSharedMembers, setApplyToAllSharedMembers] = useState(true);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [everyInterval, setEveryInterval] = useState("1");
  const [everyUnit, setEveryUnit] = useState<FrequencyUnit>("month");
  const [nextDate, setNextDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState<RecurringRow | null>(null);
  const [editingAmount, setEditingAmount] = useState("");
  const [editingInterval, setEditingInterval] = useState("1");
  const [editingUnit, setEditingUnit] = useState<FrequencyUnit>("month");
  const [editingDate, setEditingDate] = useState(new Date().toISOString().slice(0, 10));
  const [editingDescription, setEditingDescription] = useState("");
  const [deletingRecurringId, setDeletingRecurringId] = useState<string | null>(null);
  const [didInitAccountPreset, setDidInitAccountPreset] = useState(false);

  const { data, error, mutate, isLoading } = useSWR(
    selectedFamily ? `recurring:${selectedFamily.id}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      return fetchClientJson<RecurringPayload>(
        `/api/recurring-transactions?familyId=${encodeURIComponent(selectedFamily!.id)}`,
        { method: "GET", headers }
      );
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const accountOptions: Account[] =
    data?.accounts ??
    contextAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      is_shared: false,
      member_ids: [],
    }));
  const categoryColorById = new Map(
    (data?.categories ?? []).map((category) => {
      return [category.id, resolveCategoryColor(category.color, category.name)];
    })
  );
  const accountSelectOptions = [
    { value: "", label: "Choose account" },
    ...accountOptions.map((account) => ({ value: account.id, label: account.name })),
  ];
  const categorySelectOptions = [
    { value: "", label: "No category" },
    ...(data?.categories ?? []).map((category) => ({
      value: category.id,
      label: category.name,
      color: categoryColorById.get(category.id) ?? null,
    })),
  ];
  const frequencyUnitOptions = [
    { value: "day", label: "Day(s)" },
    { value: "week", label: "Week(s)" },
    { value: "month", label: "Month(s)" },
    { value: "year", label: "Year(s)" },
  ];

  useEffect(() => {
    setDidInitAccountPreset(false);
  }, [selectedFamily?.id]);

  useEffect(() => {
    if (didInitAccountPreset) return;
    if (!accountOptions.length) return;

    const preferred = selectedAccount?.id && accountOptions.some((account) => account.id === selectedAccount.id)
      ? selectedAccount.id
      : accountOptions[0].id;

    setAccountId(preferred);
    setDidInitAccountPreset(true);
  }, [didInitAccountPreset, accountOptions, selectedAccount?.id]);

  const selectedRecurringAccount = accountOptions.find((account) => account.id === accountId) ?? null;
  const sharedRecurringMemberIds = useMemo(
    () =>
      unique(
        (selectedRecurringAccount?.member_ids ?? []).filter((memberValue) =>
          (data?.members ?? []).some((member) => member.id === memberValue)
        )
      ),
    [selectedRecurringAccount, data?.members]
  );
  const selectableRecurringMembers = useMemo(() => {
    if (!sharedRecurringMemberIds.length) return data?.members ?? [];
    return (data?.members ?? []).filter((member) => sharedRecurringMemberIds.includes(member.id));
  }, [data?.members, sharedRecurringMemberIds]);
  const memberSelectOptions = selectableRecurringMembers.map((member) => ({ value: member.id, label: member.name }));
  const canApplyAllSharedMembers =
    Boolean(selectedRecurringAccount?.is_shared) && selectableRecurringMembers.length > 1;

  useEffect(() => {
    if (!canApplyAllSharedMembers) {
      setApplyToAllSharedMembers(false);
      return;
    }
    setApplyToAllSharedMembers(true);
  }, [canApplyAllSharedMembers, accountId]);

  useEffect(() => {
    if (!selectableRecurringMembers.length) return;
    if (selectableRecurringMembers.some((member) => member.id === memberId)) return;
    setMemberId(selectableRecurringMembers[0].id);
  }, [selectableRecurringMembers, memberId]);

  const createRecurring = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedFamily) return;
    if (!accountId || !amount) return;
    const effectiveMemberId =
      canApplyAllSharedMembers && applyToAllSharedMembers
        ? selectableRecurringMembers[0]?.id ?? ""
        : memberId;
    if (!effectiveMemberId) {
      setErrorMessage("Select a member.");
      return;
    }

    setErrorMessage(null);
    setIsSaving(true);
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ recurring: RecurringRow }>("/api/recurring-transactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          familyId: selectedFamily.id,
          bank_account_id: accountId,
          assigned_to: effectiveMemberId,
          member_ids:
            canApplyAllSharedMembers && applyToAllSharedMembers
              ? selectableRecurringMembers.map((member) => member.id)
              : [effectiveMemberId],
          amount: Number(amount),
          category_id: categoryId || null,
          frequency: encodeFrequency(Number(everyInterval), everyUnit),
          next_execution_date: nextDate,
          description: description || null,
        }),
      });
      setAmount("");
      setDescription("");
      setEveryInterval("1");
      setEveryUnit("month");
      await mutate();
    } catch (createError) {
      setErrorMessage(createError instanceof Error ? createError.message : "Failed to create recurring transaction.");
    } finally {
      setIsSaving(false);
    }
  };

  const editRecurring = async (
    recurringId: string,
    amountValue: number,
    interval: number,
    unit: FrequencyUnit,
    dateValue: string,
    descriptionValue: string
  ) => {
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ recurring: RecurringRow }>("/api/recurring-transactions", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          recurringId,
          amount: amountValue,
          frequency: encodeFrequency(interval, unit),
          next_execution_date: dateValue,
          description: descriptionValue || null,
        }),
      });
      await mutate();
    } catch (updateError) {
      setErrorMessage(updateError instanceof Error ? updateError.message : "Failed to update recurring transaction.");
    }
  };

  const deleteRecurring = async (id: string) => {
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ success: true }>("/api/recurring-transactions", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ recurringId: id }),
      });
      await mutate();
    } catch (deleteError) {
      setErrorMessage(deleteError instanceof Error ? deleteError.message : "Failed to delete recurring transaction.");
    }
  };

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6 lg:pl-64">
        <div>
          <p className="text-sm text-slate-500">Recurring</p>
          <h1 className="text-2xl font-semibold">{selectedFamily ? "Recurring expenses" : "Select a family"}</h1>
        </div>

        {(error || errorMessage) && (
          <div className="card p-3 text-sm text-red-700 bg-red-50 border-red-200">
            {error ? `Could not load recurring transactions: ${error.message}` : errorMessage}
          </div>
        )}

        {!selectedFamily && <div className="card p-4">Select a family first.</div>}

        {selectedFamily && (
          <>
            {accountOptions.length > 0 ? (
              <form onSubmit={createRecurring} className="card p-4 space-y-3">
                <h2 className="text-lg font-semibold">Create recurring transaction</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <PrettySelect value={accountId} onChange={setAccountId} options={accountSelectOptions} placeholder="Choose account" />
                  <PrettySelect value={categoryId} onChange={setCategoryId} options={categorySelectOptions} placeholder="No category" />
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                  <input
                    className="input"
                    type="date"
                    value={nextDate}
                    onChange={(event) => setNextDate(event.target.value)}
                    required
                  />
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_minmax(300px,1fr)]">
                  <div className="space-y-2">
                    {canApplyAllSharedMembers ? (
                      <div className="rounded-xl border border-slate-200 p-1">
                        <div className="grid grid-cols-2 gap-1 text-xs sm:text-sm">
                          <button
                            type="button"
                            className={`whitespace-nowrap rounded-lg px-3 py-2 transition ${
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
                            className={`whitespace-nowrap rounded-lg px-3 py-2 transition ${
                              !applyToAllSharedMembers
                                ? "bg-emerald-500 text-emerald-950 font-semibold shadow-sm"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                            onClick={() => {
                              setApplyToAllSharedMembers(false);
                              const fallback = selectableRecurringMembers[0]?.id ?? "";
                              setMemberId(fallback);
                            }}
                          >
                            Choose member
                          </button>
                        </div>
                      </div>
                    ) : (
                      <PrettySelect
                        value={memberId}
                        onChange={setMemberId}
                        options={memberSelectOptions}
                        placeholder="Select member"
                      />
                    )}
                    {canApplyAllSharedMembers && applyToAllSharedMembers && (
                      <p className="px-1 text-xs text-slate-500">
                        Applies to {selectableRecurringMembers.length} members.
                      </p>
                    )}
                    {canApplyAllSharedMembers && !applyToAllSharedMembers && (
                      <PrettySelect
                        value={memberId}
                        onChange={setMemberId}
                        options={memberSelectOptions}
                        placeholder="Select member"
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="text-sm text-slate-600">Every</span>
                    <input
                      className="input w-24"
                      type="number"
                      min="1"
                      value={everyInterval}
                      onChange={(event) => setEveryInterval(event.target.value)}
                      required
                    />
                    <PrettySelect
                      value={everyUnit}
                      onChange={(value) => setEveryUnit(value as FrequencyUnit)}
                      options={frequencyUnitOptions}
                      placeholder="Unit"
                      className="w-full"
                    />
                  </div>
                </div>
                {!selectableRecurringMembers.length && (
                  <p className="text-xs text-amber-600">
                    No members have visibility to the selected account.
                  </p>
                )}
                <input
                  className="input"
                  placeholder="Description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <button
                  className="btn btn-primary w-fit"
                  type="submit"
                  disabled={isSaving || !selectableRecurringMembers.length}
                >
                  {isSaving ? "Saving..." : "Create"}
                </button>
              </form>
            ) : (
              <div className="card p-4 text-sm text-slate-600">
                You do not have access to any bank account in this family yet.
              </div>
            )}

            <section className="card p-4 space-y-3">
              <h2 className="text-lg font-semibold">Scheduled</h2>
              {isLoading && <p className="text-sm text-slate-500">Loading recurring transactions...</p>}
              {!isLoading && !(data?.recurring ?? []).length && (
                <p className="text-sm text-slate-500">No recurring transactions yet.</p>
              )}
              <ul className="space-y-2">
                {(data?.recurring ?? []).map((row) => (
                  <li
                    key={row.id}
                    className="rounded-lg border border-slate-200 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium">{formatEur(row.amount)}</p>
                      <p className="text-sm text-slate-600">
                        {row.account_name} · {row.member_name ?? "Unassigned"} · {frequencyLabel(row.frequency)}
                      </p>
                      <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                        <span>Next: {row.next_execution_date}</span>
                        {row.category_name && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: row.category_id ? categoryColorById.get(row.category_id) : "#94a3b8" }}
                              />
                              {row.category_name}
                            </span>
                          </>
                        )}
                      </p>
                      {row.description && <p className="text-xs text-slate-500">{row.description}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={() => {
                          const parsed = parseFrequency(row.frequency);
                          setEditingRecurring(row);
                          setEditingAmount(String(row.amount));
                          setEditingInterval(String(parsed.interval));
                          setEditingUnit(parsed.unit);
                          setEditingDate(row.next_execution_date);
                          setEditingDescription(row.description ?? "");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost text-xs text-red-600"
                        onClick={() => setDeletingRecurringId(row.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      <AppDialog
        open={Boolean(editingRecurring)}
        onClose={() => setEditingRecurring(null)}
        title="Edit recurring transaction"
        subtitle={editingRecurring?.account_name ?? "Recurring"}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingRecurring) return;
            void (async () => {
              await editRecurring(
                editingRecurring.id,
                Number(editingAmount),
                Math.max(1, Number(editingInterval) || 1),
                editingUnit,
                editingDate,
                editingDescription
              );
              setEditingRecurring(null);
            })();
          }}
        >
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
          <div className="grid gap-3 sm:grid-cols-[120px,1fr]">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Every</span>
              <input
                className="input"
                type="number"
                min="1"
                value={editingInterval}
                onChange={(event) => setEditingInterval(event.target.value)}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Unit</span>
              <PrettySelect
                value={editingUnit}
                onChange={(value) => setEditingUnit(value as FrequencyUnit)}
                options={frequencyUnitOptions}
                placeholder="Unit"
              />
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Next date</span>
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
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingRecurring(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingRecurringId)}
        title="Delete recurring transaction"
        description="Delete this recurring item? Future runs will stop."
        confirmLabel="Delete recurring"
        destructive
        onClose={() => setDeletingRecurringId(null)}
        onConfirm={() => {
          if (!deletingRecurringId) return;
          void (async () => {
            await deleteRecurring(deletingRecurringId);
            setDeletingRecurringId(null);
          })();
        }}
      />
    </div>
  );
}
