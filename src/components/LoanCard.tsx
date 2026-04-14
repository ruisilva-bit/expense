"use client";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Loan = {
  id: string;
  name: string;
  total_amount: number;
  monthly_payment: number;
};

type Payment = { id: string; amount: number; paid_at: string };

type Props = { loan: Loan; payments: Payment[] };

export function LoanCard({ loan, payments }: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState(loan.monthly_payment.toString());
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, loan.total_amount - totalPaid);

  const addPayment = async () => {
    setLoading(true);
    await supabaseBrowser().from("loan_payments").insert({
      loan_id: loan.id,
      amount: Number(amount),
      paid_at: date,
    });
    setLoading(false);
    router.refresh();
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">Loan</p>
          <h3 className="text-lg font-semibold">{loan.name}</h3>
        </div>
        <div className="text-right text-sm text-slate-600">
          <p>Total ${loan.total_amount.toFixed(2)}</p>
          <p>Remaining ${remaining.toFixed(2)}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={addPayment} disabled={loading} className="btn btn-primary whitespace-nowrap">{loading ? "Saving..." : "Add"}</button>
      </div>
      <ul className="text-sm text-slate-700 space-y-1">
        {payments.map((p) => (
          <li key={p.id} className="flex justify-between">
            <span>{p.paid_at}</span>
            <span>${Number(p.amount).toFixed(2)}</span>
          </li>
        ))}
        {payments.length === 0 && <li className="text-slate-500">No payments yet</li>}
      </ul>
    </div>
  );
}
