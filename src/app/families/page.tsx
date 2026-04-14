"use client";
import { AppNav } from "@/components/AppNav";
import { useAppState } from "@/context/AppState";
import { supabaseBrowser } from "@/lib/supabase-browser";
import useSWR from "swr";

const fetcher = async (key: string) => {
  const supabase = supabaseBrowser();
  if (key.startsWith("families-page:")) {
    const userId = key.split(":")[1];
    if (!userId) return [];

    const membersRes = await supabase
      .from("family_members")
      .select("family_id, role")
      .eq("user_id", userId);
    if (membersRes.error) throw membersRes.error;

    const members = membersRes.data ?? [];
    if (!members.length) return [];

    const familyIds = members.map((m) => m.family_id);
    const familiesRes = await supabase.from("families").select("id,name").in("id", familyIds);
    if (familiesRes.error) throw familiesRes.error;
    const byId = new Map((familiesRes.data ?? []).map((f) => [f.id, f.name]));

    return members.map((m) => ({
      family_id: m.family_id,
      role: m.role,
      family: { name: byId.get(m.family_id) ?? "Family" },
    }));
  }
  return [];
};

export default function FamiliesPage() {
  const { user, setSelectedFamily } = useAppState();
  const { data: memberships, error: membershipsError, mutate } = useSWR(
    user?.id ? `families-page:${user.id}` : null,
    fetcher
  );
  const supabase = supabaseBrowser();

  const createFamily = async (formData: FormData) => {
    try {
      const name = String(formData.get("name") || "My family").trim();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        alert("You need to be logged in.");
        return;
      }

      const { data: familyRow, error: familyError } = await supabase
        .from("families")
        .insert({ name })
        .select("id,name")
        .single();

      if (familyError || !familyRow) {
        alert(familyError?.message || "Could not create family.");
        return;
      }

      const { error: memberError } = await supabase.from("family_members").insert({
        family_id: familyRow.id,
        user_id: authData.user.id,
        name: authData.user.email ?? "You",
        role: "owner",
      });

      if (memberError) {
        alert(memberError.message);
        return;
      }

      setSelectedFamily({ id: familyRow.id, name: familyRow.name });
      await mutate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create family.");
    }
  };

  const addMember = async (formData: FormData) => {
    const familyId = String(formData.get("family_id"));
    const name = String(formData.get("name") || "Member");
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    // service role not available here; just insert fictitious member
    const payload = { family_id: familyId, name, role: "member" };
    const { error } = await supabase.from("family_members").insert(payload);
    if (error) alert(error.message);
    mutate();
  };

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Families</p>
            <h1 className="text-2xl font-semibold">Manage households</h1>
          </div>
        </div>
        {membershipsError && (
          <div className="card p-3 text-sm text-red-700 bg-red-50 border-red-200">
            Could not load families: {membershipsError.message}
          </div>
        )}

        <form action={createFamily} className="card p-4 space-y-3">
          <p className="text-sm text-slate-600">Create family</p>
          <input name="name" className="input" placeholder="Family name" required />
          <button className="btn btn-primary w-fit">Create</button>
        </form>

        <div className="grid gap-4 sm:grid-cols-2">
          {memberships?.map((m: { family_id: string; role: string; family: { name: string } }) => (
            <div key={m.family_id} className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">{m.role}</p>
                  <h3 className="text-lg font-semibold">{m.family?.name ?? "Family"}</h3>
                </div>
                <button
                  className="text-emerald-700 text-sm"
                  onClick={() => {
                    setSelectedFamily({ id: m.family_id, name: m.family?.name ?? "Family" });
                  }}
                >
                  Enter
                </button>
              </div>
              <form action={addMember} className="space-y-2">
                <input type="hidden" name="family_id" value={m.family_id} />
                <input name="name" className="input" placeholder="Member name" required />
                <input name="email" className="input" placeholder="Email (optional)" />
                <button className="btn btn-primary w-full" type="submit">Add member</button>
              </form>
            </div>
          ))}
          {!memberships?.length && <div className="card p-4">No families yet.</div>}
        </div>
      </main>
    </div>
  );
}
