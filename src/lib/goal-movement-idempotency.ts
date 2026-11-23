export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PENDING_OPERATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type GoalMovementType = "allocate" | "release" | "spend";

export type GoalMovementIdentity = {
  goalId: string;
  moveType: GoalMovementType;
  amount: number;
  date: string;
  description?: string | null;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PendingGoalMovement = {
  operationId: string;
  fingerprint: string;
  createdAt: number;
  movement: GoalMovementIdentity;
};

export class PendingGoalMovementConflictError extends Error {
  constructor(public readonly operationId: string) {
    super("Existe um movimento anterior ainda por confirmar. Repete os mesmos dados para concluir essa operação.");
    this.name = "PendingGoalMovementConflictError";
  }
}

export function goalMovementStorageKey(familyId: string, goalId: string) {
  return `homefund:goal-movement:${familyId.trim().toLowerCase()}:${goalId.trim().toLowerCase()}`;
}

export function normalizeIdempotencyKey(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return UUID_REGEX.test(normalized) ? normalized : null;
}

export function goalMovementFingerprint(input: GoalMovementIdentity) {
  return JSON.stringify([
    input.goalId.trim().toLowerCase(),
    input.moveType,
    Math.round(input.amount * 100),
    input.date.slice(0, 10),
    input.description?.trim() ?? "",
  ]);
}

export function readPendingGoalMovementOperation(input: {
  storage: StorageLike;
  storageKey: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const rawPending = input.storage.getItem(input.storageKey);
  if (!rawPending) return null;

  try {
    const pending = JSON.parse(rawPending) as Partial<PendingGoalMovement>;
    const operationId = normalizeIdempotencyKey(pending.operationId);
    const movement = pending.movement;
    const isFresh =
      typeof pending.createdAt === "number" &&
      pending.createdAt <= now &&
      now - pending.createdAt <= PENDING_OPERATION_MAX_AGE_MS;
    const hasValidMovement =
      movement &&
      typeof movement.goalId === "string" &&
      (movement.moveType === "allocate" || movement.moveType === "release" || movement.moveType === "spend") &&
      typeof movement.amount === "number" &&
      Number.isFinite(movement.amount) &&
      typeof movement.date === "string" &&
      (movement.description === undefined || movement.description === null || typeof movement.description === "string");

    if (!operationId || !isFresh || !hasValidMovement) {
      input.storage.removeItem(input.storageKey);
      return null;
    }

    const normalizedMovement: GoalMovementIdentity = {
      goalId: movement.goalId,
      moveType: movement.moveType,
      amount: movement.amount,
      date: movement.date,
      description: movement.description?.trim() || null,
    };
    if (pending.fingerprint !== goalMovementFingerprint(normalizedMovement)) {
      input.storage.removeItem(input.storageKey);
      return null;
    }

    return { operationId, movement: normalizedMovement, createdAt: pending.createdAt };
  } catch {
    input.storage.removeItem(input.storageKey);
    return null;
  }
}

export function getOrCreateGoalMovementOperation(input: {
  storage: StorageLike;
  storageKey: string;
  movement: GoalMovementIdentity;
  createOperationId: () => string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const fingerprint = goalMovementFingerprint(input.movement);
  const pendingOperation = readPendingGoalMovementOperation({
    storage: input.storage,
    storageKey: input.storageKey,
    now,
  });

  if (pendingOperation) {
    if (goalMovementFingerprint(pendingOperation.movement) === fingerprint) {
      return { operationId: pendingOperation.operationId, reused: true };
    }
    throw new PendingGoalMovementConflictError(pendingOperation.operationId);
  }

  const operationId = normalizeIdempotencyKey(input.createOperationId());
  if (!operationId) {
    throw new Error("Could not create a valid operation identifier.");
  }

  const pending: PendingGoalMovement = {
    operationId,
    fingerprint,
    createdAt: now,
    movement: {
      ...input.movement,
      description: input.movement.description?.trim() || null,
    },
  };
  input.storage.setItem(input.storageKey, JSON.stringify(pending));
  return { operationId, reused: false };
}

export function clearGoalMovementOperation(input: {
  storage: StorageLike;
  storageKey: string;
  operationId: string;
}) {
  const rawPending = input.storage.getItem(input.storageKey);
  if (!rawPending) return;

  try {
    const pending = JSON.parse(rawPending) as Partial<PendingGoalMovement>;
    if (normalizeIdempotencyKey(pending.operationId) !== normalizeIdempotencyKey(input.operationId)) return;
  } catch {
    return;
  }

  input.storage.removeItem(input.storageKey);
}
