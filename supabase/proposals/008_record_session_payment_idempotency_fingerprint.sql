-- Pendiente de aprobación y staging.
-- Añade una huella normalizada al ledger de pagos y hace que una clave reutilizada
-- con otra intención de pago falle con IDEMPOTENCY_KEY_REUSED.

alter table public.payments
  add column if not exists idempotency_fingerprint text;

create or replace function public.record_session_payment(
  p_table_session_id uuid,
  p_method public.payment_method,
  p_allocations jsonb,
  p_idempotency_key uuid,
  p_payer_label text default null,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_payment_id uuid;
  v_existing_session uuid;
  v_existing_method public.payment_method;
  v_existing_fingerprint text;
  v_session_status public.session_status;
  v_allocation record;
  v_item_total numeric(12,2);
  v_already_paid numeric(12,2);
  v_amount numeric := 0;
  v_due numeric(12,2);
  v_paid numeric(12,2);
  v_fingerprint text;
  v_can_close boolean;
begin
  if not public.has_any_role(array['admin','cashier']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) < 1 or jsonb_array_length(p_allocations) > 100 then
    raise exception 'INVALID_PAYMENT_ALLOCATIONS' using errcode = '22023';
  end if;
  if p_method is null then raise exception 'PAYMENT_METHOD_REQUIRED' using errcode = '22023'; end if;
  if (select count(*) from jsonb_array_elements(p_allocations)) <>
     (select count(distinct value ->> 'order_item_id') from jsonb_array_elements(p_allocations)) then
    raise exception 'DUPLICATE_PAYMENT_ALLOCATION' using errcode = '22023';
  end if;

  v_fingerprint := jsonb_build_object(
    'session', p_table_session_id,
    'method', p_method,
    'allocations', (
      select jsonb_agg(jsonb_build_object(
        'order_item_id', value ->> 'order_item_id',
        'amount', (value ->> 'amount')::numeric
      ) order by value ->> 'order_item_id')
      from jsonb_array_elements(p_allocations)
    ),
    'payer', nullif(left(btrim(coalesce(p_payer_label, '')), 80), ''),
    'reference', nullif(left(btrim(coalesce(p_reference, '')), 120), '')
  )::text;

  select id, table_session_id, idempotency_fingerprint
    into v_payment_id, v_existing_session, v_existing_fingerprint
    from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_session <> p_table_session_id
       or coalesce(v_existing_fingerprint, '') <> v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
    end if;
    return jsonb_build_object('payment_id', v_payment_id, 'idempotent_replay', true);
  end if;

  select status into v_session_status from public.table_sessions
    where id = p_table_session_id for update;
  if not found or v_session_status <> 'open' then raise exception 'SESSION_NOT_OPEN' using errcode = 'P0001'; end if;

  for v_allocation in
    select (value ->> 'order_item_id')::uuid as order_item_id,
           (value ->> 'amount')::numeric as amount
    from jsonb_array_elements(p_allocations)
  loop
    if v_allocation.amount is null or v_allocation.amount <= 0
       or v_allocation.amount::text in ('NaN', 'Infinity', '-Infinity')
       or round(v_allocation.amount, 2) <> v_allocation.amount then
      raise exception 'INVALID_PAYMENT_AMOUNT' using errcode = '22023';
    end if;
    select oi.subtotal into v_item_total
      from public.order_items oi join public.orders o on o.id = oi.order_id
      where oi.id = v_allocation.order_item_id
        and o.table_session_id = p_table_session_id and o.status = 'served'
      for update of oi;
    if not found then raise exception 'PAYMENT_ITEM_NOT_PAYABLE' using errcode = 'P0001'; end if;
    select coalesce(sum(pa.amount), 0) into v_already_paid
      from public.payment_allocations pa where pa.order_item_id = v_allocation.order_item_id;
    if v_already_paid + v_allocation.amount > v_item_total then
      raise exception 'PAYMENT_EXCEEDS_ITEM_BALANCE' using errcode = 'P0001';
    end if;
    v_amount := v_amount + v_allocation.amount;
  end loop;
  if round(v_amount, 2) <> v_amount then raise exception 'INVALID_PAYMENT_PRECISION' using errcode = '22023'; end if;

  insert into public.payments(
    table_session_id, idempotency_key, idempotency_fingerprint, method, amount,
    payer_label, reference, received_by
  ) values (
    p_table_session_id, p_idempotency_key, v_fingerprint, p_method, v_amount,
    nullif(left(btrim(coalesce(p_payer_label, '')), 80), ''),
    nullif(left(btrim(coalesce(p_reference, '')), 120), ''),
    auth.uid()
  ) returning id into v_payment_id;

  insert into public.payment_allocations(payment_id, order_item_id, amount)
  select v_payment_id, (value ->> 'order_item_id')::uuid, (value ->> 'amount')::numeric
    from jsonb_array_elements(p_allocations);

  update public.orders o
    set payment_status = case
      when coalesce((select sum(pa.amount) from public.payment_allocations pa
        join public.order_items oi on oi.id = pa.order_item_id where oi.order_id = o.id), 0)
        >= coalesce((select sum(oi.subtotal) from public.order_items oi where oi.order_id = o.id), 0)
        then 'paid'::public.payment_status
      when exists (select 1 from public.payment_allocations pa
        join public.order_items oi on oi.id = pa.order_item_id where oi.order_id = o.id)
        then 'partial'::public.payment_status
      else 'unpaid'::public.payment_status
    end,
    updated_at = now()
    where o.table_session_id = p_table_session_id and o.status = 'served';

  select coalesce(sum(oi.subtotal),0) into v_due
    from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.table_session_id = p_table_session_id and o.status = 'served';
  select coalesce(sum(pa.amount),0) into v_paid
    from public.payments p join public.payment_allocations pa on pa.payment_id = p.id
    where p.table_session_id = p_table_session_id;
  v_can_close := v_due = v_paid and not exists (
    select 1 from public.orders where table_session_id = p_table_session_id
      and status not in ('served','cancelled')
  );
  if v_can_close then
    perform 1 from public.cafe_tables
      where id = (select table_id from public.table_sessions where id = p_table_session_id) for update;
    update public.table_sessions set status = 'closed', closed_at = now()
      where id = p_table_session_id;
    update public.cafe_tables set status = 'available', updated_at = now()
      where id = (select table_id from public.table_sessions where id = p_table_session_id);
  end if;
  return jsonb_build_object(
    'payment_id', v_payment_id, 'amount', v_amount, 'method', p_method,
    'session_closed', v_can_close, 'idempotent_replay', false
  );
end;
$$;
