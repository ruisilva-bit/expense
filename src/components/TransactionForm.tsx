"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

const defaultCategories = ["food", "rent", "transport", "entertainment", "utilities", "health", "other"];

type Props = { accountId: string; onCreated?: () => void };

export function TransactionForm({ accountId, onCreated }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    amount: "",
    type: "expense" as "expense" | "income",
    category: "food",
    description: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabaseBrowser().from("transactions").insert({
      account_id: accountId,
      amount: Number(form.amount),
      type: form.type,
      category: form.category,
      description: form.description,
      date: form.date,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setError(null);
      setForm({ ...form, amount: "", description: "" });
      router.refresh();
      onCreated?.();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Amount</label>
          <input required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" placeholder="0.00" />
        </div>
        <div>
          <label className="label">Type</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "expense" | "income" })} className="input">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Category</label>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input">
            {defaultCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" />
        </div>
      </div>
      <div>
        <label className="label">Description</label>
        <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" placeholder="Optional" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="btn btn-primary w-full">{loading ? "Saving..." : "Save"}</button>
    </form>
  );
}
