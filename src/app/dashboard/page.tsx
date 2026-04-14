import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { AppNav } from "@/components/AppNav";
import { TransactionWizard } from "@/components/TransactionWizard";
import { formatEur } from "@/lib/format";
import { CategoryChart, MemberChart } from "@/components/FamilyCharts";

const PAGE_SIZE = 20;
export const revalidate = 0;

export default async function Dashboard({ searchParams }: { searchParams: { family?: string; page?: string } }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("family_members")
    .select("family_id, role, family:families(name)")
    .eq("user_id", user.id);

  const activeFamilyId = searchParams.family ?? memberships?.[0]?.family_id ?? null;
  if (!activeFamilyId) {
    redirect("/families");
  }

  const page = Number(searchParams.page ?? "1");
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [{ data: accounts }, { data: members }, { data: categories }, { data: txns }] = await Promise.all([
    supabase.from("bank_accounts").select("id,name,balance").eq("family_id", activeFamilyId),
    supabase.from("family_members").select("id,name").eq("family_id", activeFamilyId),
    supabase.from("categories").select("id,name,type").eq("family_id", activeFamilyId),
    supabase
      .from("transactions")
      .select("id,amount,type,date,description,assigned_to,category:categories(name,type),bank_account:bank_accounts(name)")
      .eq("family_id", activeFamilyId)
      .order("date", { ascending: false })
      .range(from, to),
  ]);

  const totals = (txns ?? []).reduce(
    (acc, t) => {
      const amt = Number(t.amount) || 0;
      if (t.type === "income") acc.in += amt;
      if (t.type === "expense") acc.out += amt;
      return acc;
    },
    { in: 0, out: 0 }
  );
  const net = totals.in - totals.out;

  const byCategory: Record<string, number> = {};
  const byMember: Record<string, number> = {};
  (txns ?? []).forEach((t) => {
    if (t.type === "expense") {
      const key = t.category?.name ?? "Uncategorized";
      byCategory[key] = (byCategory[key] || 0) + Number(t.amount || 0);
      const m = members?.find((mm) => mm.id === t.assigned_to)?.name ?? "Unassigned";
      byMember[m] = (byMember[m] || 0) + Number(t.amount || 0);
    }
  });

  const categoryChart = Object.entries(byCategory).map(([name, value]) => ({ name, value }));
  const memberChart = Object.entries(byMember).map(([name, value]) => ({ name, value }));

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Family</p>
            <h1 className="text-2xl font-semibold">{memberships?.find((m) => m.family_id === activeFamilyId)?.family.name}</h1>
          </div>
          <div className="flex gap-2 text-sm">
            <a className="btn btn-ghost" href="/families">Switch family</a>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-sm text-slate-500">Total received</p>
            <p className="text-2xl font-semibold">{formatEur(totals.in)}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-slate-500">Total spent</p>
            <p className="text-2xl font-semibold">{formatEur(totals.out)}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-slate-500">Net balance</p>
            <p className={`text-2xl font-semibold ${net >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatEur(net)}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
          <div className="card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Recent activity</h3>
              <div className="text-sm text-slate-500">Page {page}</div>
            </div>
            <ul className="divide-y divide-slate-200">
              {(txns ?? []).map((t) => (
                <li key={t.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{t.category?.name ?? "Uncategorized"}</p>
                    <p className="text-sm text-slate-600">{t.description || "No description"}</p>
                    <p className="text-xs text-slate-500">{t.date} · {t.bank_account?.name}</p>
                  </div>
                  <div className={`text-right font-semibold ${t.type === "income" ? "text-emerald-700" : "text-red-600"}`}>
                    {t.type === "income" ? "+" : "-"}{formatEur(Number(t.amount))}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-sm">
              {page > 1 ? <a href={`/dashboard?family=${activeFamilyId}&page=${page - 1}`} className="text-emerald-700">Prev</a> : <span />}
              {(txns?.length ?? 0) === PAGE_SIZE ? <a href={`/dashboard?family=${activeFamilyId}&page=${page + 1}`} className="text-emerald-700">Next</a> : <span />}
            </div>
          </div>

          <TransactionWizard
            familyId={activeFamilyId}
            members={members ?? []}
            accounts={accounts ?? []}
            categories={categories ?? []}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <CategoryChart data={categoryChart} />
          <MemberChart data={memberChart} />
        </div>
      </main>
    </div>
  );
}
