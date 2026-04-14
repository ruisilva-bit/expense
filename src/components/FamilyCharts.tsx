"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SafeResponsiveContainer } from "@/components/SafeResponsiveContainer";
import { formatEur, formatEurAxis } from "@/lib/format";

type Datum = { name: string; value: number; color?: string | null };
type MonthlyDatum = { month: string; income: number; expense: number; net: number };
type CategoryPercentDatum = { name: string; percentage: number; value: number; color?: string | null };

const asNumber = (value: unknown) => Number(value ?? 0);
const percentFormatter = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const formatPercent = (value: number) => `${percentFormatter.format(value)}%`;
const ALL_KEY = "__all__";

export function CategoryChart({ data }: { data: Datum[] }) {
  const chartData = useMemo(() => {
    const sorted = [...data]
      .map((entry) => ({ ...entry, value: asNumber(entry.value) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 8) return sorted;

    const top = sorted.slice(0, 7);
    const otherValue = sorted.slice(7).reduce((sum, entry) => sum + entry.value, 0);
    return otherValue > 0 ? [...top, { name: "Other", value: otherValue, color: "#64748b" }] : top;
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
  const activePercent = selectedName === ALL_KEY
    ? (total > 0 ? 100 : 0)
    : activeEntry && total > 0
      ? (asNumber(activeEntry.value) / total) * 100
      : 0;

  return (
    <section className="card min-w-0 space-y-4 p-4 sm:p-6">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Expenses by category</h3>
        <p className="text-xs text-slate-500">Tap a slice or legend item to focus one category.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {selectedName === ALL_KEY ? "ALL" : activeEntry?.name ?? "No category selected"}
            </p>
            <p className="text-2xl font-semibold text-slate-900">
              {selectedName === ALL_KEY ? formatEur(total) : activeEntry ? formatEur(activeEntry.value) : formatEur(0)}
            </p>
            <p className="text-xs text-slate-500">
              {total > 0
                ? `${formatPercent(activePercent)} of total expenses`
                : "No expense data for the selected filters."}
            </p>
          </div>

          <div className="h-[22rem] min-w-0 sm:h-[24rem]">
            <SafeResponsiveContainer minHeight={340}>
              <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={128}
                  innerRadius={74}
                  paddingAngle={2}
                  strokeWidth={1}
                  stroke="#0f172a"
                  label={false}
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
                        fill={entry.color ?? "#16a34a"}
                        opacity={isActive ? 1 : 0.4}
                        stroke={isActive ? "#ffffff" : "transparent"}
                        strokeWidth={isActive ? 2 : 0}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  formatter={(value) => formatEur(asNumber(value))}
                  contentStyle={{ borderRadius: 12, borderColor: "#cbd5e1" }}
                />
              </PieChart>
            </SafeResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3 sm:p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Legend</p>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <li key="legend-all">
              <button
                type="button"
                onClick={() => setSelection({ signature: chartSignature, name: ALL_KEY })}
                className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                  selectedName === ALL_KEY
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" />
                  <span className="truncate">ALL</span>
                </span>
                <span className="text-xs text-slate-500">100%</span>
              </button>
            </li>
            {chartData.map((entry) => {
              const isActive = entry.name === selectedName;
              const value = asNumber(entry.value);
              const percentage = total > 0 ? (value / total) * 100 : 0;
              return (
                <li key={`legend-${entry.name}`}>
                  <button
                    type="button"
                    onClick={() => setSelection({ signature: chartSignature, name: entry.name })}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: entry.color ?? "#16a34a" }}
                      />
                      <span className="truncate">{entry.name}</span>
                    </span>
                    <span className="text-xs text-slate-500">{formatPercent(percentage)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function AccountSpendingChart({ data }: { data: Datum[] }) {
  return (
    <section className="card min-w-0 space-y-2 p-4">
      <h3 className="text-lg font-semibold">Spending by account</h3>
      <div className="h-72 min-w-0">
        <SafeResponsiveContainer minHeight={240}>
          <BarChart data={data} margin={{ top: 10, right: 12, bottom: 28, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="name"
              interval={0}
              minTickGap={20}
              angle={-16}
              textAnchor="end"
              height={56}
              tick={{ fontSize: 11 }}
            />
            <YAxis width={64} tickFormatter={(value) => formatEurAxis(asNumber(value))} />
            <Tooltip formatter={(value) => formatEur(asNumber(value))} />
            <Bar dataKey="value" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
          </BarChart>
        </SafeResponsiveContainer>
      </div>
    </section>
  );
}

export function CategoryPercentageChart({ data }: { data: CategoryPercentDatum[] }) {
  const chartHeight = Math.max(240, data.length * 42);

  return (
    <section className="card min-w-0 space-y-2 p-4">
      <h3 className="text-lg font-semibold">Category share (%)</h3>
      <div className="min-w-0" style={{ height: chartHeight }}>
        <SafeResponsiveContainer minHeight={chartHeight}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(value) => `${asNumber(value).toFixed(0)}%`}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={106}
              interval={0}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(value, _, item) => {
                const percentage = `${asNumber(value).toFixed(1)}%`;
                const amount = formatEur(asNumber(item.payload?.value));
                return `${percentage} (${amount})`;
              }}
            />
            <Bar dataKey="percentage" radius={[0, 8, 8, 0]}>
              {data.map((entry) => (
                <Cell key={`pct-${entry.name}`} fill={entry.color ?? "#16a34a"} />
              ))}
              <LabelList dataKey="percentage" position="right" formatter={(value: unknown) => `${asNumber(value).toFixed(1)}%`} />
            </Bar>
          </BarChart>
        </SafeResponsiveContainer>
      </div>
    </section>
  );
}

export function MonthlyTrendChart({ data }: { data: MonthlyDatum[] }) {
  return (
    <section className="card min-w-0 space-y-2 p-4">
      <h3 className="text-lg font-semibold">Monthly trend</h3>
      <div className="h-72 min-w-0">
        <SafeResponsiveContainer minHeight={240}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={18} />
            <YAxis width={64} tickFormatter={(value) => formatEurAxis(asNumber(value))} />
            <Tooltip formatter={(value) => formatEur(asNumber(value))} />
            <Legend />
            <Line type="monotone" dataKey="income" stroke="#16a34a" strokeWidth={2} dot={false} name="Income" />
            <Line type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} dot={false} name="Expense" />
            <Line type="monotone" dataKey="net" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Net" />
          </LineChart>
        </SafeResponsiveContainer>
      </div>
    </section>
  );
}
