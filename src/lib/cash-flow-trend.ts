import {
  addFinancialTransaction,
  calculateNetBalance,
  calculateTotalReceived,
  createEmptyFinancialTotals,
} from "./financial-totals";

export type CashFlowGranularity = "week" | "month";

export type CashFlowTransaction = {
  amount: number | string | null;
  type: "income" | "expense" | "transfer";
  date: string | null;
  transfer_side?: "source" | "dest" | null;
  goal_move_type?: "allocate" | "release" | "spend" | null;
  description?: string | null;
};

export type CashFlowDatum = {
  period: string;
  periodStart: string;
  income: number;
  expense: number;
  net: number;
};

export type CashFlowTrend = {
  granularity: CashFlowGranularity;
  dateFrom: string | null;
  dateTo: string | null;
  data: CashFlowDatum[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const parseIsoDate = (value: string | null | undefined) => {
  const isoDate = value?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate ? null : parsed;
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const addMonthsClamped = (date: Date, months: number) => {
  const targetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(
      targetMonth.getUTCFullYear(),
      targetMonth.getUTCMonth(),
      Math.min(date.getUTCDate(), lastDay)
    )
  );
};

const startOfWeek = (date: Date) => {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
};

const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const formatDay = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const formatMonth = (date: Date) =>
  date.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

const formatWeek = (dateFrom: Date, dateTo: Date) => {
  if (dateFrom.getTime() === dateTo.getTime()) return formatDay(dateFrom);
  if (
    dateFrom.getUTCFullYear() === dateTo.getUTCFullYear() &&
    dateFrom.getUTCMonth() === dateTo.getUTCMonth()
  ) {
    return `${dateFrom.getUTCDate()}–${formatDay(dateTo)}`;
  }
  return `${formatDay(dateFrom)}–${formatDay(dateTo)}`;
};

const resolveRange = (
  transactions: CashFlowTransaction[],
  dateFrom: string | undefined,
  dateTo: string | undefined
) => {
  const transactionDates = transactions
    .map((transaction) => parseIsoDate(transaction.date))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  const explicitFrom = parseIsoDate(dateFrom);
  const explicitTo = parseIsoDate(dateTo);
  const from = explicitFrom ?? transactionDates[0] ?? explicitTo ?? null;
  const to = explicitTo ?? transactionDates[transactionDates.length - 1] ?? explicitFrom ?? null;

  if (!from || !to || from.getTime() > to.getTime()) return null;
  return { from, to };
};

export function getCashFlowGranularity(dateFrom: string, dateTo: string): CashFlowGranularity {
  const from = parseIsoDate(dateFrom);
  const to = parseIsoDate(dateTo);
  if (!from || !to || from.getTime() > to.getTime()) return "month";
  if (to.getTime() <= addMonthsClamped(from, 1).getTime()) return "month";
  if (to.getTime() <= addMonthsClamped(from, 3).getTime()) return "week";
  return "month";
}

const bucketKeyForDate = (date: Date, granularity: CashFlowGranularity) => {
  if (granularity === "week") return toIsoDate(startOfWeek(date));
  return toIsoDate(startOfMonth(date));
};

const buildEmptyBuckets = (from: Date, to: Date, granularity: CashFlowGranularity) => {
  const buckets = new Map<string, { period: string; totals: ReturnType<typeof createEmptyFinancialTotals> }>();

  if (granularity === "week") {
    for (let cursor = startOfWeek(from); cursor.getTime() <= to.getTime(); cursor = addDays(cursor, 7)) {
      const visibleFrom = cursor.getTime() < from.getTime() ? from : cursor;
      const weekEnd = addDays(cursor, 6);
      const visibleTo = weekEnd.getTime() > to.getTime() ? to : weekEnd;
      buckets.set(toIsoDate(cursor), {
        period: formatWeek(visibleFrom, visibleTo),
        totals: createEmptyFinancialTotals(),
      });
    }
    return buckets;
  }

  for (
    let cursor = startOfMonth(from);
    cursor.getTime() <= to.getTime();
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  ) {
    buckets.set(toIsoDate(cursor), { period: formatMonth(cursor), totals: createEmptyFinancialTotals() });
  }
  return buckets;
};

export function buildCashFlowTrend(input: {
  transactions: CashFlowTransaction[];
  dateFrom?: string;
  dateTo?: string;
}): CashFlowTrend {
  const range = resolveRange(input.transactions, input.dateFrom, input.dateTo);
  if (!range) {
    return { granularity: "month", dateFrom: null, dateTo: null, data: [] };
  }

  const dateFrom = toIsoDate(range.from);
  const dateTo = toIsoDate(range.to);
  const granularity = getCashFlowGranularity(dateFrom, dateTo);
  const buckets = buildEmptyBuckets(range.from, range.to, granularity);

  input.transactions.forEach((transaction) => {
    const date = parseIsoDate(transaction.date);
    if (!date || date.getTime() < range.from.getTime() || date.getTime() > range.to.getTime()) return;
    const bucket = buckets.get(bucketKeyForDate(date, granularity));
    if (!bucket) return;

    addFinancialTransaction(bucket.totals, transaction);
  });

  const data = Array.from(buckets.entries()).map(([periodStart, bucket]) => {
    const income = calculateTotalReceived(bucket.totals);
    const expense = bucket.totals.spent;
    const net = calculateNetBalance(bucket.totals);
    return { period: bucket.period, periodStart, income, expense, net };
  });

  return { granularity, dateFrom, dateTo, data };
}
