export type FinancialTransactionType = "income" | "expense" | "transfer";
export type FinancialGoalMoveType = "allocate" | "release" | "spend";

export type FinancialTransaction = {
  amount: number | string | null | undefined;
  type: FinancialTransactionType;
  transfer_side?: "source" | "dest" | null;
  goal_move_type?: FinancialGoalMoveType | null;
  description?: string | null;
};

export type FinancialTotals = {
  income: number;
  spent: number;
  accountTransferOut: number;
  accountTransferIn: number;
  goalTransferOut: number;
  goalTransferIn: number;
};

export const createEmptyFinancialTotals = (): FinancialTotals => ({
  income: 0,
  spent: 0,
  accountTransferOut: 0,
  accountTransferIn: 0,
  goalTransferOut: 0,
  goalTransferIn: 0,
});

export const inferAccountTransferSide = (
  transaction: Pick<FinancialTransaction, "transfer_side" | "description">
) => {
  if (transaction.transfer_side === "source" || transaction.transfer_side === "dest") {
    return transaction.transfer_side;
  }

  const description = (transaction.description ?? "").toLowerCase();
  if (description.includes("transfer to")) return "source" as const;
  if (description.includes("transfer from")) return "dest" as const;
  return null;
};

export const addFinancialTransaction = (
  totals: FinancialTotals,
  transaction: FinancialTransaction
): FinancialTotals => {
  const amount = Number(transaction.amount ?? 0);
  if (!Number.isFinite(amount)) return totals;

  if (transaction.goal_move_type === "spend" || transaction.type === "expense") {
    totals.spent += amount;
    return totals;
  }

  if (transaction.type === "income") {
    totals.income += amount;
    return totals;
  }

  if (transaction.type !== "transfer") return totals;

  if (transaction.goal_move_type === "allocate") {
    totals.goalTransferOut += amount;
  } else if (transaction.goal_move_type === "release") {
    totals.goalTransferIn += amount;
  } else {
    const side = inferAccountTransferSide(transaction);
    if (side === "source") totals.accountTransferOut += amount;
    if (side === "dest") totals.accountTransferIn += amount;
  }

  return totals;
};

export const sumFinancialTransactions = (
  transactions: readonly FinancialTransaction[]
): FinancialTotals => transactions.reduce(addFinancialTransaction, createEmptyFinancialTotals());

export const calculateTotalReceived = (totals: FinancialTotals) =>
  totals.income - totals.accountTransferOut + totals.accountTransferIn + totals.goalTransferIn;

export const calculateNetBalance = (totals: FinancialTotals) =>
  calculateTotalReceived(totals) - totals.spent - totals.goalTransferOut;
