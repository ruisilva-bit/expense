import { extractGoalMove } from "./goal-moves";

export type BalanceTimelineRow = {
  id: string;
  bank_account_id: string;
  amount: number | string | null;
  type: string | null;
  description: string | null;
  date: string | null;
  created_at: string | null;
};

export type TransferLookupRow = {
  id: string;
  source_account_id: string;
  dest_account_id: string;
};

export type TransferLookup = {
  sourceAccountId: string;
  destAccountId: string;
};

const TRANSFER_TAG_REGEX = /\[transfer:([0-9a-fA-F-]{36})(?::(source|dest))?\]/;

export const BALANCE_TIMELINE_REUSE_LIMIT = 1000;

export function extractTransferTag(description: string | null | undefined) {
  if (!description) return null;
  const match = description.match(TRANSFER_TAG_REGEX);
  if (!match?.[1]) return null;
  const side = match[2] === "source" || match[2] === "dest" ? match[2] : null;
  return { id: match[1], side };
}

export function inferTransferSideFromDescription(description: string | null | undefined) {
  if (!description) return null;
  const lower = description.toLowerCase();
  if (lower.includes("transfer to")) return "source" as const;
  if (lower.includes("transfer from")) return "dest" as const;
  return null;
}

export function transferSideFromType(value: string | null | undefined) {
  const kind = (value ?? "").toLowerCase();
  if (kind === "transfer_in") return "dest" as const;
  if (kind === "transfer_out") return "source" as const;
  return null;
}

export function normalizeTransactionType(value: string | null | undefined) {
  const kind = (value ?? "").toLowerCase();
  if (kind === "income") return "income" as const;
  if (kind === "expense") return "expense" as const;
  return "transfer" as const;
}

export function collectTransferIds(rows: Array<Pick<BalanceTimelineRow, "type" | "description">>) {
  return Array.from(
    new Set(
      rows
        .filter((row) => {
          const kind = (row.type ?? "").toLowerCase();
          return kind === "transfer" || kind === "transfer_in" || kind === "transfer_out";
        })
        .map((row) => extractTransferTag(row.description)?.id ?? null)
        .filter((id): id is string => Boolean(id))
    )
  );
}

export function buildTransferLookupMap(rows: TransferLookupRow[]) {
  return new Map<string, TransferLookup>(
    rows.map((transfer) => [
      transfer.id,
      {
        sourceAccountId: transfer.source_account_id,
        destAccountId: transfer.dest_account_id,
      },
    ])
  );
}

export function resolveTransferSide(
  row: Pick<BalanceTimelineRow, "type" | "description" | "bank_account_id">,
  transferById: Map<string, TransferLookup>
) {
  const transferTag = extractTransferTag(row.description);
  let transferSide = transferSideFromType(row.type) ?? transferTag?.side ?? null;
  if (!transferSide && transferTag?.id) {
    const transfer = transferById.get(transferTag.id);
    if (transfer) {
      if (row.bank_account_id === transfer.sourceAccountId) transferSide = "source";
      if (row.bank_account_id === transfer.destAccountId) transferSide = "dest";
    }
  }
  if (!transferSide) {
    transferSide = inferTransferSideFromDescription(row.description);
  }
  return transferSide;
}

export function transactionImpact(
  row: Pick<BalanceTimelineRow, "type" | "amount" | "description" | "bank_account_id">,
  transferById: Map<string, TransferLookup>
) {
  const amount = Number(row.amount ?? 0);
  const value = Number.isFinite(amount) ? amount : 0;
  const goalMove = extractGoalMove(row.description);
  if (goalMove?.moveType === "allocate") return -value;
  if (goalMove?.moveType === "release") return value;
  if (goalMove?.moveType === "spend") return -value;

  const normalizedType = normalizeTransactionType(row.type);
  if (normalizedType === "income") return value;
  if (normalizedType === "expense") return -value;

  const transferSide = resolveTransferSide(row, transferById);
  if (transferSide === "dest") return value;
  if (transferSide === "source") return -value;
  return 0;
}

export function buildBalanceAfterMapFromRows(input: {
  accountCurrentBalance: Map<string, number>;
  accountIds: string[];
  rows: BalanceTimelineRow[];
  transferById: Map<string, TransferLookup>;
}) {
  const map = new Map<string, number>();
  if (!input.accountIds.length || !input.rows.length) return map;

  const runningByAccount = new Map<string, number>();
  input.accountIds.forEach((accountId) => {
    runningByAccount.set(accountId, input.accountCurrentBalance.get(accountId) ?? 0);
  });

  input.rows.forEach((row) => {
    const running = runningByAccount.get(row.bank_account_id) ?? 0;
    map.set(row.id, running);
    const delta = transactionImpact(row, input.transferById);
    runningByAccount.set(row.bank_account_id, running - delta);
  });

  return map;
}

export function canReusePrefetchedBalanceTimeline(input: {
  hasUpperDateBound: boolean;
  fetchedRowCount: number;
  fetchLimit?: number;
}) {
  const fetchLimit = input.fetchLimit ?? BALANCE_TIMELINE_REUSE_LIMIT;
  return !input.hasUpperDateBound && input.fetchedRowCount < fetchLimit;
}
