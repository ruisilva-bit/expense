import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateGoalMovementState,
  classifyMoneyState,
  fromMoneyCents,
  toMoneyCents,
} from "./goal-movement-state";

test("money conversion and allocation stay exact in cents", () => {
  assert.equal(toMoneyCents(12.345), 1235);
  assert.equal(fromMoneyCents(1235), 12.35);

  assert.deepEqual(
    calculateGoalMovementState({
      moveType: "allocate",
      amount: 0.1,
      currentGoalAmount: 0.2,
      currentAccountBalance: 10.1,
    }),
    {
      amountCents: 10,
      goalBeforeCents: 20,
      goalAfterCents: 30,
      accountBeforeCents: 1010,
      accountAfterCents: 1000,
      loanBeforeCents: null,
      loanAfterCents: null,
    }
  );
});

test("release returns money to the linked account", () => {
  const state = calculateGoalMovementState({
    moveType: "release",
    amount: 20,
    currentGoalAmount: 75,
    currentAccountBalance: 100,
  });

  assert.equal(state.goalAfterCents, 5_500);
  assert.equal(state.accountAfterCents, 12_000);
});

test("goal spend reduces goal, account, and applicable loan", () => {
  const state = calculateGoalMovementState({
    moveType: "spend",
    amount: 30,
    currentGoalAmount: 75,
    currentAccountBalance: 100,
    currentLoanRemaining: 20,
  });

  assert.equal(state.goalAfterCents, 4_500);
  assert.equal(state.accountAfterCents, 7_000);
  assert.equal(state.loanAfterCents, 0);
});

test("release and spend cannot exceed the goal balance", () => {
  assert.throws(
    () =>
      calculateGoalMovementState({
        moveType: "release",
        amount: 10.01,
        currentGoalAmount: 10,
        currentAccountBalance: 100,
      }),
    /saldo suficiente/
  );
});

test("reconciliation classifies rounded monetary state", () => {
  assert.equal(classifyMoneyState(10.0001, 1_000, 900), "pending");
  assert.equal(classifyMoneyState(9.0001, 1_000, 900), "applied");
  assert.equal(classifyMoneyState(9.5, 1_000, 900), "conflict");
});
