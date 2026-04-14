// Cron-invoked function to materialize due recurring_transactions
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOAL_TAG_REGEX = /\[goal:([0-9a-fA-F-]{36})\]/;
const LOAN_TAG_REGEX = /\[loan:([0-9a-fA-F-]{36})\]/;
const RECURRING_TAG_REGEX = /\s*\[recurring:([0-9a-fA-F-]{36}):(\d{4}-\d{2}-\d{2})\]\s*$/;

const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeFrequency = (value: string | null | undefined) => {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return { interval: 1, unit: "month" as const };

  const modern = raw.match(/^every:(\d+):(day|days|week|weeks|month|months|year|years)$/);
  if (modern) {
    const interval = Math.max(1, Number(modern[1] ?? 1));
    const unitRaw = modern[2] ?? "month";
    return { interval, unit: (unitRaw.endsWith("s") ? unitRaw.slice(0, -1) : unitRaw) as "day" | "week" | "month" | "year" };
  }

  if (raw === "daily") return { interval: 1, unit: "day" as const };
  if (raw === "weekly") return { interval: 1, unit: "week" as const };
  if (raw === "monthly") return { interval: 1, unit: "month" as const };
  if (raw === "quarterly") return { interval: 3, unit: "month" as const };
  if (raw === "yearly") return { interval: 1, unit: "year" as const };

  return { interval: 1, unit: "month" as const };
};

const nextDateFromFrequency = (startDate: string, frequency: string | null | undefined) => {
  const { interval, unit } = normalizeFrequency(frequency);
  const next = new Date(`${startDate}T00:00:00.000Z`);
  if (unit === "day") next.setUTCDate(next.getUTCDate() + interval);
  if (unit === "week") next.setUTCDate(next.getUTCDate() + interval * 7);
  if (unit === "month") next.setUTCMonth(next.getUTCMonth() + interval);
  if (unit === "year") next.setUTCFullYear(next.getUTCFullYear() + interval);
  return next.toISOString().slice(0, 10);
};

const withRecurringTag = (description: string | null | undefined, recurringId: string, occurrenceDate: string) => {
  const clean = (description ?? "").replace(RECURRING_TAG_REGEX, "").trim();
  const tag = `[recurring:${recurringId}:${occurrenceDate}]`;
  return clean ? `${clean} ${tag}` : tag;
};

