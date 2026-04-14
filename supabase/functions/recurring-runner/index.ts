// Cron-invoked function to materialize due recurring_transactions
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async () => {
  const supabase = createClient(url, serviceKey);
  const today = new Date().toISOString().slice(0, 10);
  const { data: recurs } = await supabase
    .from("recurring_transactions")
    .select("id,family_id,bank_account_id,assigned_to,amount,category_id,frequency,next_execution_date,description,created_by")
    .lte("next_execution_date", today);

  if (!recurs?.length) return new Response("No due recurrences", { status: 200 });

  for (const r of recurs) {
    await supabase.from("transactions").insert({
      family_id: r.family_id,
      bank_account_id: r.bank_account_id,
      assigned_to: r.assigned_to,
      amount: r.amount,
      type: "expense", // default; adjust by category type if needed
      category_id: r.category_id,
      description: r.description,
      date: r.next_execution_date,
      created_by: r.created_by,
    });

    // advance next_execution_date
    const nextDate = new Date(r.next_execution_date);
    if (r.frequency === "monthly") nextDate.setMonth(nextDate.getMonth() + 1);
    else if (r.frequency === "weekly") nextDate.setDate(nextDate.getDate() + 7);
    else if (r.frequency === "daily") nextDate.setDate(nextDate.getDate() + 1);

    await supabase
      .from("recurring_transactions")
      .update({ next_execution_date: nextDate.toISOString().slice(0, 10) })
      .eq("id", r.id);
  }

  return new Response("Processed " + recurs.length, { status: 200 });
});
