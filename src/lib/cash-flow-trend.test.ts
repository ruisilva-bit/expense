import test from "node:test";
import assert from "node:assert/strict";

import { buildCashFlowTrend, getCashFlowGranularity } from "./cash-flow-trend";

test("getCashFlowGranularity uses calendar-month boundaries", () => {
  assert.equal(getCashFlowGranularity("2026-01-01", "2026-02-01"), "month");
  assert.equal(getCashFlowGranularity("2026-01-01", "2026-02-02"), "week");
  assert.equal(getCashFlowGranularity("2026-01-31", "2026-02-28"), "month");
  assert.equal(getCashFlowGranularity("2026-01-31", "2026-03-01"), "week");
  assert.equal(getCashFlowGranularity("2026-01-01", "2026-04-01"), "week");
  assert.equal(getCashFlowGranularity("2026-01-01", "2026-04-02"), "month");
});

test("buildCashFlowTrend shows a selected month as one monthly point", () => {
  const trend = buildCashFlowTrend({
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
    transactions: [
      { amount: 100, type: "income", date: "2026-07-01" },
      { amount: 25, type: "expense", date: "2026-07-03" },
    ],
  });

  assert.equal(trend.granularity, "month");
  assert.deepEqual(
    trend.data.map(({ periodStart, income, expense, net }) => ({ periodStart, income, expense, net })),
    [
      { periodStart: "2026-07-01", income: 100, expense: 25, net: 75 },
    ]
  );
});

test("buildCashFlowTrend creates Monday-based weekly buckets and clips edge labels", () => {
  const trend = buildCashFlowTrend({
    dateFrom: "2026-01-28",
    dateTo: "2026-03-20",
    transactions: [
      { amount: 10, type: "income", date: "2026-01-28" },
      { amount: 4, type: "expense", date: "2026-02-09" },
    ],
  });

  assert.equal(trend.granularity, "week");
  assert.equal(trend.data[0]?.periodStart, "2026-01-26");
  assert.equal(trend.data[0]?.period, "28 Jan–1 Feb");
  assert.equal(trend.data.at(-1)?.periodStart, "2026-03-16");
  assert.equal(trend.data.at(-1)?.period, "16–20 Mar");
  assert.equal(trend.data.length, 8);
  assert.equal(trend.data[2]?.expense, 4);
});

test("buildCashFlowTrend creates continuous monthly buckets for longer ranges", () => {
  const trend = buildCashFlowTrend({
    dateFrom: "2026-01-15",
    dateTo: "2026-05-02",
    transactions: [{ amount: 75, type: "income", date: "2026-03-10" }],
  });

  assert.equal(trend.granularity, "month");
  assert.deepEqual(
    trend.data.map(({ periodStart, income }) => ({ periodStart, income })),
    [
      { periodStart: "2026-01-01", income: 0 },
      { periodStart: "2026-02-01", income: 0 },
      { periodStart: "2026-03-01", income: 75 },
      { periodStart: "2026-04-01", income: 0 },
      { periodStart: "2026-05-01", income: 0 },
    ]
  );
});

test("buildCashFlowTrend counts account transfers once and applies goal movements", () => {
  const trend = buildCashFlowTrend({
    dateFrom: "2026-07-01",
    dateTo: "2026-07-01",
    transactions: [
      { amount: 100, type: "income", date: "2026-07-01" },
      { amount: 20, type: "expense", date: "2026-07-01" },
      { amount: 10, type: "transfer", transfer_side: "source", date: "2026-07-01" },
      { amount: 5, type: "transfer", transfer_side: "dest", date: "2026-07-01" },
      { amount: 7, type: "transfer", goal_move_type: "allocate", date: "2026-07-01" },
      { amount: 3, type: "transfer", goal_move_type: "release", date: "2026-07-01" },
    ],
  });

  assert.deepEqual(trend.data[0], {
    period: "Jul 26",
    periodStart: "2026-07-01",
    income: 98,
    expense: 20,
    net: 71,
  });
});

test("buildCashFlowTrend counts goal spending as an actual expense", () => {
  const trend = buildCashFlowTrend({
    dateFrom: "2026-07-01",
    dateTo: "2026-07-01",
    transactions: [{ amount: 12, type: "expense", goal_move_type: "spend", date: "2026-07-01" }],
  });

  assert.equal(trend.data[0]?.expense, 12);
  assert.equal(trend.data[0]?.net, -12);
});

test("buildCashFlowTrend derives the range from transaction dates for All", () => {
  const trend = buildCashFlowTrend({
    transactions: [
      { amount: 1, type: "income", date: "2026-01-10" },
      { amount: 1, type: "expense", date: "2026-06-10" },
    ],
  });

  assert.equal(trend.granularity, "month");
  assert.equal(trend.dateFrom, "2026-01-10");
  assert.equal(trend.dateTo, "2026-06-10");
  assert.equal(trend.data.length, 6);
});
