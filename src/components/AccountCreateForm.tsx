"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export function AccountCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<"personal" | "joint">("personal");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const supabase = supabaseBrowser();
    const { data, error: accErr } = await supabase
      .from("accounts")
      .insert({ name, type })
      .select("id")
      .single();

    if (accErr || !data) {
      setError(accErr?.message || "Could not create account");
      setLoading(false);
      return;
    }

    const { error: memberErr } = await supabase.from("account_members").insert({
      account_id: data.id,
      role: "owner",
    });

    setLoading(false);
    if (memberErr) setError(memberErr.message);
    else {
      setError(null);
      setName("");
      router.refresh();
    }
  };

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Create Account</p>
          <h3 className="text-lg font-semibold">Personal or joint</h3>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Trip fund" required />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as "personal" | "joint")}> 
            <option value="personal">Personal</option>
            <option value="joint">Joint</option>
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="btn btn-primary w-full">{loading ? "Creating..." : "Create"}</button>
    </form>
  );
}
