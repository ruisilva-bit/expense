"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };

type Props = { accounts: Option[] };

export function GoalForm({ accounts }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", target: "", account_id: "", deadline: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabaseBrowser().from("goals").insert({
      name: form.name,
      target_amount: Number(form.target),
      current_amount: 0,
      account_id: form.account_id || null,
      deadline: form.deadline || null,
    });
    setLoading(false);
    if (error) setError(error.message);
    else {
      setError(null);
      setForm({ name: "", target: "", account_id: "", deadline: "" });
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Savings</p>
          <h3 className="text-lg font-semibold">Create goal</h3>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label className="label">Target</label>
          <input className="input" type="number" step="0.01" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} required />
        </div>
        <div>
          <label className="label">Account (optional)</label>
          <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">Personal</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Deadline</label>
          <input className="input" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="btn btn-primary w-full">{loading ? "Saving..." : "Save goal"}</button>
    </form>
  );
}
