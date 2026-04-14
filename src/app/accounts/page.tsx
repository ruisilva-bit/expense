"use client";
import { useAppState } from "@/context/AppState";
import { AppNav } from "@/components/AppNav";
import { supabaseBrowser } from "@/lib/supabase-browser";
import useSWR from "swr";
import { formatEur } from "@/lib/format";

const fetcher = async (familyId: string) => {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id,name,balance")
    .eq("family_id", familyId);
  if (error) throw error;
  return data ?? [];
};

export default function AccountsPage() {
  const { selectedFamily, selectedAccount, setSelectedAccount } = useAppState();
  const { data: accounts, mutate } = useSWR(selectedFamily ? selectedFamily.id : null, fetcher);
  const supabase = supabaseBrowser();

  const createAccount = async (formData: FormData) => {
    if (!selectedFamily) return;
    const name = String(formData.get("name") || "Account");
    const balance = Number(formData.get("balance") || 0);
    const { error } = await supabase
      .from("bank_accounts")
      .insert({ family_id: selectedFamily.id, name, balance });
    if (error) alert(error.message);
    mutate();
  };

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Accounts</p>
            <h1 className="text-2xl font-semibold">{selectedFamily?.name || "Select a family"}</h1>
          </div>
        </div>

        {!selectedFamily && <div className="card p-4">Choose a family first.</div>}

        {selectedFamily && (
          <>
            <form action={createAccount} className="card p-4 space-y-3">
              <p className="text-sm text-slate-600">Create account</p>
              <input name="name" className="input" placeholder="Account name" required />
              <input name="balance" type="number" step="0.01" className="input" placeholder="Starting balance" />
              <button className="btn btn-primary w-fit">Create</button>
            </form>

            <div className="grid gap-4 sm:grid-cols-2">
              {accounts?.map((a: { id: string; name: string; balance: number }) => (
                <div key={a.id} className={`card p-4 space-y-2 ${selectedAccount?.id === a.id ? "border-emerald-500" : ""}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-slate-500">Balance</p>
                      <h3 className="text-lg font-semibold">{a.name}</h3>
                    </div>
                    <p className="text-xl font-semibold">{formatEur(Number(a.balance || 0))}</p>
                  </div>
                  <button className="btn btn-primary w-full" onClick={() => setSelectedAccount(a)}>
                    Select
                  </button>
                </div>
              ))}
              {!accounts?.length && <div className="card p-4">No accounts yet.</div>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
