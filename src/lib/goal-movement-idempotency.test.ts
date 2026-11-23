import test from "node:test";
import assert from "node:assert/strict";

import {
  PendingGoalMovementConflictError,
  clearGoalMovementOperation,
  getOrCreateGoalMovementOperation,
  goalMovementStorageKey,
  normalizeIdempotencyKey,
  readPendingGoalMovementOperation,
  type GoalMovementIdentity,
} from "./goal-movement-idempotency";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const FIRST_OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_OPERATION_ID = "987e6543-e21b-43d3-b456-426614174111";
const NOW = 1_800_000_000_000;

const movement: GoalMovementIdentity = {
  goalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  moveType: "allocate",
  amount: 12.34,
  date: "2026-08-13",
  description: "  Fundo de emergência  ",
};

test("normalizeIdempotencyKey accepts UUID v4 only", () => {
  assert.equal(normalizeIdempotencyKey(` ${FIRST_OPERATION_ID.toUpperCase()} `), FIRST_OPERATION_ID);
  assert.equal(normalizeIdempotencyKey("123e4567-e89b-12d3-a456-426614174000"), null);
  assert.equal(normalizeIdempotencyKey("not-a-uuid"), null);
});

test("a refresh reuses the persisted operation for the same movement", () => {
  const storage = new MemoryStorage();
  const storageKey = goalMovementStorageKey("FAMILY", movement.goalId);

  const first = getOrCreateGoalMovementOperation({
    storage,
    storageKey,
    movement,
    createOperationId: () => FIRST_OPERATION_ID,
    now: NOW,
  });
  const afterRefresh = getOrCreateGoalMovementOperation({
    storage,
    storageKey,
    movement: { ...movement, description: "Fundo de emergência" },
    createOperationId: () => {
      throw new Error("must not create another operation");
    },
    now: NOW + 1_000,
  });

  assert.deepEqual(first, { operationId: FIRST_OPERATION_ID, reused: false });
  assert.deepEqual(afterRefresh, { operationId: FIRST_OPERATION_ID, reused: true });
});

test("different data cannot reuse a still-pending operation", () => {
  const storage = new MemoryStorage();
  const storageKey = goalMovementStorageKey("family", movement.goalId);
  getOrCreateGoalMovementOperation({
    storage,
    storageKey,
    movement,
    createOperationId: () => FIRST_OPERATION_ID,
    now: NOW,
  });

  assert.throws(
    () =>
      getOrCreateGoalMovementOperation({
        storage,
        storageKey,
        movement: { ...movement, amount: 12.35 },
        createOperationId: () => SECOND_OPERATION_ID,
        now: NOW + 1,
      }),
    PendingGoalMovementConflictError
  );
});

test("stale or corrupt pending operations are discarded", () => {
  const storage = new MemoryStorage();
  const storageKey = "pending";
  storage.setItem(
    storageKey,
    JSON.stringify({
      operationId: FIRST_OPERATION_ID,
      fingerprint: "tampered",
      createdAt: NOW,
      movement,
    })
  );

  assert.equal(readPendingGoalMovementOperation({ storage, storageKey, now: NOW + 1 }), null);
  const replacement = getOrCreateGoalMovementOperation({
    storage,
    storageKey,
    movement,
    createOperationId: () => SECOND_OPERATION_ID,
    now: NOW + 2,
  });
  assert.deepEqual(replacement, { operationId: SECOND_OPERATION_ID, reused: false });
});

test("completion clears only the matching operation", () => {
  const storage = new MemoryStorage();
  const storageKey = "pending";
  getOrCreateGoalMovementOperation({
    storage,
    storageKey,
    movement,
    createOperationId: () => FIRST_OPERATION_ID,
    now: NOW,
  });

  clearGoalMovementOperation({ storage, storageKey, operationId: SECOND_OPERATION_ID });
  assert.equal(
    readPendingGoalMovementOperation({ storage, storageKey, now: NOW + 1 })?.operationId,
    FIRST_OPERATION_ID
  );

  clearGoalMovementOperation({ storage, storageKey, operationId: FIRST_OPERATION_ID });
  assert.equal(readPendingGoalMovementOperation({ storage, storageKey, now: NOW + 1 }), null);
});
