import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { AppNav } from "@/components/AppNav";
import { GoalCard } from "@/components/GoalCard";
import { GoalForm } from "@/components/GoalForm";

type Goal = {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
};

export default async function GoalsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("account_members")
    .select("account:accounts(id,name)");

  const { data: goals } = await supabase
    .from("goals")
    .select("id, name, target_amount, current_amount, deadline")
    .order("deadline", { ascending: true, nullsLast: true });

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Goals</p>
            <h1 className="text-2xl font-semibold">Savings progress</h1>
          </div>
        </div>

        <GoalForm accounts={memberships?.map((m) => m.account) ?? []} />

        <div className="grid gap-4 sm:grid-cols-2">
          {goals?.map((goal) => (
            <GoalCard key={goal.id} goal={goal as Goal} />
          ))}
          {!goals?.length && <div className="card p-4 text-slate-600">No goals yet.</div>}
        </div>
      </main>
    </div>
  );
}
