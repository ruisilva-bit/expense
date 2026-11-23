-- Atomic and durable goal/savings movements.
-- One authenticated Next.js route invokes this RPC with the service-role client.

create table if not exists public.goal_movement_operations (
  user_id uuid not null,
  operation_id uuid not null,
  request_fingerprint jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  transaction_id uuid null references public.transactions(id) on delete set null,
  result jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, operation_id),
  unique (transaction_id)
);

alter table public.goal_movement_operations enable row level security;
revoke all on table public.goal_movement_operations from public, anon, authenticated;
grant select, insert, update on table public.goal_movement_operations to service_role;

create or replace function public.apply_goal_movement_v1(
  p_operation_id uuid,
  p_family_id uuid,
  p_goal_id uuid,
  p_bank_account_id uuid,
  p_user_id uuid,
  p_move_type text,
  p_amount_cents bigint,
  p_movement_date date,
  p_description text,
  p_category_id uuid,
  p_loan_id uuid,
  p_requested_assigned_to uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_fingerprint jsonb;
  v_operation public.goal_movement_operations%rowtype;
  v_goal public.goals%rowtype;
  v_account public.bank_accounts%rowtype;
  v_loan public.loans%rowtype;
  v_category_name text;
  v_category_affects_loan boolean := false;
  v_assigned_to uuid;
  v_goal_before_cents bigint;
  v_goal_after_cents bigint;
  v_account_before_cents bigint;
  v_account_after_cents bigint;
  v_loan_before_cents bigint;
  v_loan_after_cents bigint;
  v_transaction_id uuid := gen_random_uuid();
  v_transaction_type text;
  v_transaction_category text;
  v_base_description text;
  v_tagged_description text;
  v_journal jsonb;
  v_result jsonb;
begin
  if p_operation_id is null or p_family_id is null or p_goal_id is null or
     p_bank_account_id is null or p_user_id is null or p_movement_date is null then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_INVALID: Missing movement identity.';
  end if;
  if p_move_type not in ('allocate', 'release', 'spend') then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_INVALID: Invalid movement type.';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_INVALID: Movement amount must be greater than zero.';
  end if;

  v_base_description := nullif(btrim(coalesce(p_description, '')), '');
  v_fingerprint := jsonb_build_object(
    'family_id', p_family_id,
    'goal_id', p_goal_id,
    'bank_account_id', p_bank_account_id,
    'user_id', p_user_id,
    'move_type', p_move_type,
    'amount_cents', p_amount_cents,
    'movement_date', p_movement_date,
    'description', v_base_description,
    'category_id', p_category_id,
    'loan_id', p_loan_id,
    'requested_assigned_to', p_requested_assigned_to
  );

  -- The primary key claim serializes simultaneous replays. ON CONFLICT waits for
  -- an in-flight claimant to commit before the row is read below.
  insert into public.goal_movement_operations (
    user_id,
    operation_id,
    request_fingerprint,
    status
  ) values (
    p_user_id,
    p_operation_id,
    v_fingerprint,
    'pending'
  )
  on conflict (user_id, operation_id) do nothing;

  select *
    into v_operation
    from public.goal_movement_operations
   where user_id = p_user_id
     and operation_id = p_operation_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_RETRY: Could not claim movement operation.';
  end if;
  if v_operation.request_fingerprint is distinct from v_fingerprint then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_IDEMPOTENCY_CONFLICT: Operation key was already used with different data.';
  end if;
  if v_operation.status = 'completed' and v_operation.result is not null then
    return v_operation.result || jsonb_build_object('replayed', true);
  end if;

  if not exists (
    select 1
      from public.family_members fm
     where fm.family_id = p_family_id
       and fm.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_FORBIDDEN: User is not a family member.';
  end if;

  -- Deterministic lock order: goal, account, optional loan.
  select * into v_goal
    from public.goals
   where id = p_goal_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_NOT_FOUND: Goal not found.';
  end if;

  select * into v_account
    from public.bank_accounts
   where id = p_bank_account_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_NOT_FOUND: Bank account not found.';
  end if;

  if coalesce(v_goal.bank_account_id, v_goal.account_id) is distinct from p_bank_account_id or
     v_account.family_id is distinct from p_family_id then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_CONFLICT: Goal account or family changed.';
  end if;
  if not exists (select 1 from public.accounts a where a.id = p_bank_account_id) then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_CONFLICT: Legacy account mirror is missing.';
  end if;

  if p_category_id is not null then
    select c.name, coalesce(c.affects_loan, false)
      into v_category_name, v_category_affects_loan
      from public.categories c
     where c.id = p_category_id
       and c.family_id = p_family_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'HOMEFUND_NOT_FOUND: Category not found in family.';
    end if;
  end if;

  if v_category_affects_loan and p_loan_id is null then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_INVALID: Selected category requires a loan.';
  end if;

  if p_loan_id is not null then
    select * into v_loan
      from public.loans
     where id = p_loan_id
     for update;
    if not found or v_loan.family_id is distinct from p_family_id then
      raise exception using errcode = 'P0001', message = 'HOMEFUND_NOT_FOUND: Loan not found in family.';
    end if;
  end if;

  if p_requested_assigned_to is not null then
    select fm.id into v_assigned_to
      from public.family_members fm
     where fm.id = p_requested_assigned_to
       and fm.family_id = p_family_id
       and coalesce(fm.kind::text, 'human') <> 'system';
    if not found then
      raise exception using errcode = 'P0001', message = 'HOMEFUND_INVALID: Assignee is not an assignable family member.';
    end if;
  else
    select fm.id into v_assigned_to
      from public.family_members fm
     where fm.family_id = p_family_id
       and fm.user_id = p_user_id
       and coalesce(fm.kind::text, 'human') <> 'system'
     order by fm.created_at, fm.id
     limit 1;
  end if;

  v_goal_before_cents := round(coalesce(v_goal.current_amount, 0)::numeric * 100)::bigint;
  v_account_before_cents := round(coalesce(v_account.balance, 0)::numeric * 100)::bigint;
  v_loan_before_cents := case
    when p_loan_id is null then null
    else round(coalesce(v_loan.remaining_amount, v_loan.total_amount, 0)::numeric * 100)::bigint
  end;

  if p_move_type in ('release', 'spend') and p_amount_cents > v_goal_before_cents then
    raise exception using errcode = 'P0001', message = 'HOMEFUND_INSUFFICIENT: Goal has insufficient funds.';
  end if;

  v_goal_after_cents := v_goal_before_cents + case when p_move_type = 'allocate' then p_amount_cents else -p_amount_cents end;
  v_account_after_cents := v_account_before_cents + case when p_move_type = 'release' then p_amount_cents else -p_amount_cents end;
  v_loan_after_cents := case
    when v_loan_before_cents is null then null
    when p_move_type = 'spend' and v_category_affects_loan then greatest(0, v_loan_before_cents - p_amount_cents)
    else v_loan_before_cents
  end;

  update public.goals
     set current_amount = v_goal_after_cents::numeric / 100
   where id = p_goal_id;

  update public.bank_accounts
     set balance = v_account_after_cents::numeric / 100
   where id = p_bank_account_id;

  if p_loan_id is not null and p_move_type = 'spend' and v_category_affects_loan then
    update public.loans
       set remaining_amount = v_loan_after_cents::numeric / 100
     where id = p_loan_id;
  end if;

  if v_base_description is null then
    v_base_description := case p_move_type
      when 'allocate' then 'Transferência para goal: ' || coalesce(nullif(btrim(v_goal.name), ''), 'Goal')
      when 'release' then 'Transferência do goal: ' || coalesce(nullif(btrim(v_goal.name), ''), 'Goal')
      else 'Pagamento com goal: ' || coalesce(nullif(btrim(v_goal.name), ''), 'Goal')
    end;
  end if;
  v_base_description := btrim(regexp_replace(v_base_description, '\s*\[goal:[0-9a-fA-F-]{36}\]\s*', ' ', 'g'));
  v_base_description := btrim(regexp_replace(v_base_description, '\s*\[goal-move:(allocate|release|spend)\]\s*', ' ', 'g'));
  v_base_description := btrim(regexp_replace(v_base_description, '\s*\[loan:[0-9a-fA-F-]{36}\]\s*', ' ', 'g'));
  v_tagged_description := concat_ws(
    ' ',
    nullif(v_base_description, ''),
    case when v_category_affects_loan and p_loan_id is not null then '[loan:' || p_loan_id::text || ']' end,
    '[goal:' || p_goal_id::text || ']',
    '[goal-move:' || p_move_type || ']'
  );
  v_transaction_type := case when p_move_type = 'spend' then 'expense' else 'transfer' end;
  v_transaction_category := coalesce(v_category_name, case when p_move_type = 'spend' then 'Goal expense' else 'Goal movement' end);

  v_journal := jsonb_build_object(
    'schema', 'homefund.goal-movement.v2',
    'status', 'completed',
    'operation_id', p_operation_id,
    'family_id', p_family_id,
    'goal_id', p_goal_id,
    'bank_account_id', p_bank_account_id,
    'user_id', p_user_id,
    'move_type', p_move_type,
    'amount_cents', p_amount_cents,
    'movement_date', p_movement_date,
    'request_description', nullif(btrim(coalesce(p_description, '')), ''),
    'category_id', p_category_id,
    'loan_id', p_loan_id,
    'requested_assigned_to', p_requested_assigned_to,
    'assigned_to', v_assigned_to,
    'goal_before_cents', v_goal_before_cents,
    'goal_after_cents', v_goal_after_cents,
    'account_before_cents', v_account_before_cents,
    'account_after_cents', v_account_after_cents,
    'loan_before_cents', v_loan_before_cents,
    'loan_after_cents', v_loan_after_cents,
    'completed_at', clock_timestamp()
  );

  -- This insert deliberately follows the balance updates. Any insert/trigger
  -- failure proves PostgreSQL rolls every prior write back with the transaction.
  insert into public.transactions (
    id,
    family_id,
    bank_account_id,
    account_id,
    created_by,
    user_id,
    assigned_to,
    amount,
    type,
    category_id,
    category,
    description,
    date,
    split_details
  ) values (
    v_transaction_id,
    p_family_id,
    p_bank_account_id,
    p_bank_account_id,
    p_user_id,
    p_user_id,
    v_assigned_to,
    p_amount_cents::numeric / 100,
    v_transaction_type::public.transaction_kind,
    p_category_id,
    v_transaction_category,
    v_tagged_description,
    p_movement_date,
    v_journal
  );

  v_result := jsonb_build_object(
    'goal', jsonb_build_object(
      'id', v_goal.id,
      'name', coalesce(v_goal.name, 'Goal'),
      'target_amount', coalesce(v_goal.target_amount, 0),
      'current_amount', v_goal_after_cents::numeric / 100,
      'deadline', v_goal.deadline,
      'bank_account_id', p_bank_account_id
    ),
    'account_balance', v_account_after_cents::numeric / 100,
    'loan_remaining_amount', case when v_loan_after_cents is null then null else v_loan_after_cents::numeric / 100 end,
    'transaction_id', v_transaction_id,
    'replayed', false
  );

  update public.goal_movement_operations
     set status = 'completed',
         transaction_id = v_transaction_id,
         result = v_result,
         updated_at = clock_timestamp()
   where user_id = p_user_id
     and operation_id = p_operation_id;

  return v_result;
end;
$function$;

revoke all on function public.apply_goal_movement_v1(uuid, uuid, uuid, uuid, uuid, text, bigint, date, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_goal_movement_v1(uuid, uuid, uuid, uuid, uuid, text, bigint, date, text, uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
