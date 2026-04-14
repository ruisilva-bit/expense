"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };

export function LoanForm({ accounts }: { accounts: Option[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", total: "", monthly: "", account_id: accounts[0]?.id ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabaseBrowser().from("loans").insert({
      account_id: form.account_id,
      name: form.name,
      total_amount: Number(form.total),
      monthly_payment: Number(form.monthly),
    });
    setLoading(false);
    if (error) setError(error.message);
    else {
      setError(null);
      setForm({ ...form, name: "", total: "", monthly: "" });
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Loans</p>
          <h3 className="text-lg font-semibold">Add shared loan</h3>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Account</label>
          <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label className="label">Total amount</label>
          <input className="input" type="number" step="0.01" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} required />
        </div>
        <div>
          <label className="label">Monthly payment</label>
          <input className="input" type="number" step="0.01" value={form.monthly} onChange={(e) => setForm({ ...form, monthly: e.target.value })} required />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="btn btn-primary w-full">{loading ? "Saving..." : "Save loan"}</button>
    </form>
  );
}
