import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { AppNav } from "@/components/AppNav";
import { LoanCard } from "@/components/LoanCard";
import { LoanForm } from "@/components/LoanForm";

type Loan = {
  id: string;
  account_id: string;
  name: string;
  total_amount: number;
  monthly_payment: number;
};

type Payment = { id: string; loan_id: string; amount: number; paid_at: string };

export default async function LoansPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("account_members")
    .select("account:accounts(id,name)");
  const accountOptions = memberships?.map((m) => m.account) ?? [];

  const { data: loansData } = await supabase
    .from("loans")
    .select("id, account_id, name, total_amount, monthly_payment");

  const loans: Loan[] = loansData ?? [];
  const loanIds = loans.map((l) => l.id);
  const { data: paymentsData } = loanIds.length
    ? await supabase.from("loan_payments").select("id, loan_id, amount, paid_at").in("loan_id", loanIds)
    : { data: [] };
  const payments: Payment[] = paymentsData ?? [];

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Loans</p>
            <h1 className="text-2xl font-semibold">Shared debt tracking</h1>
          </div>
        </div>

        {accountOptions.length > 0 ? <LoanForm accounts={accountOptions} /> : <div className="card p-4">Create an account first.</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          {loans.map((loan) => (
            <LoanCard key={loan.id} loan={loan} payments={payments.filter((p) => p.loan_id === loan.id)} />
          ))}
          {!loans.length && <div className="card p-4 text-slate-600">No loans yet.</div>}
        </div>
      </main>
    </div>
  );
}
