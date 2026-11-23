import type { GoalMoveType } from "@/lib/goal-moves";

const MONEY_SCALE = 100;

export const toMoneyCents = (value: number) => Math.round(value * MONEY_SCALE);
export const fromMoneyCents = (value: number) => value / MONEY_SCALE;

export function calculateGoalMovementState(input: {
  moveType: GoalMoveType;
  amount: number;
  currentGoalAmount: number;
  currentAccountBalance: number;
  baseGoalAmount?: number;
  currentLoanRemaining?: number | null;
}) {
  const amountCents = toMoneyCents(input.amount);
  const goalBeforeCents = toMoneyCents(input.currentGoalAmount);
  const baseGoalCents = toMoneyCents(input.baseGoalAmount ?? input.currentGoalAmount);
  const accountBeforeCents = toMoneyCents(input.currentAccountBalance);

  if (amountCents <= 0) throw new Error("Movement amount must be greater than zero.");
  if ((input.moveType === "release" || input.moveType === "spend") && amountCents > baseGoalCents) {
    throw new Error("O goal não tem saldo suficiente para esse movimento.");
  }

  const goalDirection = input.moveType === "allocate" ? 1 : -1;
  const accountDirection = input.moveType === "release" ? 1 : -1;
  const goalAfterCents = baseGoalCents + goalDirection * amountCents;
  const accountAfterCents = accountBeforeCents + accountDirection * amountCents;

  const loanBeforeCents =
    input.currentLoanRemaining === null || input.currentLoanRemaining === undefined
      ? null
      : toMoneyCents(input.currentLoanRemaining);
  const loanAfterCents =
    loanBeforeCents === null || input.moveType !== "spend"
      ? loanBeforeCents
      : Math.max(0, loanBeforeCents - amountCents);

  return {
    amountCents,
    goalBeforeCents,
    goalAfterCents,
    accountBeforeCents,
    accountAfterCents,
    loanBeforeCents,
    loanAfterCents,
  };
}

export function classifyMoneyState(actual: number, beforeCents: number, afterCents: number) {
  const actualCents = toMoneyCents(actual);
  if (actualCents === afterCents) return "applied" as const;
  if (actualCents === beforeCents) return "pending" as const;
  return "conflict" as const;
}
