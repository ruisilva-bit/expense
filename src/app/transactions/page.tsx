"use client";
import { AppNav } from "@/components/AppNav";
import { useAppState } from "@/context/AppState";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatEur } from "@/lib/format";
import useSWR from "swr";
import { useState } from "react";

const fetcher = async (familyId: string) => {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("transactions")
    .select("id,amount,type,date,description,assigned_to,category:categories(name),bank_account:bank_accounts(name)")
    .eq("family_id", familyId)
    .order("date", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
};

const categoriesFetcher = async (familyId: string) => {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.from("categories").select("id,name,type").eq("family_id", familyId);
  if (error) throw error;
  return data ?? [];
};

export default function TransactionsPage() {
  const { selectedFamily, selectedAccount } = useAppState();
  const { data: txns, mutate } = useSWR(selectedFamily ? selectedFamily.id : null, fetcher);
  const { data: categories } = useSWR(selectedFamily ? `categories-${selectedFamily.id}` : null, categoriesFetcher);
  const [type, setType] = useState<"income" | "expense" | "transfer">("expense");
  const [memberId, setMemberId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>(selectedAccount?.id || "");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [other, setOther] = useState("");
  const [transferTo, setTransferTo] = useState<string>("");
  const supabase = supabaseBrowser();

  const submit = async () => {
    if (!selectedFamily) return;
    if (type === "transfer") {
      const { error } = await supabase.from("transfers").insert({
        family_id: selectedFamily.id,
        source_account_id: accountId,
        dest_account_id: transferTo,
        amount: Number(amount || 0),
        type: "transfer",
        date: new Date().toISOString().slice(0, 10),
      });
      if (error) alert(error.message);
      mutate();
      return;
    }
    const { error } = await supabase.from("transactions").insert({
      family_id: selectedFamily.id,
      bank_account_id: accountId,
      assigned_to: memberId || null,
      amount: Number(amount || 0),
      type,
      category_id: categoryId || null,
      description: categoryId === "other" ? other : undefined,
      date: new Date().toISOString().slice(0, 10),
    });
    if (error) alert(error.message);
    mutate();
  };

  if (!selectedFamily) return <div className="min-h-screen"><AppNav /><main className="p-6">Select a family first.</main></div>;

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Transactions</p>
            <h1 className="text-2xl font-semibold">{selectedFamily.name}</h1>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(["income", "expense", "transfer"] as Array<"income" | "expense" | "transfer">).map((t) => (
              <button key={t} className={`btn ${type === t ? "btn-primary" : "btn-ghost"}`} onClick={() => setType(t)}>
                {t === "income" ? "IN" : t === "expense" ? "OUT" : "TRANSFER"}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm text-slate-500">Member</p>
            {/* members pulled via context? reuse categories fetcher?*/}
            <FamilyMembersSelector familyId={selectedFamily.id} value={memberId} onChange={setMemberId} />
          </div>

          <div className="space-y-2">
            <p className="text-sm text-slate-500">Account</p>
            <BankAccountSelector familyId={selectedFamily.id} value={accountId} onChange={setAccountId} />
          </div>

          {type === "transfer" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Destination account</p>
              <BankAccountSelector familyId={selectedFamily.id} value={transferTo} onChange={setTransferTo} />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm text-slate-500">Amount</p>
            <input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-xs text-slate-500">{amount && formatEur(Number(amount))}</p>
          </div>

          {type !== "transfer" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-500">Category</p>
              <div className="flex flex-wrap gap-2">
                {(categories ?? []).filter((c: { id: string; name: string; type: string }) => c.type === type).map((c) => (
                  <button key={c.id} className={`btn ${categoryId === c.id ? "btn-primary" : "btn-ghost"}`} onClick={() => setCategoryId(c.id)}>
                    {c.name}
                  </button>
                ))}
                <button className={`btn ${categoryId === "other" ? "btn-primary" : "btn-ghost"}`} onClick={() => setCategoryId("other")}>
                  Other
                </button>
              </div>
              {categoryId === "other" && <input className="input" placeholder="Describe" value={other} onChange={(e) => setOther(e.target.value)} />}
            </div>
          )}

          <button className="btn btn-primary w-full" onClick={submit}>Save</button>
        </div>

        <div className="card p-4 space-y-3">
          <h3 className="text-lg font-semibold">Recent</h3>
          <ul className="divide-y divide-slate-200">
            {(txns ?? []).map((t: { id: string; amount: number; type: string; date: string; description: string | null; category?: { name: string }; bank_account?: { name: string } }) => (
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
        </div>
      </main>
    </div>
  );
}

function FamilyMembersSelector({ familyId, value, onChange }: { familyId: string; value: string; onChange: (v: string) => void }) {
  const supabase = supabaseBrowser();
  const { data } = useSWR(familyId ? `members-${familyId}` : null, async () => {
    const { data, error } = await supabase.from("family_members").select("id,name").eq("family_id", familyId);
    if (error) throw error;
    return data ?? [];
  });
  return (
    <div className="flex flex-wrap gap-2">
      {(data ?? []).map((m: { id: string; name: string }) => (
        <button key={m.id} className={`btn ${value === m.id ? "btn-primary" : "btn-ghost"}`} onClick={() => onChange(m.id)}>
          {m.name}
        </button>
      ))}
    </div>
  );
}

function BankAccountSelector({ familyId, value, onChange }: { familyId: string; value: string; onChange: (v: string) => void }) {
  const supabase = supabaseBrowser();
  const { data } = useSWR(familyId ? `accounts-${familyId}` : null, async () => {
    const { data, error } = await supabase.from("bank_accounts").select("id,name").eq("family_id", familyId);
    if (error) throw error;
    return data ?? [];
  });
  return (
    <div className="flex flex-wrap gap-2">
      {(data ?? []).map((a: { id: string; name: string }) => (
        <button key={a.id} className={`btn ${value === a.id ? "btn-primary" : "btn-ghost"}`} onClick={() => onChange(a.id)}>
          {a.name}
        </button>
      ))}
    </div>
  );
}
