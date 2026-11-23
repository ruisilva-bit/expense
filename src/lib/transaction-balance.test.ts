import test from "node:test";
import assert from "node:assert/strict";

import {
  BALANCE_TIMELINE_REUSE_LIMIT,
  buildBalanceAfterMapFromRows,
  buildTransferLookupMap,
  canReusePrefetchedBalanceTimeline,
  collectTransferIds,
} from "./transaction-balance";

test("collectTransferIds deduplicates tagged transfer rows", () => {
  const ids = collectTransferIds([
    {
      type: "transfer",
      description: "Transfer to savings [transfer:11111111-1111-1111-1111-111111111111:source]",
    },
    {
      type: "transfer_in",
      description: "Transfer from checking [transfer:11111111-1111-1111-1111-111111111111:dest]",
    },
    {
      type: "expense",
      description: "Groceries",
    },
  ]);

  assert.deepEqual(ids, ["11111111-1111-1111-1111-111111111111"]);
});

test("buildBalanceAfterMapFromRows replays mixed activity from current balances", () => {
  const transferById = buildTransferLookupMap([
    {
      id: "11111111-1111-1111-1111-111111111111",
      source_account_id: "checking",
      dest_account_id: "savings",
    },
  ]);

  const balanceAfter = buildBalanceAfterMapFromRows({
    accountCurrentBalance: new Map([
      ["checking", 1250],
      ["savings", 430],
    ]),
    accountIds: ["checking", "savings"],
    rows: [
      {
        id: "goal-release",
        bank_account_id: "checking",
        amount: 40,
        type: "transfer",
        description: "Release rainy day [goal:22222222-2222-2222-2222-222222222222] [goal-move:release]",
        date: "2026-07-10",
        created_at: "2026-07-10T10:00:00.000Z",
      },
      {
        id: "income",
        bank_account_id: "checking",
        amount: 100,
        type: "income",
        description: "Salary",
        date: "2026-07-09",
        created_at: "2026-07-09T10:00:00.000Z",
      },
      {
        id: "transfer-out",
        bank_account_id: "checking",
        amount: 50,
        type: "transfer_out",
        description: "Move to savings [transfer:11111111-1111-1111-1111-111111111111:source]",
        date: "2026-07-08",
        created_at: "2026-07-08T10:00:00.000Z",
      },
      {
        id: "transfer-in",
        bank_account_id: "savings",
        amount: 50,
        type: "transfer_in",
        description: "Move from checking [transfer:11111111-1111-1111-1111-111111111111:dest]",
        date: "2026-07-08",
        created_at: "2026-07-08T10:00:01.000Z",
      },
      {
        id: "expense",
        bank_account_id: "checking",
        amount: 25,
        type: "expense",
        description: "Groceries",
        date: "2026-07-07",
        created_at: "2026-07-07T10:00:00.000Z",
      },
      {
        id: "goal-allocate",
        bank_account_id: "savings",
        amount: 20,
        type: "transfer",
        description: "Save for holiday [goal:33333333-3333-3333-3333-333333333333] [goal-move:allocate]",
        date: "2026-07-06",
        created_at: "2026-07-06T10:00:00.000Z",
      },
    ],
    transferById,
  });

  assert.equal(balanceAfter.get("goal-release"), 1250);
  assert.equal(balanceAfter.get("income"), 1210);
  assert.equal(balanceAfter.get("transfer-out"), 1110);
  assert.equal(balanceAfter.get("transfer-in"), 430);
  assert.equal(balanceAfter.get("expense"), 1160);
  assert.equal(balanceAfter.get("goal-allocate"), 380);
});

test("canReusePrefetchedBalanceTimeline only allows fully-covered live ranges", () => {
  assert.equal(
    canReusePrefetchedBalanceTimeline({
      hasUpperDateBound: false,
      fetchedRowCount: BALANCE_TIMELINE_REUSE_LIMIT - 1,
    }),
    true
  );
  assert.equal(
    canReusePrefetchedBalanceTimeline({
      hasUpperDateBound: true,
      fetchedRowCount: 10,
    }),
    false
  );
  assert.equal(
    canReusePrefetchedBalanceTimeline({
      hasUpperDateBound: false,
      fetchedRowCount: BALANCE_TIMELINE_REUSE_LIMIT,
    }),
    false
  );
});
