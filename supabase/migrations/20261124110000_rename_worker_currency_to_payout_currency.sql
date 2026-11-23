begin;

alter table public.worker_task_invoices
  rename column worker_currency_code to payout_currency_code;
alter table public.worker_task_payments
  rename column worker_currency_code to payout_currency_code;

comment on column public.worker_task_invoices.payout_currency_code is
  'Payout (settlement) currency copied from tasks.settlement_currency_code. Not the worker Books base currency.';
comment on column public.worker_task_payments.payout_currency_code is
  'Payout (settlement) currency copied from tasks.settlement_currency_code. Not the worker Books base currency.';

do $$
declare
  function_oid regprocedure;
  function_definition text;
begin
  for function_oid in
    select unnest(array[
      'public.create_worker_task_invoice(uuid,numeric)'::regprocedure,
      'public.record_worker_task_payment(uuid,text,text,uuid)'::regprocedure,
      'public.confirm_worker_task_payment(uuid)'::regprocedure
    ])
  loop
    select pg_get_functiondef(function_oid::oid) into function_definition;
    function_definition := replace(function_definition, 'worker_currency_code', 'payout_currency_code');
    execute function_definition;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
