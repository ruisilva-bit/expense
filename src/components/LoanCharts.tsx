"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SafeResponsiveContainer } from "@/components/SafeResponsiveContainer";
import { formatEur, formatEurAxis } from "@/lib/format";

type MonthlyPayment = { month: string; amount: number };
type MemberPayment = { member: string; amount: number };

const asNumber = (value: unknown) => Number(value ?? 0);
const tooltipStyle: CSSProperties = {
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--foreground)",
  boxShadow: "var(--shadow-md)",
};
const axisTick = { fill: "var(--foreground-soft)", fontSize: 11 };

function FigureEmpty({ children }: { children: React.ReactNode }) {
  return <div className="chart-plot flex min-h-56 items-center justify-center px-5 text-center text-sm text-slate-500">{children}</div>;
}

export function LoanPaydownFigure({ total, remaining }: { total: number; remaining: number }) {
  const safeTotal = Math.max(0, asNumber(total));
  const safeRemaining = Math.max(0, Math.min(safeTotal, asNumber(remaining)));
  const paid = Math.max(0, safeTotal - safeRemaining);
  const paidPercent = safeTotal > 0 ? (paid / safeTotal) * 100 : 0;
  const remainingPercent = Math.max(0, 100 - paidPercent);

  return (
    <section className="card data-viz loan-paydown-figure min-w-0 space-y-5 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="page-kicker">Progress</p>
          <h3 className="mt-1 text-xl">Paid vs remaining</h3>
          <p className="mt-1 text-sm text-slate-500">One line shows the full life of this loan.</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl text-slate-900 dark:text-slate-50">{paidPercent.toFixed(0)}%</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">repaid</p>
        </div>
      </div>

      <div className="chart-plot p-4 sm:p-5" role="img" aria-label={`${paidPercent.toFixed(1)} percent of the loan paid`}>
        <div className="loan-paydown-track" aria-hidden="true">
          <div className="loan-paydown-paid" style={{ width: `${paidPercent}%` }} />
          <div className="loan-paydown-remaining" style={{ width: `${remainingPercent}%` }} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-2 h-1 w-10 bg-[var(--accent)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Paid</p>
            <p className="mt-1 font-display text-2xl text-slate-900 dark:text-slate-50">{formatEur(paid)}</p>
          </div>
          <div className="text-right">
            <div className="mb-2 ml-auto h-1 w-10 bg-[var(--coral)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Remaining</p>
            <p className="mt-1 font-display text-2xl text-slate-900 dark:text-slate-50">{formatEur(safeRemaining)}</p>
          </div>
        </div>
        <p className="mt-5 border-t border-slate-200 pt-3 text-xs text-slate-500">Original amount · {formatEur(safeTotal)}</p>
      </div>
    </section>
  );
}

export function LoanPaymentTimeline({ data }: { data: MonthlyPayment[] }) {
  const chartData = useMemo(
    () => data.map((entry) => ({ ...entry, amount: asNumber(entry.amount) })).filter((entry) => entry.amount > 0),
    [data]
  );
  const average = chartData.length
    ? chartData.reduce((sum, entry) => sum + entry.amount, 0) / chartData.length
    : 0;

  return (
    <section className="card data-viz min-w-0 space-y-4 p-4 sm:p-5">
      <div>
        <p className="page-kicker">Cadence</p>
        <h3 className="mt-1 text-xl">Payments by month</h3>
        <p className="mt-1 text-sm text-slate-500">Monthly payments with the running average marked in coral.</p>
      </div>
      {!chartData.length ? (
        <FigureEmpty>No monthly payments recorded yet.</FigureEmpty>
      ) : (
        <div className="chart-plot h-[18rem] min-w-0 p-2" role="img" aria-label="Loan payments by month area chart">
          <SafeResponsiveContainer minHeight={260}>
            <AreaChart data={chartData} margin={{ top: 16, right: 14, bottom: 4, left: 2 }}>
              <defs>
                <linearGradient id="loanPaymentArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="2 7" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={axisTick} minTickGap={18} />
              <YAxis width={54} axisLine={false} tickLine={false} tick={axisTick} tickFormatter={(value) => formatEurAxis(asNumber(value))} />
              <Tooltip
                formatter={(value) => [formatEur(asNumber(value)), "Paid"]}
                contentStyle={tooltipStyle}
                labelStyle={{ color: "var(--foreground)", fontWeight: 700 }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <ReferenceLine
                y={average}
                stroke="var(--coral)"
                strokeDasharray="4 5"
                label={{ value: `Avg ${formatEurAxis(average)}`, position: "insideTopRight", fill: "var(--foreground-muted)", fontSize: 10 }}
              />
              <Area
                type="monotone"
                dataKey="amount"
                name="Paid"
                stroke="var(--accent)"
                strokeWidth={3}
                fill="url(#loanPaymentArea)"
                activeDot={{ r: 5, fill: "var(--coral)", stroke: "var(--surface)", strokeWidth: 2 }}
              />
            </AreaChart>
          </SafeResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export function LoanMemberFigure({ data }: { data: MemberPayment[] }) {
  const chartData = useMemo(
    () => data
      .map((entry) => ({ ...entry, amount: asNumber(entry.amount) }))
      .filter((entry) => entry.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    [data]
  );
  const chartHeight = Math.min(340, Math.max(230, chartData.length * 60));

  return (
    <section className="card data-viz min-w-0 space-y-4 p-4 sm:p-5">
      <div>
        <p className="page-kicker">Contributors</p>
        <h3 className="mt-1 text-xl">Payments by member</h3>
        <p className="mt-1 text-sm text-slate-500">A direct ranking instead of a rainbow of unrelated colours.</p>
      </div>
      {!chartData.length ? (
        <FigureEmpty>No member payments recorded yet.</FigureEmpty>
      ) : (
        <div className="chart-plot min-w-0 p-2" style={{ height: chartHeight + 20 }} role="img" aria-label="Loan payments by member horizontal bar chart">
          <SafeResponsiveContainer minHeight={chartHeight}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 74, bottom: 8, left: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray="2 7" />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="member" width={100} axisLine={false} tickLine={false} tick={{ ...axisTick, fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: "color-mix(in srgb, var(--foreground) 5%, transparent)" }}
                formatter={(value) => [formatEur(asNumber(value)), "Paid"]}
                contentStyle={tooltipStyle}
                labelStyle={{ color: "var(--foreground)", fontWeight: 700 }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <Bar dataKey="amount" fill="var(--accent)" radius={[0, 5, 5, 0]} maxBarSize={22}>
                <LabelList
                  dataKey="amount"
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
