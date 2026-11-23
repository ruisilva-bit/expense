"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { useAppState } from "@/context/AppState";
import { ClientFetchError, fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import { formatEur } from "@/lib/format";
import {
  clearGoalMovementOperation,
  getOrCreateGoalMovementOperation,
  goalMovementStorageKey,
  readPendingGoalMovementOperation,
  type GoalMovementIdentity,
} from "@/lib/goal-movement-idempotency";

type Goal = {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  bank_account_id: string | null;
};

type Account = {
  id: string;
  name: string;
  balance: number;
};

type GoalPayload = { goals: Goal[] };
type GoalMoveType = "allocate" | "release";

type GoalDraft = {
  name: string;
  target_amount: string;
  current_amount: string;
  deadline: string;
  bank_account_id: string;
};

type MovementDraft = {
  type: GoalMoveType;
  amount: string;
  date: string;
  description: string;
};

const EMPTY_GOAL_DRAFT: GoalDraft = {
  name: "",
  target_amount: "",
  current_amount: "0",
  deadline: "",
  bank_account_id: "",
};

const buildEmptyGoalDraft = (defaultAccountId = ""): GoalDraft => ({
  ...EMPTY_GOAL_DRAFT,
  bank_account_id: defaultAccountId,
});

const buildGoalDraft = (goal: Goal): GoalDraft => ({
  name: goal.name,
  target_amount: String(goal.target_amount || ""),
  current_amount: String(goal.current_amount || 0),
  deadline: goal.deadline ?? "",
  bank_account_id: goal.bank_account_id ?? "",
});

const buildMovementDraft = (type: GoalMoveType): MovementDraft => ({
  type,
  amount: "",
  date: new Date().toISOString().slice(0, 10),
  description: "",
});

const parseMoney = (value: string) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
};

const goalProgress = (goal: Goal) => {
  const target = Math.max(0, Number(goal.target_amount ?? 0));
  const current = Math.max(0, Number(goal.current_amount ?? 0));
  if (!target) return 0;
  return Math.min(100, Math.round((current / target) * 100));
};

const daysUntil = (deadline: string | null) => {
  if (!deadline) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${deadline}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};

const deadlineLabel = (deadline: string | null) => {
  const days = daysUntil(deadline);
  if (days === null) return "Sem prazo";
  if (days < 0) return `${Math.abs(days)} dias em atraso`;
  if (days === 0) return "Termina hoje";
  return `Faltam ${days} dia${days === 1 ? "" : "s"}`;
};

