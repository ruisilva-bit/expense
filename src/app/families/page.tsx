"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { EntityPopover } from "@/components/EntityPopover";
import { useAppState } from "@/context/AppState";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";

type Family = { id: string; name: string; role?: string | null };
type FamilyMember = {
  id: string;
  user_id: string | null;
  email?: string | null;
  name: string;
  role: "owner" | "member" | null;
  kind?: "human" | "system" | null;
  is_api_user?: boolean;
};

export default function FamiliesPage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberRole, setNewMemberRole] = useState<"owner" | "member">("member");
  const [newMemberKind, setNewMemberKind] = useState<"human" | "system">("human");
  const [newSystemPassword, setNewSystemPassword] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);
  const [membersVersion, setMembersVersion] = useState(0);
  const [editingFamily, setEditingFamily] = useState<Family | null>(null);
  const [editingFamilyName, setEditingFamilyName] = useState("");
  const [deletingFamily, setDeletingFamily] = useState<Family | null>(null);
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null);
  const [editingMemberName, setEditingMemberName] = useState("");
  const [editingMemberEmail, setEditingMemberEmail] = useState("");
  const [editingMemberRole, setEditingMemberRole] = useState<"owner" | "member">("member");
  const [editingMemberKind, setEditingMemberKind] = useState<"human" | "system">("human");
  const [editingMemberPassword, setEditingMemberPassword] = useState("");
  const [deletingMember, setDeletingMember] = useState<FamilyMember | null>(null);
  const {
    user,
    families,
    familiesError,
    selectedFamily,
    setSelectedFamily,
    isAuthLoading,
    isFamiliesLoading,
    refreshFamilies,
  } = useAppState();

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.replace("/login");
    }
  }, [isAuthLoading, router, user]);

  const activeFamily = useMemo(
    () => (families.find((family) => family.id === activeFamilyId) as Family | undefined) ?? null,
    [families, activeFamilyId]
  );

  const { data: membersData, error: membersError, mutate: mutateMembers, isLoading: isMembersLoading } = useSWR(
    activeFamily ? `family-members:${activeFamily.id}:${membersVersion}` : null,
    async () => {
      const headers = await getClientAuthHeaders();
      const payload = await fetchClientJson<{ members: FamilyMember[] }>(
        `/api/family-members?familyId=${encodeURIComponent(activeFamily!.id)}`,
        { method: "GET", headers }
      );
      return payload.members ?? [];
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  const handleCreateFamily = async (formData: FormData) => {
    const name = String(formData.get("name") || "My family").trim();
    if (!name) {
      setCreateError("Please choose a family name.");
      return;
    }

    setCreateError(null);
    setIsCreating(true);

    try {
      const headers = await getClientAuthHeaders();
      const response = await fetch("/api/families", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        family?: { id: string; name: string; role?: string | null };
        error?: string;
        warning?: string;
      };

      if (!response.ok || !payload.family) {
        setCreateError(payload.error ?? "Could not create family.");
        return;
      }

      setSelectedFamily(payload.family);
      setActiveFamilyId(payload.family.id);
      refreshFamilies();
      if (payload.warning) {
        setCreateError(payload.warning);
      }
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create family.");
    } finally {
      setIsCreating(false);
    }
  };

  const renameFamily = async (familyId: string, nextName: string) => {
    if (!nextName.trim()) return;
    setCreateError(null);
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ family: { id: string; name: string } }>("/api/families", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ familyId, name: nextName.trim() }),
      });
      refreshFamilies();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not update family.");
    }
  };

  const removeFamily = async (familyId: string) => {
    setCreateError(null);
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ success: true }>("/api/families", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ familyId }),
      });

      if (selectedFamily?.id === familyId) {
        setSelectedFamily(null);
      }
      refreshFamilies();
      return true;
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not delete family.");
      return false;
    }
  };

  const addMember = async (formData: FormData) => {
    if (!activeFamily) return;
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const roleValue = String(formData.get("role") || "member").trim().toLowerCase();
    const role: "owner" | "member" = roleValue === "owner" ? "owner" : "member";

    if (!name) {
      setMemberError("Please add at least a name.");
      return;
    }

    setMemberError(null);
    setIsAddingMember(true);
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ member: FamilyMember }>("/api/family-members", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          familyId: activeFamily.id,
          name,
          email,
          role,
          kind: newMemberKind,
          password: newMemberKind === "system" ? String(formData.get("password") || "").trim() : undefined,
        }),
      });
      setMembersVersion((value) => value + 1);
      refreshFamilies();
      void mutateMembers();
      setNewMemberRole("member");
      setNewMemberKind("human");
      setNewSystemPassword("");
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : "Could not add member.");
    } finally {
      setIsAddingMember(false);
    }
  };

  const updateMember = async (
    memberId: string,
    nextName: string,
    nextEmail: string,
    nextRole: "owner" | "member",
    nextKind: "human" | "system",
    nextPassword?: string
  ) => {
    if (!activeFamily || activeFamily.role !== "owner") return;
    if (!nextName.trim()) return;
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ member: FamilyMember }>("/api/family-members", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          memberId,
          name: nextName.trim(),
          email: nextEmail.trim() || null,
          role: nextRole,
          password: nextKind === "system" ? nextPassword?.trim() || null : null,
        }),
      });
      void mutateMembers();
      refreshFamilies();
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : "Could not update member.");
    }
  };

  const removeMember = async (memberId: string) => {
    if (!activeFamily || activeFamily.role !== "owner") return;
    try {
      const headers = await getClientAuthHeaders();
      await fetchClientJson<{ success: true }>("/api/family-members", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ memberId }),
      });
      void mutateMembers();
      refreshFamilies();
    } catch (error) {
      setMemberError(error instanceof Error ? error.message : "Could not remove member.");
    }
  };

  const isLoading = isAuthLoading || isFamiliesLoading;
  const isApiUser = (member: FamilyMember) => member.is_api_user === true || member.kind === "system";
  const humanMembers = (membersData ?? []).filter((member) => !isApiUser(member));
  const apiUsers = (membersData ?? []).filter((member) => isApiUser(member));

  return (
    <div className="min-h-screen app-shell">
      <AppNav />
      <main className="app-main page-families max-w-5xl space-y-8">
        <div className="page-header">
          <div>
            <p className="page-kicker">Family</p>
            <h1 className="page-title">The people behind the numbers</h1>
            <p className="page-subtitle">
              {user?.email ? `Signed in as ${user.email}` : "Checking your session..."}
            </p>
          </div>
        </div>

        <form action={handleCreateFamily} className="card editorial-form space-y-3 p-4">
          <p className="text-sm text-slate-600">Create family</p>
          <input name="name" className="input" placeholder="Family name" required />
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button className="btn btn-primary w-fit" type="submit" disabled={isCreating || isAuthLoading}>
            {isCreating ? "Creating..." : "Create"}
          </button>
        </form>

        {familiesError && (
          <div className="card border-red-200 bg-red-50 p-3 text-sm text-red-700">Could not load families: {familiesError}</div>
        )}

        {isLoading && (
          <div className="space-y-3">
            {[0, 1].map((key) => (
              <div key={key} className="card flex items-center justify-between px-4 py-3">
                <div className="space-y-2">
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                  <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
                </div>
                <div className="h-4 w-12 animate-pulse rounded bg-slate-200" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && (
          <section className="ledger-selector-list space-y-3">
            {families.map((family) => (
              <button
                key={family.id}
                type="button"
                className={`card flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:border-emerald-300 ${
                  selectedFamily?.id === family.id ? "border-emerald-500" : ""
                }`}
                onClick={() => setActiveFamilyId(family.id)}
              >
                <div>
                  <p className="text-sm text-slate-500">{family.role ?? "member"}</p>
                  <p className="text-lg font-semibold">{family.name}</p>
                </div>
                {selectedFamily?.id === family.id && <span className="text-xs font-medium text-emerald-700">Selected</span>}
              </button>
            ))}

            {!families.length && (
              <div className="card p-4">
                <p className="font-medium">No families yet.</p>
                <p className="mt-1 text-sm text-slate-500">
                  Create your first family to start organising accounts and expenses.
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      {activeFamily && (
        <EntityPopover
          title={activeFamily.name}
          subtitle={activeFamily.role === "owner" ? "Owner" : "Member"}
          onClose={() => setActiveFamilyId(null)}
        >
          <section className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSelectedFamily({ id: activeFamily.id, name: activeFamily.name, role: activeFamily.role });
                setActiveFamilyId(null);
              }}
            >
              Select family
            </button>
            <button
              type="button"
              className="btn btn-ghost border border-slate-200"
              disabled={activeFamily.role !== "owner"}
              onClick={() => {
                setEditingFamily(activeFamily);
                setEditingFamilyName(activeFamily.name);
              }}
            >
              Edit family
            </button>
            <button
              type="button"
              className="btn btn-ghost border border-red-200 text-red-600 hover:bg-red-50"
              disabled={activeFamily.role !== "owner"}
              onClick={() => {
                setDeletingFamily(activeFamily);
              }}
            >
              Delete family
            </button>
          </section>

          {activeFamily.role !== "owner" && (
            <p className="text-xs text-slate-500">Only owners can edit or delete this family.</p>
          )}

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">People & API users</h3>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-2.5 py-1">{humanMembers.length} membros</span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">{apiUsers.length} API</span>
              </div>
            </div>
            {membersError && <p className="text-sm text-red-600">Could not load members: {membersError.message}</p>}
            {memberError && <p className="text-sm text-red-600">{memberError}</p>}
            {isMembersLoading && <div className="card p-3 text-sm text-slate-500">Loading members...</div>}
            {!isMembersLoading && !(membersData ?? []).length && (
              <div className="card p-3 text-sm text-slate-500">No members yet.</div>
            )}

            {!!humanMembers.length && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Members</h4>
                  <p className="text-xs text-slate-400">Dashboard users e membros fictícios</p>
                </div>
                <ul className="card divide-y divide-slate-200 px-4">
                  {humanMembers.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium text-slate-900">{member.name}</p>
                        <p className="text-xs text-slate-500">{member.role ?? "member"}</p>
                        <p className="text-xs text-slate-500">
                          {member.email ? member.email : member.user_id ? "Linked user" : "Fictitious member"}
                        </p>
                      </div>
                      {activeFamily.role === "owner" && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost px-3 py-1.5 text-xs"
                            onClick={() => {
                              setEditingMember(member);
                              setEditingMemberName(member.name);
                              setEditingMemberEmail(member.email ?? "");
                              setEditingMemberRole(member.role === "owner" ? "owner" : "member");
                              setEditingMemberKind(member.kind === "system" ? "system" : "human");
                              setEditingMemberPassword("");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost px-3 py-1.5 text-xs text-red-600"
                            onClick={() => {
                              setDeletingMember(member);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">API users</h4>
                <p className="text-xs text-slate-400">Acesso programático / integrações</p>
              </div>
              {!apiUsers.length ? (
                <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">
                  Ainda não tens utilizadores de API nesta família.
                </div>
              ) : (
                <ul className="card divide-y divide-slate-200 px-4">
                  {apiUsers.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">{member.name}</p>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">API</span>
                        </div>
                        <p className="text-xs text-slate-500">{member.role ?? "member"}</p>
                        <p className="text-xs text-slate-500">{member.email ?? "Sem email"}</p>
                      </div>
                      {activeFamily.role === "owner" && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost px-3 py-1.5 text-xs"
                            onClick={() => {
                              setEditingMember(member);
                              setEditingMemberName(member.name);
                              setEditingMemberEmail(member.email ?? "");
                              setEditingMemberRole(member.role === "owner" ? "owner" : "member");
                              setEditingMemberKind("system");
                              setEditingMemberPassword("");
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost px-3 py-1.5 text-xs text-red-600"
                            onClick={() => {
                              setDeletingMember(member);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {activeFamily.role === "owner" && (
            <form action={addMember} className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">Add member</p>
                  <p className="text-xs text-slate-500">
                    Cria um membro humano para o dashboard ou um utilizador técnico para integrações via API.
                  </p>
                </div>
                <div className="flex rounded-full bg-slate-100 p-1 text-xs font-medium">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1 transition ${newMemberKind === "human" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
                    onClick={() => setNewMemberKind("human")}
                  >
                    Humano
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1 transition ${newMemberKind === "system" ? "bg-emerald-700 text-white shadow-sm" : "text-slate-500"}`}
                    onClick={() => setNewMemberKind("system")}
                  >
                    API
                  </button>
                </div>
              </div>

              {newMemberKind === "system" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  Este utilizador serve para chamadas API e integrações. Não aparece como pessoa normal no dashboard nem pode ser atribuído a despesas/receitas.
                </div>
              )}

              <input name="name" className="input" placeholder={newMemberKind === "system" ? "Nome do utilizador API" : "Nome do membro"} required />
              <input
                name="email"
                type="email"
                className="input"
                placeholder={newMemberKind === "system" ? "api-user@email.com" : "Email (opcional para utilizadores reais)"}
                required={newMemberKind === "system"}
              />
              {newMemberKind === "system" && (
                <input
                  name="password"
                  type="password"
                  className="input"
                  placeholder="Password para autenticação API"
                  minLength={8}
                  required
                  value={newSystemPassword}
                  onChange={(event) => setNewSystemPassword(event.target.value)}
                />
              )}
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Role</span>
                <select
                  name="role"
                  className="input"
                  value={newMemberRole}
                  onChange={(event) => setNewMemberRole(event.target.value === "owner" ? "owner" : "member")}
                >
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
              </label>
              <button className="btn btn-primary w-full" type="submit" disabled={isAddingMember}>
                {isAddingMember ? "Saving..." : newMemberKind === "system" ? "Criar utilizador API" : "Add member"}
              </button>
            </form>
          )}
        </EntityPopover>
      )}

      <AppDialog
        open={Boolean(editingFamily)}
        onClose={() => setEditingFamily(null)}
        title="Edit family"
        subtitle="Household settings"
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingFamily) return;
            void (async () => {
              await renameFamily(editingFamily.id, editingFamilyName);
              setEditingFamily(null);
              if (activeFamilyId === editingFamily.id) {
                setActiveFamilyId(editingFamily.id);
              }
            })();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Family name</span>
            <input
              className="input"
              value={editingFamilyName}
              onChange={(event) => setEditingFamilyName(event.target.value)}
              placeholder="Family name"
              required
            />
          </label>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingFamily(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingFamily)}
        title="Delete family"
        description={`Delete "${deletingFamily?.name ?? "this family"}" and all related data? This cannot be undone.`}
        confirmLabel="Delete family"
        destructive
        onClose={() => setDeletingFamily(null)}
        onConfirm={() => {
          if (!deletingFamily) return;
          void (async () => {
            const deleted = await removeFamily(deletingFamily.id);
            if (deleted && activeFamilyId === deletingFamily.id) setActiveFamilyId(null);
            setDeletingFamily(null);
          })();
        }}
      />

      <AppDialog
        open={Boolean(editingMember)}
        onClose={() => setEditingMember(null)}
        title="Edit member"
        subtitle={editingMemberKind === "system" ? "API system user" : "Family member"}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingMember) return;
            void (async () => {
              await updateMember(editingMember.id, editingMemberName, editingMemberEmail, editingMemberRole, editingMemberKind, editingMemberPassword);
              setEditingMember(null);
            })();
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Display name</span>
            <input
              className="input"
              value={editingMemberName}
              onChange={(event) => setEditingMemberName(event.target.value)}
              placeholder="Member name"
              required
            />
          </label>
          {editingMemberKind === "system" && (
            <label className="space-y-1">
              <span className="text-xs font-medium text-slate-600">Rotate password (optional)</span>
              <input
                className="input"
                type="password"
                minLength={8}
                value={editingMemberPassword}
                onChange={(event) => setEditingMemberPassword(event.target.value)}
                placeholder="Leave blank to keep current password"
              />
            </label>
          )}
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">{editingMemberKind === "system" ? "System login email" : "Email (optional)"}</span>
            <input
              className="input"
              type="email"
              value={editingMemberEmail}
              onChange={(event) => setEditingMemberEmail(event.target.value)}
              placeholder={editingMemberKind === "system" ? "api-user@email.com" : "member@email.com"}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Role</span>
            <select
              className="input"
              value={editingMemberRole}
              onChange={(event) => setEditingMemberRole(event.target.value === "owner" ? "owner" : "member")}
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setEditingMember(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </AppDialog>

      <ConfirmDialog
        open={Boolean(deletingMember)}
        title="Remove member"
        description={`Remove "${deletingMember?.name ?? "this member"}" from this family?`}
        confirmLabel="Remove member"
        destructive
        onClose={() => setDeletingMember(null)}
        onConfirm={() => {
          if (!deletingMember) return;
          void (async () => {
            await removeMember(deletingMember.id);
            setDeletingMember(null);
          })();
        }}
      />
    </div>
  );
}
