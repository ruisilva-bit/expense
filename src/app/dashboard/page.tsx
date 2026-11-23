"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AppDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import {
  AccountSpendingChart,
  CashFlowTrendChart,
  CategoryChart,
  CategoryPercentageChart,
} from "@/components/FamilyCharts";
import { TransactionWizard } from "@/components/TransactionWizard";
import { useAppState } from "@/context/AppState";
import { buildCashFlowTrend } from "@/lib/cash-flow-trend";
import { resolveCategoryColor } from "@/lib/category-color";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import {
  calculateNetBalance,
  calculateTotalReceived,
  inferAccountTransferSide as inferTransferSide,
  sumFinancialTransactions,
} from "@/lib/financial-totals";
import { formatEur } from "@/lib/format";

type Preset = "this_month" | "last_month" | "this_year" | "all" | "custom";
type FlowFilter = "all" | "in" | "out";
type ChartDatum = { name: string; value: number; color?: string | null };
type CategoryPercentageDatum = { name: string; percentage: number; value: number; color?: string | null };
type Txn = {
  id: string;
  bank_account_id?: string | null;
  amount: number;
  type: "income" | "expense" | "transfer";
  transfer_side?: "source" | "dest" | null;
  goal_move_type?: "allocate" | "release" | "spend" | null;
  balance_after?: number | null;
  date: string | null;
  description: string | null;
  assigned_to: string | null;
  category: { id?: string | null; name: string; color?: string | null };
  bank_account: { name: string };
  loan?: { id: string; name: string } | null;
};
type DashboardPayload = {
  members: Array<{ id: string; name: string; user_id?: string | null }>;
  accounts: Array<{ id: string; name: string; balance: number; is_shared?: boolean; member_ids?: string[] }>;
  categories: Array<{
    id: string;
    name: string;
    type: "income" | "expense" | "transfer";
    affects_loan: boolean;
    color?: string | null;
  }>;
  loans: Array<{ id: string; name: string; remaining_amount: number }>;
  txns: Txn[];
  category_usage?: Record<string, number>;
  recurring_month_paid?: number;
  recurring_month_to_pay?: number;
  reserved_goal_amount?: number;
};