export default function GoalsPage() {
  const { selectedFamily, accounts, refresh } = useAppState();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<GoalDraft>(EMPTY_GOAL_DRAFT);
  const [activeGoal, setActiveGoal] = useState<Goal | null>(null);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editingDraft, setEditingDraft] = useState<GoalDraft>(EMPTY_GOAL_DRAFT);
  const [movementGoal, setMovementGoal] = useState<Goal | null>(null);
  const [movementDraft, setMovementDraft] = useState<MovementDraft>(buildMovementDraft("allocate"));
  const [isMovementSaving, setIsMovementSaving] = useState(false);
  const [resumingMovement, setResumingMovement] = useState(false);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const resumingOperationIds = useRef(new Set<string>());
  const movementSubmitLock = useRef(false);

  const { data, error, isLoading, mutate } = useSWR(
    selectedFamily ? `goals:${selectedFamily.id}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      return fetchClientJson<GoalPayload>(`/api/goals?familyId=${encodeURIComponent(selectedFamily!.id)}`, {
        method: "GET",
        headers,
      });
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const goals = useMemo(() => data?.goals ?? [], [data?.goals]);
  const accountOptions = accounts as Account[];
  const accountById = useMemo(() => new Map(accountOptions.map((account) => [account.id, account])), [accountOptions]);

  const totals = useMemo(() => {
    const reserved = goals.reduce((sum, goal) => sum + Number(goal.current_amount ?? 0), 0);
    return { reserved, count: goals.length };
  }, [goals]);

  const sortedGoals = useMemo(
    () =>
      [...goals].sort((a, b) => {
        const deadlineA = a.deadline ?? "9999-12-31";
        const deadlineB = b.deadline ?? "9999-12-31";
        if (deadlineA !== deadlineB) return deadlineA.localeCompare(deadlineB);
        return a.name.localeCompare(b.name);
      }),
    [goals]
  );

  const resetCreate = () => {
    setCreateDraft(buildEmptyGoalDraft(accountOptions[0]?.id ?? ""));
    setErrorMessage(null);
  };

  const openCreate = () => {
    resetCreate();
    setIsCreateOpen(true);
  };

  const saveGoal = async (input: {
    goalId?: string;
    name: string;
    target_amount: number;
    current_amount: number;
    deadline: string | null;
    bank_account_id: string;
  }) => {
    const headers = await getClientAuthHeaders();
    const response = await fetchClientJson<{ goal: Goal }>("/api/goals", {
      method: input.goalId ? "PATCH" : "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(
        input.goalId
          ? {
              goalId: input.goalId,
              name: input.name,
              target_amount: input.target_amount,
              current_amount: input.current_amount,
              deadline: input.deadline,
              bank_account_id: input.bank_account_id,
            }
          : {
              familyId: selectedFamily?.id,
              name: input.name,
              target_amount: input.target_amount,
              current_amount: input.current_amount,
              deadline: input.deadline,
              bank_account_id: input.bank_account_id,
            }
      ),
    });

    await mutate();
    refresh();
    return response.goal;
  };

  const createGoal = async () => {
    const name = createDraft.name.trim();
    const target = parseMoney(createDraft.target_amount);
    const current = parseMoney(createDraft.current_amount);
    const accountId = createDraft.bank_account_id;
    if (!name || !accountId || target <= 0) {
      setErrorMessage("Preenche o nome, a conta e o objetivo de poupança.");
      return;
    }

    try {
      await saveGoal({
        name,
        target_amount: target,
        current_amount: current,
        deadline: createDraft.deadline || null,
        bank_account_id: accountId,
      });
      setIsCreateOpen(false);
      resetCreate();
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "Não foi possível criar a poupança.");
    }
  };

  const updateGoal = async () => {
    if (!editingGoal) return;
    const name = editingDraft.name.trim();
    const target = parseMoney(editingDraft.target_amount);
    const current = parseMoney(editingDraft.current_amount);
    const accountId = editingDraft.bank_account_id;
    if (!name || !accountId || target <= 0) {
      setErrorMessage("Preenche o nome, a conta e o objetivo de poupança.");
      return;
    }

    try {
      await saveGoal({
        goalId: editingGoal.id,
        name,
        target_amount: target,
        current_amount: current,
        deadline: editingDraft.deadline || null,
        bank_account_id: accountId,
      });
      setEditingGoal(null);
      setEditingDraft(EMPTY_GOAL_DRAFT);
      setErrorMessage(null);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "Não foi possível atualizar a poupança.");
    }
  };

  const deleteGoal = async (goalId: string) => {
    const headers = await getClientAuthHeaders();
    await fetchClientJson<{ success: true }>("/api/goals", {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ goalId }),
    });
    await mutate();
    refresh();
  };

  const openMovement = (goal: Goal, type: GoalMoveType) => {
    setMovementGoal(goal);
    setMovementDraft(buildMovementDraft(type));
    setErrorMessage(null);
  };

  const submitMovementRequest = useCallback(
    async (input: {
      goalId: string;
      movement: GoalMovementIdentity;
      operationId: string;
      storageKey: string;
    }) => {
      const headers = await getClientAuthHeaders();
      const response = await fetchClientJson<{ goal: Goal; replayed?: boolean }>("/api/goals", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.operationId,
          ...headers,
        },
        body: JSON.stringify({
          goalId: input.goalId,
          movement_type: input.movement.moveType,
          movement_amount: input.movement.amount,
          movement_description: input.movement.description?.trim() || null,
          movement_date: input.movement.date,
        }),
      });

      await mutate(
        (current: GoalPayload | undefined) =>
          current
            ? {
                goals: current.goals.map((goal: Goal) => (goal.id === response.goal.id ? response.goal : goal)),
              }
            : current,
        { revalidate: false }
      );
      clearGoalMovementOperation({
        storage: window.localStorage,
        storageKey: input.storageKey,
        operationId: input.operationId,
      });
      refresh();
      return response;
    },
    [mutate, refresh]
  );

  useEffect(() => {
    if (!selectedFamily?.id || !goals.length || typeof window === "undefined") return;

    goals.forEach((goal: Goal) => {
      const storageKey = goalMovementStorageKey(selectedFamily.id, goal.id);
      const pending = readPendingGoalMovementOperation({
        storage: window.localStorage,
        storageKey,
      });
      if (!pending || resumingOperationIds.current.has(pending.operationId)) return;

      resumingOperationIds.current.add(pending.operationId);
      setResumingMovement(true);
      void submitMovementRequest({
        goalId: goal.id,
        movement: pending.movement,
        operationId: pending.operationId,
        storageKey,
      })
        .catch((resumeError: unknown) => {
          if (
            resumeError instanceof ClientFetchError &&
            [400, 403, 404, 409].includes(resumeError.status)
          ) {
            clearGoalMovementOperation({
              storage: window.localStorage,
              storageKey,
              operationId: pending.operationId,
            });
          }
          setErrorMessage(
            resumeError instanceof Error
              ? `Não foi possível confirmar o movimento pendente: ${resumeError.message}`
              : "Não foi possível confirmar o movimento pendente."
          );
        })
        .finally(() => {
          resumingOperationIds.current.delete(pending.operationId);
          setResumingMovement(resumingOperationIds.current.size > 0);
        });
    });
  }, [goals, selectedFamily?.id, submitMovementRequest]);

  const applyMovement = async () => {
    if (!movementGoal || !selectedFamily || isMovementSaving || movementSubmitLock.current) return;
    const amount = parseMoney(movementDraft.amount);
    if (amount <= 0) {
      setErrorMessage("Indica um valor válido.");
      return;
    }
    if (movementDraft.type === "release" && amount > Number(movementGoal.current_amount ?? 0)) {
      setErrorMessage("A poupança não tem saldo suficiente para esse levantamento.");
      return;
    }

    const movement: GoalMovementIdentity = {
      goalId: movementGoal.id,
      moveType: movementDraft.type,
      amount,
      date: movementDraft.date,
      description: movementDraft.description.trim() || null,
    };
    const storageKey = goalMovementStorageKey(selectedFamily.id, movementGoal.id);

    try {
      movementSubmitLock.current = true;
      setIsMovementSaving(true);
      setErrorMessage(null);
      const operation = getOrCreateGoalMovementOperation({
        storage: window.localStorage,
        storageKey,
        movement,
        createOperationId: () => crypto.randomUUID(),
      });
      await submitMovementRequest({
        goalId: movementGoal.id,
        movement,
        operationId: operation.operationId,
        storageKey,
      });
      setMovementGoal(null);
      setMovementDraft(buildMovementDraft("allocate"));
    } catch (saveError) {
      if (saveError instanceof ClientFetchError && [400, 403, 404, 409].includes(saveError.status)) {
        const pending = readPendingGoalMovementOperation({ storage: window.localStorage, storageKey });
        if (pending) {
          clearGoalMovementOperation({
            storage: window.localStorage,
            storageKey,
            operationId: pending.operationId,
          });
        }
      }
      setErrorMessage(
        saveError instanceof Error
          ? saveError.message
          : "Não foi possível atualizar a poupança. Podes tentar novamente sem risco de duplicar."
      );
    } finally {
      movementSubmitLock.current = false;
      setIsMovementSaving(false);
    }
  };

  return (
    <div className="min-h-screen app-shell">
      <AppNav />
      <main className="app-main page-goals max-w-6xl space-y-8">
        <div className="page-header">
          <div>
            <p className="page-kicker">Savings</p>
            <h1 className="page-title">Your savings</h1>
            <p className="page-subtitle">See the money you have already set aside, organised by purpose.</p>
          </div>
          <button
            type="button"
            className="btn btn-primary page-action"
            onClick={openCreate}
            disabled={!accountOptions.length || resumingMovement}
          >
            <span aria-hidden="true">+</span>
            New saving
          </button>
        </div>

        {(error || errorMessage) && (
          <div className="card border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error ? `Não foi possível carregar as poupanças: ${error.message}` : errorMessage}
          </div>
        )}

        {resumingMovement && (
          <div
            className="card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
            role="status"
            aria-live="polite"
          >
            A confirmar um movimento pendente. Não voltes a submeter enquanto esta mensagem estiver visível.
          </div>
        )}

        {!selectedFamily && <div className="card p-4 text-slate-700">Escolhe primeiro a família onde queres gerir as poupanças.</div>}

        {selectedFamily && (
          <>
            <section className="goal-summary grid gap-4 sm:grid-cols-2">
              <div className="card rounded-[24px] p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total saved</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{formatEur(totals.reserved)}</p>
              </div>
              <div className="card rounded-[24px] p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Savings pots</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{totals.count}</p>
              </div>
            </section>

            {isLoading && <div className="card rounded-[24px] p-4 text-sm text-slate-500">A carregar poupanças...</div>}
            {!isLoading && !sortedGoals.length && <div className="card rounded-[24px] p-6 text-sm text-slate-500">Ainda não tens poupanças.</div>}

            <section className="ledger-gallery grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sortedGoals.map((goal) => {
                const progress = goalProgress(goal);
                return (
                  <button
                    key={goal.id}
                    type="button"
                    className="card goal-card flex h-full w-full flex-col gap-4 p-5 text-left transition"
                    onClick={() => {
                      setActiveGoal(goal);
                      setErrorMessage(null);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold text-slate-900">{goal.name}</h2>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{progress}%</span>
                    </div>

                    <div>
                      <p className="text-sm text-slate-500">Disponível</p>
                      <p className="mt-1 text-2xl font-semibold text-slate-900">{formatEur(goal.current_amount)}</p>
                    </div>

                    <div className="mt-auto space-y-2">
                      <div className="goal-progress h-2 overflow-hidden bg-slate-100">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-sm text-slate-500">
                        <span>{deadlineLabel(goal.deadline)}</span>
                        <span>{formatEur(goal.target_amount)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </section>


          </>
        )}
      </main>

      <AppDialog
        open={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          setErrorMessage(null);
        }}
        title="New saving"
        subtitle={selectedFamily?.name ?? "Savings"}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createGoal();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Nome</span>
            <input
              className="input"
              placeholder="Ex.: Seguro do carro"
              value={createDraft.name}
              onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Conta associada</span>
              <select
                className="input"
                value={createDraft.bank_account_id}
                onChange={(event) => setCreateDraft((current) => ({ ...current, bank_account_id: event.target.value }))}
                required
              >
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Deadline</span>
              <input
                className="input"
                type="date"
                value={createDraft.deadline}
                onChange={(event) => setCreateDraft((current) => ({ ...current, deadline: event.target.value }))}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Savings target (€)</span>
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={createDraft.target_amount}
                onChange={(event) => setCreateDraft((current) => ({ ...current, target_amount: event.target.value }))}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Valor atual (€)</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={createDraft.current_amount}
                onChange={(event) => setCreateDraft((current) => ({ ...current, current_amount: event.target.value }))}
              />
            </label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Create saving
            </button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={Boolean(activeGoal)}
        onClose={() => setActiveGoal(null)}
        title={activeGoal?.name ?? "Saving"}
        subtitle={activeGoal?.bank_account_id ? accountById.get(activeGoal.bank_account_id)?.name ?? "Conta" : "Conta"}
      >
        <div className="space-y-4">
          <div className="rounded-[24px] bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Disponível</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatEur(Number(activeGoal?.current_amount ?? 0))}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-[24px] bg-slate-50 p-4 text-sm">
            <div>
              <p className="text-slate-500">Target</p>
              <p className="font-semibold text-slate-900">{formatEur(Number(activeGoal?.target_amount ?? 0))}</p>
            </div>
            <div>
              <p className="text-slate-500">Deadline</p>
              <p className="font-semibold text-slate-900">{activeGoal?.deadline ?? "Sem prazo"}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:bg-emerald-100"
              onClick={() => {
                if (!activeGoal) return;
                openMovement(activeGoal, "allocate");
                setActiveGoal(null);
              }}
            >
              <p className="text-sm font-semibold text-emerald-800">Adicionar dinheiro</p>
            </button>
            <button
              type="button"
              className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left transition hover:bg-rose-100"
              onClick={() => {
                if (!activeGoal) return;
                openMovement(activeGoal, "release");
                setActiveGoal(null);
              }}
            >
              <p className="text-sm font-semibold text-rose-800">Retirar dinheiro</p>
            </button>
            <button
              type="button"
              className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:bg-slate-50"
              onClick={() => {
                if (!activeGoal) return;
                setEditingGoal(activeGoal);
                setEditingDraft(buildGoalDraft(activeGoal));
                setActiveGoal(null);
              }}
            >
              <p className="text-sm font-semibold text-slate-900">Editar</p>
            </button>
            <button
              type="button"
              className="rounded-2xl border border-red-200 bg-red-50 p-4 text-left transition hover:bg-red-100"
              onClick={() => {
                if (!activeGoal) return;
                setDeletingGoal(activeGoal);
                setActiveGoal(null);
              }}
            >
              <p className="text-sm font-semibold text-red-700">Eliminar</p>
            </button>
          </div>
        </div>
      </AppDialog>

      <AppDialog
        open={Boolean(editingGoal)}
        onClose={() => {
          setEditingGoal(null);
          setErrorMessage(null);
        }}
        title="Edit saving"
        subtitle={editingGoal?.name ?? "Saving"}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void updateGoal();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Nome</span>
            <input
              className="input"
              value={editingDraft.name}
              onChange={(event) => setEditingDraft((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Conta associada</span>
              <select
                className="input"
                value={editingDraft.bank_account_id}
                onChange={(event) => setEditingDraft((current) => ({ ...current, bank_account_id: event.target.value }))}
                required
              >
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Deadline</span>
              <input
                className="input"
                type="date"
                value={editingDraft.deadline}
                onChange={(event) => setEditingDraft((current) => ({ ...current, deadline: event.target.value }))}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Savings target (€)</span>
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={editingDraft.target_amount}
                onChange={(event) => setEditingDraft((current) => ({ ...current, target_amount: event.target.value }))}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Valor atual (€)</span>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={editingDraft.current_amount}
                onChange={(event) => setEditingDraft((current) => ({ ...current, current_amount: event.target.value }))}
              />
            </label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingGoal(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Guardar alterações
            </button>
          </div>
        </form>
      </AppDialog>

      <AppDialog
        open={Boolean(movementGoal)}
        onClose={() => {
          if (isMovementSaving) return;
          setMovementGoal(null);
          setErrorMessage(null);
        }}
        title={movementDraft.type === "allocate" ? "Add money to savings" : "Withdraw from savings"}
        subtitle={movementGoal?.name ?? "Saving"}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void applyMovement();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Atual</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{formatEur(Number(movementGoal?.current_amount ?? 0))}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Movimento</p>
              <p className={`mt-1 text-lg font-semibold ${movementDraft.type === "allocate" ? "text-emerald-700" : "text-rose-700"}`}>
                {movementDraft.type === "allocate" ? "+" : "-"}
                {formatEur(parseMoney(movementDraft.amount))}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-900 p-3 text-white">
              <p className="text-xs uppercase tracking-wide text-white/60">Novo total</p>
              <p className="mt-1 text-lg font-semibold">
                {formatEur(
                  Math.max(
                    0,
                    Number(movementGoal?.current_amount ?? 0) +
                      (movementDraft.type === "allocate" ? parseMoney(movementDraft.amount) : -parseMoney(movementDraft.amount))
                  )
                )}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Valor (€)</span>
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                value={movementDraft.amount}
                onChange={(event) => setMovementDraft((current) => ({ ...current, amount: event.target.value }))}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Data</span>
              <input
                className="input"
                type="date"
                value={movementDraft.date}
                onChange={(event) => setMovementDraft((current) => ({ ...current, date: event.target.value }))}
                required
              />
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Nota (opcional)</span>
            <input
              className="input"
              placeholder={movementDraft.type === "allocate" ? "Ex.: Reforço da poupança" : "Ex.: Levantamento da poupança"}
              value={movementDraft.description}
              onChange={(event) => setMovementDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn btn-ghost border border-slate-200"
              onClick={() => setMovementGoal(null)}
              disabled={isMovementSaving}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isMovementSaving} aria-busy={isMovementSaving}>
              {isMovementSaving
                ? "A guardar com segurança..."
                : movementDraft.type === "allocate"
                  ? "Adicionar"
                  : "Retirar"}
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingGoal)}
        onClose={() => setDeletingGoal(null)}
        title="Delete saving"
        description={`Delete the saving "${deletingGoal?.name ?? ""}"?`}
        confirmLabel="Apagar"
        destructive
        onConfirm={async () => {
          if (!deletingGoal) return;
          await deleteGoal(deletingGoal.id);
          setDeletingGoal(null);
        }}
      />
    </div>
  );
}
