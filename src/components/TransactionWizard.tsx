"use client";
import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatEur } from "@/lib/format";

export type FamilyMember = { id: string; name: string };
export type BankAccount = { id: string; name: string };
export type Category = { id: string; name: string; type: "income" | "expense" | "transfer" };

const steps = ["type", "member", "account", "amount", "category"] as const;
type Step = typeof steps[number];

type Props = {
  familyId: string;
  members: FamilyMember[];
  accounts: BankAccount[];
  categories: Category[];
  onCreated?: () => void;
};

export function TransactionWizard({ familyId, members, accounts, categories, onCreated }: Props) {
  const [step, setStep] = useState<Step>("type");
  const [type, setType] = useState<"income" | "expense" | "transfer">("expense");
  const [memberId, setMemberId] = useState<string>(members[0]?.id || "");
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || "");
  const [amount, setAmount] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id || "");
  const [otherDescription, setOtherDescription] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredCategories = useMemo(() => categories.filter((c) => c.type === type), [categories, type]);

  const next = () => {
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) setStep(steps[idx + 1]);
  };
  const prev = () => {
    const idx = steps.indexOf(step);
    if (idx > 0) setStep(steps[idx - 1]);
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    const supabase = supabaseBrowser();
    const category = filteredCategories.find((c) => c.id === categoryId);
    const description = categoryId === "other" ? otherDescription : category?.name === "Other" ? otherDescription : undefined;
    const { error } = await supabase.from("transactions").insert({
      family_id: familyId,
      bank_account_id: accountId,
      assigned_to: memberId,
      amount: Number(amount || 0),
      type,
      category_id: categoryId === "other" ? null : categoryId,
      description,
      date: new Date().toISOString().slice(0, 10),
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      onCreated?.();
      setAmount("");
      setOtherDescription("");
      setStep("type");
    }
  };

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Add transaction</h3>
        <p className="text-sm text-slate-500">Step {steps.indexOf(step) + 1} / {steps.length}</p>
      </div>
      {step === "type" && (
        <div className="grid grid-cols-3 gap-2">
          {(["income", "expense", "transfer"] as Array<"income" | "expense" | "transfer">).map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                setStep("member");
              }}
              className={`btn ${type === t ? "btn-primary" : "btn-ghost"}`}
            >
              {t === "income" ? "IN" : t === "expense" ? "OUT" : "TRANSFER"}
            </button>
          ))}
        </div>
      )}

      {step === "member" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Who is this for?</p>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => setMemberId(m.id)}
                className={`btn ${memberId === m.id ? "btn-primary" : "btn-ghost"}`}
              >
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "account" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Select account</p>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setAccountId(a.id)}
                className={`btn ${accountId === a.id ? "btn-primary" : "btn-ghost"}`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "amount" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Amount</p>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input"
            placeholder="0.00"
          />
          <p className="text-xs text-slate-500">{amount ? formatEur(Number(amount)) : ""}</p>
        </div>
      )}

      {step === "category" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Category</p>
          <div className="flex flex-wrap gap-2">
            {filteredCategories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`btn ${categoryId === c.id ? "btn-primary" : "btn-ghost"}`}
              >
                {c.name}
              </button>
            ))}
            <button
              onClick={() => {
                setCategoryId("other");
              }}
              className={`btn ${categoryId === "other" ? "btn-primary" : "btn-ghost"}`}
            >
              Other
            </button>
          </div>
          {categoryId === "other" && (
            <input
              className="input"
              placeholder="Describe it"
              value={otherDescription}
              onChange={(e) => setOtherDescription(e.target.value)}
            />
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <button onClick={prev} className="btn btn-ghost" disabled={step === "type"}>
          Back
        </button>
        {step === "category" ? (
          <button onClick={submit} disabled={loading} className="btn btn-primary">
            {loading ? "Saving..." : "Save"}
          </button>
        ) : (
          <button onClick={next} className="btn btn-primary" disabled={step === "category"}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
