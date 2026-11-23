import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateNetBalance,
  calculateTotalReceived,
  sumFinancialTransactions,
} from "./financial-totals";

test("account transfers affect net balance once and paired transfers cancel", () => {
  const totals = sumFinancialTransactions([
    { amount: 100, type: "income" },
    { amount: 20, type: "expense" },
    { amount: 25, type: "transfer", transfer_side: "source" },
    { amount: 25, type: "transfer", transfer_side: "dest" },
  ]);

  assert.equal(calculateTotalReceived(totals), 100);
  assert.equal(calculateNetBalance(totals), 80);
});

test("goal allocations and releases adjust available money once", () => {
  const totals = sumFinancialTransactions([
    { amount: 100, type: "income" },
    { amount: 20, type: "expense" },
    { amount: 10, type: "transfer", goal_move_type: "allocate" },
    { amount: 3, type: "transfer", goal_move_type: "release" },
  ]);

  assert.equal(calculateTotalReceived(totals), 103);
  assert.equal(calculateNetBalance(totals), 73);
});

test("goal spending is counted as a real expense, not an account transfer", () => {
  const totals = sumFinancialTransactions([
    { amount: 12, type: "transfer", goal_move_type: "spend" },
  ]);

  assert.equal(totals.spent, 12);
  assert.equal(totals.goalTransferOut, 0);
  assert.equal(calculateNetBalance(totals), -12);
});

test("legacy transfer descriptions still identify source and destination", () => {
  const totals = sumFinancialTransactions([
    { amount: 8, type: "transfer", description: "Transfer to savings" },
    { amount: 5, type: "transfer", description: "Transfer from savings" },
  ]);

  assert.equal(totals.accountTransferOut, 8);
  assert.equal(totals.accountTransferIn, 5);
  assert.equal(calculateNetBalance(totals), -3);
});
