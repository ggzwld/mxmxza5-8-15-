update public.user_profiles profile
   set books_base_currency = organization.base_currency
  from public.books_worker_workspaces workspace
  join public.books_organizations organization on organization.id = workspace.organization_id
 where profile.user_id = workspace.user_id
   and profile.role = 'worker'
   and profile.books_base_currency is null;

create or replace function public.lock_worker_books_currency_before_journal_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_user_id uuid;
begin
  select workspace.user_id into worker_user_id
    from public.books_worker_workspaces workspace
   where workspace.organization_id = new.organization_id;
  if worker_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('worker-books:' || worker_user_id::text, 0));
  end if;
  return new;
end;
$$;
revoke all on function public.lock_worker_books_currency_before_journal_insert() from public, anon, authenticated;

drop trigger if exists lock_worker_books_currency_before_journal_insert on public.books_journal_transactions;
create trigger lock_worker_books_currency_before_journal_insert
before insert on public.books_journal_transactions
for each row execute function public.lock_worker_books_currency_before_journal_insert();

create or replace function public.set_worker_books_base_currency(p_currency text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  chosen text := upper(trim(p_currency));
  worker_organization_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to access Books'; end if;
  if chosen is null or chosen not in ('UGX', 'USD', 'EUR', 'GBP', 'KES', 'TZS', 'RWF') then
    raise exception 'Choose a Books-supported currency';
  end if;
  if not exists (select 1 from public.user_profiles where user_id = auth.uid() and role = 'worker') then
    raise exception 'Worker Books are available to worker accounts';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('worker-books:' || auth.uid()::text, 0));
  select workspace.organization_id into worker_organization_id
    from public.books_worker_workspaces workspace where workspace.user_id = auth.uid();
  if worker_organization_id is not null then
    if exists (select 1 from public.books_journal_transactions where organization_id = worker_organization_id) then
      raise exception 'Your Books already has recorded transactions, so the base currency can no longer be changed';
    end if;
    update public.books_organizations set base_currency = chosen where id = worker_organization_id;
  end if;

  update public.user_profiles set books_base_currency = chosen where user_id = auth.uid();
  return chosen;
end;
$$;
revoke all on function public.set_worker_books_base_currency(text) from public, anon;
grant execute on function public.set_worker_books_base_currency(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
volatile
set search_path = public
as $$
declare
  requested_role text;
  requested_books_currency text;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'role' in ('guest', 'manager', 'worker')
    then new.raw_user_meta_data ->> 'role'
    else 'guest'
  end;
  requested_books_currency := case
    when new.raw_user_meta_data ->> 'books_base_currency' in ('UGX', 'USD', 'EUR', 'GBP', 'KES', 'TZS', 'RWF')
    then new.raw_user_meta_data ->> 'books_base_currency'
    else null
  end;

  insert into public.user_profiles (
    user_id, email, role, first_name, last_name, phone, service_type,
    service_category, menu_access_role, menu_access_approved, books_base_currency
  ) values (
    new.id,
    coalesce(new.email, ''),
    requested_role,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'service_type', ''),
    nullif(new.raw_user_meta_data ->> 'service_category', ''),
    coalesce(new.raw_user_meta_data ->> 'menu_access_role', 'none'),
    false,
    case when requested_role = 'worker' then requested_books_currency end
  )
  on conflict (user_id) do update set
    email = excluded.email,
    first_name = case
      when public.user_profiles.first_name is null or public.user_profiles.first_name = ''
      then excluded.first_name else public.user_profiles.first_name end,
    last_name = case
      when public.user_profiles.last_name is null or public.user_profiles.last_name = ''
      then excluded.last_name else public.user_profiles.last_name end,
    phone = coalesce(public.user_profiles.phone, excluded.phone),
    role = case
      when public.user_profiles.role = 'guest' and excluded.role <> 'guest'
      then excluded.role else public.user_profiles.role end,
    service_type = coalesce(public.user_profiles.service_type, excluded.service_type),
    service_category = coalesce(public.user_profiles.service_category, excluded.service_category),
    menu_access_role = coalesce(public.user_profiles.menu_access_role, excluded.menu_access_role),
    books_base_currency = coalesce(public.user_profiles.books_base_currency, excluded.books_base_currency);

  return new;
end;
$$;

notify pgrst, 'reload schema';
