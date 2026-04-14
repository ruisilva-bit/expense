"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Goal = {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
};

export function GoalCard({ goal }: { goal: Goal }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const pct = Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100));

  const contribute = async () => {
    if (!amount) return;
    setLoading(true);
    await supabaseBrowser()
      .from("goals")
      .update({ current_amount: goal.current_amount + Number(amount) })
      .eq("id", goal.id);
    setLoading(false);
    setAmount("");
    router.refresh();
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Goal</p>
          <h3 className="text-lg font-semibold">{goal.name}</h3>
        </div>
        <span className="text-sm text-slate-600">Target ${goal.target_amount.toFixed(2)}</span>
      </div>
      <div className="w-full h-2 rounded-full bg-sand-100 overflow-hidden">
        <div className="h-2 bg-emerald-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-slate-600">${goal.current_amount.toFixed(2)} saved ({pct}%)</p>
      <div className="flex gap-2">
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Add amount"
          className="input"
        />
        <button onClick={contribute} disabled={loading} className="btn btn-primary whitespace-nowrap">
          {loading ? "Updating..." : "Add"}
        </button>
      </div>
      {goal.deadline && <p className="text-xs text-slate-500">Deadline: {goal.deadline}</p>}
    </div>
  );
}