const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getPresetRange = (preset: Preset, customFrom: string, customTo: string) => {
  const today = new Date();
  if (preset === "this_month") {
    return {
      dateFrom: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`,
      dateTo: toIsoDate(today),
    };
  }

  if (preset === "last_month") {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to = new Date(today.getFullYear(), today.getMonth(), 0);
    return {
      dateFrom: toIsoDate(from),
      dateTo: toIsoDate(to),
    };
  }

  if (preset === "this_year") {
    return {
      dateFrom: `${today.getFullYear()}-01-01`,
      dateTo: toIsoDate(today),
    };
  }

  if (preset === "custom") {
    return {
      dateFrom: customFrom || undefined,
      dateTo: customTo || undefined,
    };
  }

  return { dateFrom: undefined, dateTo: undefined };
};

const buildQuery = ({
  familyId,
  preset,
  customFrom,
  customTo,
  accountIds,
  memberIds,
}: {
  familyId: string;
  preset: Preset;
  customFrom: string;
  customTo: string;
  accountIds: string[];
  memberIds: string[];
}) => {
  const { dateFrom, dateTo } = getPresetRange(preset, customFrom, customTo);
  const params = new URLSearchParams();
  params.set("familyId", familyId);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (accountIds.length) params.set("accountIds", accountIds.join(","));
  if (memberIds.length) params.set("memberIds", memberIds.join(","));
  return params.toString();
};

const fetchFamilyData = async (query: string) => {
  const headers = await getClientAuthHeaders();
  return fetchClientJson<DashboardPayload>(`/api/dashboard?${query}`, {
    method: "GET",
    headers,
  });
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

export default function DashboardPage() {
  const { user, selectedFamily, selectedAccount, isFamiliesLoading, familiesError } = useAppState();
  const [preset, setPreset] = useState<Preset>("this_month");
  const [customFromDraft, setCustomFromDraft] = useState("");
  const [customToDraft, setCustomToDraft] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [flowFilter, setFlowFilter] = useState<FlowFilter>("all");
  const [excludedCategoryIds, setExcludedCategoryIds] = useState<string[]>([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isCategoryFilterOpen, setIsCategoryFilterOpen] = useState(false);

  useEffect(() => {
    const next = !selectedFamily?.id ? [] : selectedAccount?.id ? [selectedAccount.id] : [];
    queueMicrotask(() => {
      setSelectedAccountIds(next);
    });
  }, [selectedFamily?.id, selectedAccount?.id]);

  const query = useMemo(() => {
    if (!selectedFamily) return null;
    return buildQuery({
      familyId: selectedFamily.id,
      preset,
      customFrom,
      customTo,
      accountIds: selectedAccountIds,
      memberIds: selectedMemberIds,
    });
  }, [selectedFamily, preset, customFrom, customTo, selectedAccountIds, selectedMemberIds]);

  const { data, error, mutate } = useSWR(query ? `dashboard:${query}` : null, () => fetchFamilyData(query!));

  const txns = useMemo(() => data?.txns ?? [], [data?.txns]);
  const excludedCategorySet = useMemo(() => new Set(excludedCategoryIds), [excludedCategoryIds]);
  const flowFilteredTxns = useMemo(
    () =>
      txns.filter((txn) => {
        if (flowFilter === "all") return true;
        if (txn.type === "income") return flowFilter === "in";
        if (txn.type === "expense") return flowFilter === "out";
        if (txn.goal_move_type === "release") return flowFilter === "in";
        if (txn.goal_move_type === "allocate" || txn.goal_move_type === "spend") return flowFilter === "out";
        const side = inferTransferSide(txn);
        if (side === "dest") return flowFilter === "in";
        if (side === "source") return flowFilter === "out";
        return false;
      }),
    [txns, flowFilter]
  );
  const filteredTxns = useMemo(
    () =>
      txns.filter((txn) => {
        if (txn.type !== "expense") return true;
        if (!txn.category?.id) return true;
        return !excludedCategorySet.has(txn.category.id);
      }),
    [txns, excludedCategorySet]
  );

  const totals = sumFinancialTransactions(txns);
  const totalReceived = calculateTotalReceived(totals);
  const totalSpent = totals.spent;
  const net = calculateNetBalance(totals);
  const recurringMonthPaid = Number(data?.recurring_month_paid ?? 0);
  const recurringMonthUpcoming = Number(data?.recurring_month_to_pay ?? 0);
  const recurringMonthPlanned = recurringMonthPaid + recurringMonthUpcoming;
  const recurringProgress =
    recurringMonthPlanned > 0 ? Math.min(100, (recurringMonthPaid / recurringMonthPlanned) * 100) : 0;
  const currentBalance = (() => {
    const accountIdsInScope = selectedAccountIds.length
      ? new Set(selectedAccountIds)
      : new Set((data?.accounts ?? []).map((account) => account.id));
    return (data?.accounts ?? []).reduce((sum, account) => {
      if (!accountIdsInScope.has(account.id)) return sum;
      return sum + Number(account.balance ?? 0);
    }, 0);
  })();
  const reservedGoals = Number(data?.reserved_goal_amount ?? 0);
  const resolveTxnColor = (category: Txn["category"] | undefined) =>
    resolveCategoryColor(category?.color, category?.name ?? "category");

  const categoryChart: ChartDatum[] = (() => {
    const sums = new Map<string, { value: number; color: string }>();
    filteredTxns.forEach((txn) => {
      if (txn.type !== "expense") return;
      const key = txn.category?.name ?? "Uncategorized";
      const color = resolveTxnColor(txn.category);
      const current = sums.get(key);
      if (current) {
        current.value += Number(txn.amount ?? 0);
      } else {
        sums.set(key, { value: Number(txn.amount ?? 0), color });
      }
    });
    return Array.from(sums.entries()).map(([name, value]) => ({
      name,
      value: value.value,
      color: value.color,
    }));
  })();

  const accountSpendingChart: ChartDatum[] = (() => {
    const sums = new Map<string, number>();
    filteredTxns.forEach((txn) => {
      if (txn.type !== "expense") return;
      const accountName = txn.bank_account?.name ?? "Account";
      sums.set(accountName, (sums.get(accountName) ?? 0) + Number(txn.amount ?? 0));
    });
    return Array.from(sums.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  })();

  const categoryPercentageChart: CategoryPercentageDatum[] = (() => {
    const totalExpense = categoryChart.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
    if (!totalExpense) {
      return categoryChart.map((item) => ({ ...item, percentage: 0 }));
    }
    return categoryChart
      .map((item) => ({
        ...item,
        percentage: (Number(item.value ?? 0) / totalExpense) * 100,
      }))
      .sort((a, b) => b.percentage - a.percentage);
  })();

  const cashFlowTrend = useMemo(() => {
    const { dateFrom, dateTo } = getPresetRange(preset, customFrom, customTo);
    return buildCashFlowTrend({
      transactions: filteredTxns,
      dateFrom,
      dateTo,
    });
  }, [filteredTxns, preset, customFrom, customTo]);

  const categoryUsageCount =
    data?.category_usage ??
    Object.fromEntries(
      txns.reduce((usage, txn) => {
        if (txn.type !== "expense" || !txn.category?.id) return usage;
        usage.set(txn.category.id, (usage.get(txn.category.id) ?? 0) + 1);
        return usage;
      }, new Map<string, number>())
    );

  const recentTransactions = flowFilteredTxns.slice(0, 10);
  const excludedCategoryNames = useMemo(() => {
    if (!excludedCategoryIds.length) return "None";
    const map = new Map((data?.categories ?? []).map((category) => [category.id, category.name]));
    const names = excludedCategoryIds.map((id) => map.get(id)).filter(Boolean) as string[];
    if (!names.length) return `${excludedCategoryIds.length} selected`;
    if (names.length <= 2) return names.join(", ");
    return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }, [excludedCategoryIds, data?.categories]);

  return (
    <div className="min-h-screen app-shell">
      <AppNav />
      <main className="app-main page-dashboard max-w-6xl space-y-8 pb-24">
        <div className="page-header">
          <div>
            <p className="page-kicker">Dashboard</p>
            <h1 className="page-title">{selectedFamily?.name ?? "Select a family"}</h1>
            <p className="page-subtitle">Household balances, goals, recurring costs, and recent movement.</p>
          </div>
        </div>

        {familiesError && (
          <div className="status-banner status-banner-error">
            Family load error: {familiesError}
          </div>
        )}

        {error && (
          <div className="status-banner status-banner-error">
            Dashboard error: {error.message}
          </div>
        )}

        {!selectedFamily && !isFamiliesLoading && (
          <div className="empty-state">Select a family first.</div>
        )}

        {(isFamiliesLoading || (!data && !error && selectedFamily)) && (
          <div className="loading-state space-y-4">
            <div className="skeleton-block h-8 w-48" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="skeleton-block h-32" />
              ))}
            </div>
          </div>
        )}

        {selectedFamily && data && (
          <>
            <section className="card ledger-control-sheet space-y-2 p-3 bg-white text-slate-900 dark:bg-slate-900/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Quick and custom filters</h2>
                <button
                  type="button"
                  className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-slate-50 flex items-center gap-1"
                  onClick={() => setShowAdvancedFilters((value) => !value)}
                >
                  {showAdvancedFilters ? "Hide filters" : "More filters"}
                  <span className={`transition-transform ${showAdvancedFilters ? "rotate-180" : ""}`}>▾</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "this_month", label: "This month" },
                  { id: "last_month", label: "Last month" },
                  { id: "this_year", label: "This year" },
                  { id: "all", label: "All" },
                  { id: "custom", label: "Custom range" },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`px-2.5 py-1.5 text-sm rounded-full border transition-colors ${
                      preset === option.id
                        ? "bg-emerald-700 text-white border-emerald-700"
                        : "border-slate-400 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-600/50 dark:bg-transparent dark:text-slate-100 dark:hover:bg-slate-800/60"
                    }`}
                    onClick={() => setPreset(option.id as Preset)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>


              {preset === "custom" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    className="input h-9 text-sm"
                    type="date"
                    aria-label="From date"
                    value={customFromDraft}
                    onChange={(event) => setCustomFromDraft(event.target.value)}
                  />
                  <input
                    className="input h-9 text-sm"
                    type="date"
                    aria-label="To date"
                    value={customToDraft}
                    onChange={(event) => setCustomToDraft(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary h-9 text-sm px-3"
                    onClick={() => {
                      setCustomFrom(customFromDraft);
                      setCustomTo(customToDraft);
                    }}
                  >
                    Apply range
                  </button>
                </div>
              )}

              {showAdvancedFilters && (
                <div className="grid gap-2 pb-1 md:grid-cols-3">
                <div className="rounded-md border border-slate-300 dark:border-slate-200/30 bg-slate-50 dark:bg-slate-900/30 p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">Account(s)</p>
                    <button type="button" className="text-sm text-emerald-700 dark:text-emerald-400" onClick={() => setSelectedAccountIds([])}>
                      All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(data.accounts ?? []).map((account) => {
                      const allSelected = !selectedAccountIds.length;
                      const selected = allSelected || selectedAccountIds.includes(account.id);
                      return (
                        <button
                          key={account.id}
                          type="button"
                          className={`px-2.5 py-1.5 text-sm rounded-full border ${
                            selected
                              ? "bg-emerald-700 text-white border-emerald-700"
                              : "border-slate-400 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-600/50 dark:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800/60"
                          }`}
                          onClick={() =>
                            setSelectedAccountIds((current) =>
                              toggleMultiValue(
                                current,
                                account.id,
                                (data.accounts ?? []).map((item) => item.id)
                              )
                            )
                          }
                        >
                          {account.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-md border border-slate-300 dark:border-slate-200/30 bg-slate-50 dark:bg-slate-900/30 p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-100">User(s)</p>
                    <button type="button" className="text-sm text-emerald-700 dark:text-emerald-400" onClick={() => setSelectedMemberIds([])}>
                      All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(data.members ?? []).map((member) => {
                      const allSelected = !selectedMemberIds.length;
                      const selected = allSelected || selectedMemberIds.includes(member.id);
                      return (
                        <button
                          key={member.id}
                          type="button"
                          className={`px-2.5 py-1.5 text-sm rounded-full border ${
                            selected
                              ? "bg-emerald-700 text-white border-emerald-700"
                              : "border-slate-400 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-600/50 dark:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800/60"
                          }`}
                          onClick={() =>
                            setSelectedMemberIds((current) =>
                              toggleMultiValue(
                                current,
                                member.id,
                                (data.members ?? []).map((item) => item.id)
                              )
                            )
                          }
                        >
                          {member.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-md border border-slate-300 dark:border-slate-200/30 bg-slate-50 dark:bg-slate-900/30 p-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-700 dark:text-slate-200">Exclude categories (charts)</span>
                    <button
                      type="button"
                      className="px-2 py-1.5 text-xs rounded-full border border-slate-400 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-600/50 dark:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800/60"
                      onClick={() => setIsCategoryFilterOpen(true)}
                    >
                      Picklist
                    </button>
                    <span className="text-xs text-slate-500 dark:text-slate-400">Excluded: {excludedCategoryNames}</span>
                    <button
                      type="button"
                      className="ml-auto text-xs text-emerald-700 dark:text-emerald-400"
                      onClick={() => setExcludedCategoryIds([])}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="ledger-metrics grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="card p-4 border border-emerald-200 dark:border-emerald-400/20 bg-emerald-50 dark:bg-emerald-500/[0.08]">
                  <p className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-200/90">Total received</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-900 dark:text-emerald-50">{formatEur(totalReceived)}</p>
                </div>
                <div className="card p-4 border border-rose-200 dark:border-rose-400/20 bg-rose-50 dark:bg-rose-500/[0.08]">
                  <p className="text-xs uppercase tracking-wide text-rose-700 dark:text-rose-200/90">Total spent</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-900 dark:text-rose-50">{formatEur(totalSpent)}</p>
                </div>
                <div className="card p-4 border border-sky-200 dark:border-sky-400/20 bg-sky-50 dark:bg-sky-500/[0.08]">
                  <p className="text-xs uppercase tracking-wide text-sky-700 dark:text-sky-200/90">Net balance</p>
                  <p className={`mt-2 text-2xl font-semibold ${net >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                    {formatEur(net)}
                  </p>
                </div>
                <div className="card p-4 border border-slate-300 dark:border-slate-200/20 bg-slate-100 dark:bg-slate-500/[0.08]">
                  <p className="text-xs uppercase tracking-wide text-slate-700 dark:text-slate-300">Account balance</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{formatEur(currentBalance)}</p>
                </div>
                <div className="card p-4 border border-violet-200 dark:border-violet-400/20 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-500/[0.10] dark:to-fuchsia-500/[0.06]">
                  <p className="text-xs uppercase tracking-wide text-violet-700 dark:text-violet-200/90">Savings</p>
                  <p className="mt-2 text-2xl font-semibold text-violet-900 dark:text-violet-50">{formatEur(reservedGoals)}</p>
                </div>
              </div>

              <div className="card p-4 border border-indigo-300 dark:border-indigo-300/20 bg-indigo-50 dark:bg-slate-900/60 text-slate-900 dark:text-slate-50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-800 dark:text-slate-50">Recurring this month</h3>
                  <span className="text-xs text-slate-500 dark:text-slate-300">{recurringProgress.toFixed(0)}% completed</span>
                </div>
                <div className="recurring-progress-track h-2 w-full overflow-hidden rounded-full bg-slate-300 dark:bg-slate-700/70">
                  <div
                    className="recurring-progress-fill h-full rounded-full transition-all"
                    style={{ width: `${Math.min(Math.max(recurringProgress, 0), 100)}%` }}
                    role="progressbar"
                    aria-label="Recurring expenses completed this month"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(recurringProgress)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-300 dark:border-slate-200/20 bg-white dark:bg-slate-900/30 p-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Pago</p>
                    <p className="mt-1 text-xl font-semibold text-emerald-700 dark:text-emerald-300">{formatEur(recurringMonthPaid)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-300 dark:border-slate-200/20 bg-white dark:bg-slate-900/30 p-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Por pagar</p>
                    <p className="mt-1 text-xl font-semibold text-slate-800 dark:text-slate-100">{formatEur(recurringMonthUpcoming)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-300 dark:border-slate-200/20 bg-white dark:bg-slate-900/30 p-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400">Total planeado</p>
                    <p className={`mt-1 text-xl font-semibold ${recurringMonthPlanned > 0 ? "text-cyan-700 dark:text-cyan-300" : "text-slate-500 dark:text-slate-300"}`}>
                      {formatEur(recurringMonthPlanned)}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <CashFlowTrendChart data={cashFlowTrend.data} granularity={cashFlowTrend.granularity} />

            <CategoryChart data={categoryChart} />

            <div className="grid gap-4 xl:grid-cols-2">
              <CategoryPercentageChart data={categoryPercentageChart} />
              <AccountSpendingChart data={accountSpendingChart} />
            </div>

            <section className="card p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold">Recent activity</h3>
                  {[
                    { id: "all", label: "All" },
                    { id: "in", label: "In" },
                    { id: "out", label: "Out" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`px-2.5 py-1.5 text-sm rounded-full border transition-colors ${
                        flowFilter === option.id
                          ? "bg-sky-700 text-white border-sky-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600/50 dark:bg-transparent dark:text-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                      onClick={() => setFlowFilter(option.id as FlowFilter)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <Link href="/transactions" className="btn btn-ghost text-sm">
                  Ver mais
                </Link>
              </div>
              <ul className="divide-y divide-slate-200">
                {recentTransactions.map((txn) => {
                  const categoryColor = resolveTxnColor(txn.category);
                  const transferSide = inferTransferSide(txn);
                  return (
                    <li key={txn.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: categoryColor }} />
                          {txn.category?.name ?? "Uncategorized"}
                        </p>
                        <p className="text-sm text-slate-600">{txn.description || "No description"}</p>
                        <p className="text-xs text-slate-500">{txn.date} · {txn.bank_account?.name}</p>
                        {txn.loan?.name && <p className="text-xs text-amber-700">Loan: {txn.loan.name}</p>}
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-semibold ${
                            txn.type === "income"
                              ? "text-emerald-700"
                              : txn.type === "expense"
                                ? "text-red-600"
                                : transferSide === "dest"
                                  ? "text-emerald-700"
                                  : transferSide === "source"
                                    ? "text-red-600"
                                    : "text-slate-700"
                          }`}
                        >
                          {txn.type === "income"
                            ? "+"
                            : txn.type === "expense"
                              ? "-"
                              : transferSide === "dest"
                                ? "+"
                                : transferSide === "source"
                                  ? "-"
                                  : "↔ "}
                          {formatEur(Number(txn.amount ?? 0))}
                        </p>
                        <p className="text-xs text-slate-500">
                          Saldo ap&oacute;s: {txn.balance_after == null ? "-" : formatEur(txn.balance_after)}
                        </p>
                      </div>
                    </li>
                  );
                })}
                {!recentTransactions.length && <li className="py-2 text-sm text-slate-500">No transactions for selected filters.</li>}
              </ul>
            </section>

            {data.accounts.length > 0 ? (
              <>
                <button
                  type="button"
                  className="fixed bottom-4 right-4 z-40 h-14 w-14 rounded-full bg-emerald-700 text-3xl leading-none text-white shadow-lg hover:bg-emerald-800 sm:bottom-6 sm:right-6 lg:right-8"
                  onClick={() => setIsWizardOpen(true)}
                  aria-label="Create transaction"
                >
                  +
                </button>

                {isWizardOpen && (
                  <AppDialog
                    open={isWizardOpen}
                    onClose={() => setIsWizardOpen(false)}
                    title="Create transaction"
                    subtitle={selectedFamily.name}
                    maxWidthClassName="max-w-2xl"
                  >
                      <TransactionWizard
                        familyId={selectedFamily.id}
                        members={data.members}
                        accounts={data.accounts.map((account) => ({
                          id: account.id,
                          name: account.name,
                          is_shared: Boolean(account.is_shared),
                          member_ids: account.member_ids ?? [],
                        }))}
                        categories={data.categories}
                        loans={data.loans}
                        currentUserId={user?.id ?? null}
                        defaultAccountId={selectedAccount?.id ?? null}
                        categoryUsageCount={categoryUsageCount}
                        onCreated={() => {
                          setIsWizardOpen(false);
                          void mutate();
                        }}
                      />
                  </AppDialog>
                )}

                {isCategoryFilterOpen && (
                  <AppDialog
                    open={isCategoryFilterOpen}
                    onClose={() => setIsCategoryFilterOpen(false)}
                    title="Exclude categories"
                    subtitle="Hidden from dashboard totals and charts"
                    maxWidthClassName="max-w-xl"
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {(data.categories ?? [])
                          .filter((category) => category.type === "expense")
                          .map((category) => {
                            const selected = excludedCategorySet.has(category.id);
                            const color = resolveCategoryColor(category.color, category.name);
                            return (
                              <label
                                key={category.id}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                                  selected ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-700"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() =>
                                    setExcludedCategoryIds((current) =>
                                      current.includes(category.id)
                                        ? current.filter((id) => id !== category.id)
                                        : [...current, category.id]
                                    )
                                  }
                                />
                                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                                {category.name}
                              </label>
                            );
                          })}
                        {!(data.categories ?? []).filter((category) => category.type === "expense").length && (
                          <span className="text-sm text-slate-500">No expense categories yet.</span>
                        )}
                      </div>
                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
                        <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setIsCategoryFilterOpen(false)}>
                          Close
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost border border-slate-200"
                          onClick={() => setExcludedCategoryIds([])}
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                  </AppDialog>
                )}
              </>
            ) : (
              <div className="card p-4 text-sm text-slate-600">
                You do not have access to any bank account in this family yet.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
