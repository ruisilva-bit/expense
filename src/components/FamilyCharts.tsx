"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SafeResponsiveContainer } from "@/components/SafeResponsiveContainer";
import type { CashFlowDatum, CashFlowGranularity } from "@/lib/cash-flow-trend";
import { formatEur, formatEurAxis } from "@/lib/format";

type Datum = { name: string; value: number; color?: string | null };
type CategoryPercentDatum = { name: string; percentage: number; value: number; color?: string | null };

const asNumber = (value: unknown) => Number(value ?? 0);
const percentFormatter = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const tooltipStyle: CSSProperties = {
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--chart-tooltip-radius, 8px)",
  background: "var(--surface)",
  color: "var(--foreground)",
  boxShadow: "var(--shadow-md)",
};
const axisTick = { fill: "var(--foreground-soft)", fontSize: 11 };
const formatPercent = (value: number) => `${percentFormatter.format(value)}%`;
const ALL_KEY = "__all__";

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="chart-plot flex min-h-52 items-center justify-center px-5 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

export function CategoryChart({ data }: { data: Datum[] }) {
  const chartData = useMemo(() => {
    const sorted = [...data]
      .map((entry) => ({ ...entry, value: asNumber(entry.value) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 7) return sorted;

    const top = sorted.slice(0, 6);
    const otherValue = sorted.slice(6).reduce((sum, entry) => sum + entry.value, 0);
    return otherValue > 0 ? [...top, { name: "Other", value: otherValue, color: "#a99076" }] : top;
  }, [data]);
  const chartSignature = chartData.map((entry) => `${entry.name}:${entry.value}`).join("|");
  const [selection, setSelection] = useState<{ signature: string; name: string }>({
    signature: "",
    name: ALL_KEY,
  });
  const total = useMemo(
    () => chartData.reduce((sum, entry) => sum + asNumber(entry.value), 0),
    [chartData]
  );
  const selectedName = selection.signature === chartSignature ? selection.name : ALL_KEY;
  const activeEntry = selectedName === ALL_KEY
    ? null
    : chartData.find((entry) => entry.name === selectedName) ?? null;
  const activeValue = activeEntry ? asNumber(activeEntry.value) : total;
  const activePercent = total > 0 ? (activeValue / total) * 100 : 0;

  return (
    <section className="card data-viz min-w-0 space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-kicker">Breakdown</p>
          <h3 className="mt-1 text-xl font-semibold">Where the money went</h3>
          <p className="mt-1 text-sm text-slate-500">Select a category to isolate its share.</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          {chartData.length} groups
        </span>
      </div>

      {!chartData.length ? (
        <EmptyChart label="No expense data for the selected filters." />
      ) : (
        <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="chart-plot relative h-[19rem] min-w-0 p-2">
            <SafeResponsiveContainer minHeight={280}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  startAngle={90}
                  endAngle={-270}
                  outerRadius={112}
                  innerRadius={78}
                  paddingAngle={3}
                  cornerRadius={7}
                  stroke="none"
                  onClick={(_, index) => {
                    const clickedName = chartData[index]?.name;
                    if (!clickedName) return;
                    setSelection({ signature: chartSignature, name: clickedName });
                  }}
                >
                  {chartData.map((entry) => {
                    const isActive = selectedName === ALL_KEY || entry.name === selectedName;
                    return (
                      <Cell
                        key={entry.name}
                        fill={entry.color ?? "#0e5b57"}
                        opacity={isActive ? 1 : 0.22}
                        stroke={entry.name === selectedName ? "var(--surface)" : "transparent"}
                        strokeWidth={entry.name === selectedName ? 4 : 0}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  formatter={(value) => formatEur(asNumber(value))}
                  contentStyle={tooltipStyle}
                  itemStyle={{ color: "var(--foreground)" }}
                />
              </PieChart>
            </SafeResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-36 text-center">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {selectedName === ALL_KEY ? "Total" : activeEntry?.name}
                </p>
                <p className="font-display mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">
                  {formatEur(activeValue)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{formatPercent(activePercent)}</p>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <button
              type="button"
              aria-pressed={selectedName === ALL_KEY}
              onClick={() => setSelection({ signature: chartSignature, name: ALL_KEY })}
              className="chart-choice mb-2 flex min-h-11 w-full items-center justify-between px-3.5 text-left transition"
              data-active={selectedName === ALL_KEY}
            >
              <span className="font-semibold">All expenses</span>
              <span className="text-sm">{formatEur(total)}</span>
            </button>
            <ul className="space-y-1.5">
              {chartData.map((entry) => {
                const isActive = entry.name === selectedName;
                const value = asNumber(entry.value);
                const percentage = total > 0 ? (value / total) * 100 : 0;
                return (
                  <li key={`legend-${entry.name}`}>
                    <button
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setSelection({ signature: chartSignature, name: entry.name })}
                      className="chart-choice flex min-h-11 w-full items-center gap-3 px-3.5 text-left transition"
                      data-active={isActive}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full shadow-sm"
                        style={{ backgroundColor: entry.color ?? "#0e5b57" }}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold">{formatEur(value)}</span>
                        <span className="block text-[11px] text-slate-500">{formatPercent(percentage)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export function AccountSpendingChart({ data }: { data: Datum[] }) {
  const chartData = useMemo(
    () => [...data].filter((entry) => asNumber(entry.value) > 0).sort((a, b) => asNumber(b.value) - asNumber(a.value)),
    [data]
  );
  const chartHeight = Math.min(320, Math.max(220, chartData.length * 58));

  return (
    <section className="card data-viz min-w-0 space-y-4 p-4 sm:p-5">
      <div>
        <p className="page-kicker">Accounts</p>
        <h3 className="mt-1 text-xl font-semibold">Spending footprint</h3>
        <p className="mt-1 text-sm text-slate-500">Compare outflow across accounts.</p>
      </div>
      {!chartData.length ? (
        <EmptyChart label="No account spending for this period." />
      ) : (
        <div className="chart-plot min-w-0 p-2" style={{ height: chartHeight + 24 }} role="img" aria-label="Spending by account bar chart">
          <SafeResponsiveContainer minHeight={chartHeight}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 76, bottom: 10, left: 8 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={96}
                axisLine={false}
                tickLine={false}
                tick={{ ...axisTick, fontSize: 12 }}
              />
              <Tooltip
                cursor={{ fill: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}
                formatter={(value) => [formatEur(asNumber(value)), "Spent"]}
                contentStyle={tooltipStyle}
                labelStyle={{ color: "var(--foreground)", fontWeight: 700 }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <Bar
                dataKey="value"
                fill="var(--accent)"
                radius={[0, 5, 5, 0]}
                maxBarSize={22}
              >
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(value: unknown) => formatEurAxis(asNumber(value))}
                  fill="var(--foreground-muted)"
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </SafeResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export function CategoryPercentageChart({ data }: { data: CategoryPercentDatum[] }) {
  const chartData = useMemo(
    () => [...data]
      .map((entry) => ({ ...entry, percentage: asNumber(entry.percentage), value: asNumber(entry.value) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.percentage - a.percentage),
    [data]
  );

  return (
    <section className="card data-viz min-w-0 space-y-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="page-kicker">Concentration</p>
          <h3 className="mt-1 text-xl font-semibold">Category share</h3>
          <p className="mt-1 text-sm text-slate-500">Every category, ranked by weight.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {chartData.length}
        </span>
      </div>
      {!chartData.length ? (
        <EmptyChart label="No category spending for this period." />
      ) : (
        <ol className="max-h-[23rem] space-y-3 overflow-y-auto pr-1 sm:pr-2">
          {chartData.map((entry, index) => (
            <li key={entry.name} className="rounded-2xl px-1 py-1">
              <div className="mb-1.5 flex items-end gap-3">
                <span className="w-5 shrink-0 text-xs font-semibold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {entry.name}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">{formatEur(entry.value)}</span>
                  <span className="block text-[11px] text-slate-500">{formatPercent(entry.percentage)}</span>
                </span>
              </div>
              <div className="chart-track ml-8 h-2 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.max(2, Math.min(100, entry.percentage))}%`,
                    backgroundColor: entry.color ?? "#0e5b57",
                  }}
                  role="progressbar"
                  aria-label={`${entry.name}: ${formatPercent(entry.percentage)}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={entry.percentage}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const cashFlowCopy: Record<
  CashFlowGranularity,
  { subtitle: string; empty: string; ariaLabel: string }
> = {
  week: {
    subtitle: "Weekly income, spending and net movement.",
    empty: "No weekly movement for the selected filters.",
    ariaLabel: "Weekly income, expenses, and net cash flow chart",
  },
  month: {
    subtitle: "Monthly income, spending and net movement.",
    empty: "No monthly movement for the selected filters.",
    ariaLabel: "Monthly income, expenses, and net cash flow chart",
  },
};

export function CashFlowTrendChart({
  data,
  granularity,
}: {
  data: CashFlowDatum[];
  granularity: CashFlowGranularity;
}) {
  const copy = cashFlowCopy[granularity];

  return (
    <section className="card data-viz min-w-0 space-y-5 p-4 sm:p-6">
      <div>
        <p className="page-kicker">Cash flow</p>
        <h3 className="mt-1 text-xl font-semibold">Income vs spending</h3>
        <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
      </div>

      {!data.length ? (
        <EmptyChart label={copy.empty} />
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-600 dark:text-slate-300" aria-hidden="true">
            <span className="inline-flex items-center gap-2"><span className="h-0.5 w-5 rounded bg-[var(--accent)]" />Income</span>
            <span className="inline-flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-[var(--coral)]" />Expense</span>
            <span className="inline-flex items-center gap-2"><span className="h-[3px] w-5 rounded bg-[var(--gold)]" />Net</span>
          </div>
          <div className="chart-plot h-[20rem] min-w-0 px-1 py-3 sm:px-3" role="img" aria-label={copy.ariaLabel}>
            <SafeResponsiveContainer minHeight={280}>
              <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border-strong)" strokeDasharray="2 7" />
                <XAxis
                  dataKey="period"
                  axisLine={false}
                  tickLine={false}
                  tick={axisTick}
                  minTickGap={16}
                  dy={8}
                />
                <YAxis
                  width={68}
                  axisLine={false}
                  tickLine={false}
                  tick={axisTick}
                  tickFormatter={(value) => formatEurAxis(asNumber(value))}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border-strong)", strokeDasharray: "4 4" }}
                  formatter={(value, name) => [
                    formatEur(asNumber(value)),
                    name === "income" ? "Income" : name === "expense" ? "Expense" : "Net",
                  ]}
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: "var(--foreground)", fontWeight: 700 }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Line
                  type="monotone"
                  dataKey="income"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, strokeWidth: 2, fill: "var(--surface)" }}
                  activeDot={{ r: 5, strokeWidth: 3, fill: "var(--surface)" }}
                />
                <Line
                  type="monotone"
                  dataKey="expense"
                  stroke="var(--coral)"
                  strokeWidth={2.5}
                  strokeDasharray="7 5"
                  dot={{ r: 2.5, strokeWidth: 2, fill: "var(--surface)" }}
                  activeDot={{ r: 5, strokeWidth: 3, fill: "var(--surface)" }}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  stroke="var(--gold)"
                  strokeWidth={3}
                  dot={{ r: 3, strokeWidth: 2, fill: "var(--surface)" }}
                  activeDot={{ r: 5, strokeWidth: 3, fill: "var(--surface)" }}
                />
              </LineChart>
            </SafeResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}
