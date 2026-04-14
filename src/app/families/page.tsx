"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { AppDialog, ConfirmDialog } from "@/components/AppDialog";
import { AppNav } from "@/components/AppNav";
import { EntityPopover } from "@/components/EntityPopover";
import { useAppState } from "@/context/AppState";
import { fetchClientJson, getClientAuthHeaders } from "@/lib/client-fetch";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Family = { id: string; name: string; role?: string | null };
type FamilyMember = {
  id: string;
  user_id: string | null;
  email?: string | null;
  name: string;
  role: "owner" | "member" | null;
};

export default function FamiliesPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [isCreating, setIsCreating] = useState(false);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [newMemberRole, setNewMemberRole] = useState<"owner" | "member">("member");
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch("/api/families", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
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
        body: JSON.stringify({ familyId: activeFamily.id, name, email, role }),
      });
      setMembersVersion((value) => value + 1);
      refreshFamilies();
      void mutateMembers();
      setNewMemberRole("member");
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
    nextRole: "owner" | "member"
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

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 lg:pl-64">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Family</p>
            <h1 className="text-2xl font-semibold">Manage households</h1>
            <p className="text-sm text-slate-500">
              {user?.email ? `Signed in as ${user.email}` : "Checking your session..."}
            </p>
          </div>
        </div>

        <form action={handleCreateFamily} className="card space-y-3 p-4">
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
          <section className="space-y-3">
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

          <section className="space-y-2">
            <h3 className="text-lg font-semibold">Members</h3>
            {membersError && <p className="text-sm text-red-600">Could not load members: {membersError.message}</p>}
            {memberError && <p className="text-sm text-red-600">{memberError}</p>}
            {isMembersLoading && <div className="card p-3 text-sm text-slate-500">Loading members...</div>}
            {!isMembersLoading && !(membersData ?? []).length && (
              <div className="card p-3 text-sm text-slate-500">No members yet.</div>
            )}
            {!!(membersData ?? []).length && (
              <ul className="card divide-y divide-slate-200 px-4">
                {(membersData ?? []).map((member) => (
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
          </section>

          {activeFamily.role === "owner" && (
            <form action={addMember} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-medium text-slate-700">Add member</p>
              <input name="name" className="input" placeholder="Member name" required />
              <input name="email" type="email" className="input" placeholder="Email (optional for real users)" />
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
                {isAddingMember ? "Saving..." : "Add member"}
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
        subtitle="Family member"
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!editingMember) return;
            void (async () => {
              await updateMember(editingMember.id, editingMemberName, editingMemberEmail, editingMemberRole);
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
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-600">Email (optional)</span>
            <input
              className="input"
              type="email"
              value={editingMemberEmail}
              onChange={(event) => setEditingMemberEmail(event.target.value)}
              placeholder="member@email.com"
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