serve(async () => {
  const supabase = createClient(url, serviceKey);
  const today = new Date().toISOString().slice(0, 10);
  const { data: recurs, error: recursError } = await supabase
    .from("recurring_transactions")
    .select("id,family_id,bank_account_id,assigned_to,amount,category_id,frequency,next_execution_date,description,created_by")
    .lte("next_execution_date", today);
  if (recursError) return new Response(recursError.message, { status: 400 });

  if (!recurs?.length) return new Response("No due recurrences", { status: 200 });

  const accountIds = [...new Set(recurs.map((row) => row.bank_account_id).filter(Boolean))];
  const categoryIds = [...new Set(recurs.map((row) => row.category_id).filter(Boolean))];

  const accountNames = new Map<string, string>();
  const accountBalance = new Map<string, number>();
  if (accountIds.length) {
    const { data: bankAccounts } = await supabase.from("bank_accounts").select("id,name,balance").in("id", accountIds);
    (bankAccounts ?? []).forEach((account) => {
      accountNames.set(account.id, account.name ?? "Account");
      accountBalance.set(account.id, asNumber(account.balance));
    });
  }

  const categories = new Map<string, { name: string; type: string; affects_loan: boolean }>();
  if (categoryIds.length) {
    const { data: categoryRows } = await supabase
      .from("categories")
      .select("id,name,type,affects_loan")
      .in("id", categoryIds);
    (categoryRows ?? []).forEach((category) =>
      categories.set(category.id, {
        name: category.name ?? "Recurring",
        type: category.type ?? "expense",
        affects_loan: Boolean(category.affects_loan),
      })
    );
  }

  let processed = 0;
  const errors: string[] = [];

  for (const r of recurs) {
    await supabase.from("accounts").upsert({
      id: r.bank_account_id,
      name: accountNames.get(r.bank_account_id) ?? "Account",
      type: "personal",
    }, { onConflict: "id", ignoreDuplicates: true });

    const category = r.category_id ? categories.get(r.category_id) : null;
    const type = category?.type === "income" ? "income" : "expense";
    const categoryLabel = category?.name ?? "Recurring";
    const amount = asNumber(r.amount);
    let occurrenceDate = r.next_execution_date;
    let insertedForRecurring = 0;
    let iteration = 0;

    while (occurrenceDate <= today) {
      iteration += 1;
      if (iteration > 5000) {
        errors.push(`safety:${r.id}:too many occurrences`);
        break;
      }

      const taggedDescription = withRecurringTag(r.description, r.id, occurrenceDate);
      const marker = `[recurring:${r.id}:${occurrenceDate}]`;
      const duplicateQuery = supabase
        .from("transactions")
        .select("id")
        .eq("family_id", r.family_id)
        .eq("bank_account_id", r.bank_account_id)
        .eq("date", occurrenceDate)
        .ilike("description", `%${marker}%`)
        .limit(1);

      const duplicate = await duplicateQuery.maybeSingle();
      if (duplicate.error) {
        errors.push(`dedupe:${r.id}:${duplicate.error.message}`);
        break;
      }

      if (!duplicate.data) {
        const insert = await supabase.from("transactions").insert({
          family_id: r.family_id,
          bank_account_id: r.bank_account_id,
          account_id: r.bank_account_id,
          assigned_to: r.assigned_to,
          amount,
          type,
          category_id: r.category_id,
          category: categoryLabel,
          description: taggedDescription,
          date: occurrenceDate,
          created_by: r.created_by,
          user_id: r.created_by,
        });
        if (insert.error) {
          errors.push(`transaction:${r.id}:${insert.error.message}`);
          break;
        }

        const currentBalance = accountBalance.get(r.bank_account_id) ?? 0;
        const delta = type === "income" ? amount : -amount;
        const nextBalance = currentBalance + delta;
        accountBalance.set(r.bank_account_id, nextBalance);
        await supabase.from("bank_accounts").update({ balance: nextBalance }).eq("id", r.bank_account_id);

        const goalMatch = (r.description ?? "").match(GOAL_TAG_REGEX);
        const goalId = goalMatch?.[1] ?? null;
        if (goalId && amount > 0) {
          const goalRes = await supabase.from("goals").select("id,current_amount").eq("id", goalId).maybeSingle();
          if (!goalRes.error && goalRes.data) {
            const currentAmount = asNumber(goalRes.data.current_amount);
            await supabase.from("goals").update({ current_amount: currentAmount + amount }).eq("id", goalId);
          }
        }

        if (type === "expense" && category?.affects_loan && amount > 0) {
          const loanMatch = (r.description ?? "").match(LOAN_TAG_REGEX);
          const loanId = loanMatch?.[1] ?? null;
          if (loanId) {
            const loanRes = await supabase
              .from("loans")
              .select("id,remaining_amount,total_amount")
              .eq("id", loanId)
              .maybeSingle();
            if (!loanRes.error && loanRes.data) {
              const currentRemaining = asNumber(loanRes.data.remaining_amount, asNumber(loanRes.data.total_amount));
              await supabase
                .from("loans")
                .update({ remaining_amount: Math.max(0, currentRemaining - amount) })
                .eq("id", loanId);
            }
          }
        }

        insertedForRecurring += 1;
      }

      occurrenceDate = nextDateFromFrequency(occurrenceDate, r.frequency);
    }

    const recurringUpdate = await supabase
      .from("recurring_transactions")
      .update({ next_execution_date: occurrenceDate })
      .eq("id", r.id);
    if (recurringUpdate.error) {
      errors.push(`schedule:${r.id}:${recurringUpdate.error.message}`);
      continue;
    }

    processed += insertedForRecurring;
  }

  if (errors.length) {
    return new Response(`Inserted occurrences ${processed}. Errors: ${errors.join("; ")}`, { status: 207 });
  }

  return new Response("Inserted occurrences " + processed, { status: 200 });
});
