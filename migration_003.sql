-- Dastorkon: миграция 003 — подтверждение стола официантом и код стола
-- Заказать может только тот, кто реально сидит за столом:
--   1) гость просит официанта подтвердить стол (или вводит код стола от друзей);
--   2) официант видит запрос в кабинете и нажимает «Подтвердить» — стол получает одноразовый 4-значный код;
--   3) друзья за этим столом входят по коду; 3 неверные попытки — блокировка на 10 минут;
--   4) код перестаёт работать, когда счёт оплачен или официант закрыл стол (и в любом случае через 10 часов).
-- Запуск: Supabase → SQL Editor → вставить файл → Run. Повторный запуск безопасен.

alter table public.restaurants add column if not exists table_guard boolean not null default true;

create table if not exists public.table_sessions(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  table_id uuid not null references public.tables on delete cascade,
  table_number int not null,
  code text not null check (code ~ '^[0-9]{4}$'),
  opened_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists table_sessions_one_open on public.table_sessions(table_id) where closed_at is null;
create index if not exists table_sessions_rest on public.table_sessions(restaurant_id, created_at desc);

create table if not exists public.table_requests(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  table_id uuid not null references public.tables on delete cascade,
  table_number int not null,
  guest_token uuid not null,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  session_id uuid references public.table_sessions on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index if not exists table_requests_rest on public.table_requests(restaurant_id, status, created_at desc);
create index if not exists table_requests_guest on public.table_requests(table_id, guest_token, created_at desc);

create table if not exists public.session_guests(
  session_id uuid not null references public.table_sessions on delete cascade,
  guest_token uuid not null,
  joined_at timestamptz not null default now(),
  primary key (session_id, guest_token)
);

create table if not exists public.join_attempts(
  id bigserial primary key,
  table_id uuid not null references public.tables on delete cascade,
  guest_token uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists join_attempts_tbl on public.join_attempts(table_id, created_at desc);

alter table public.orders add column if not exists session_id uuid references public.table_sessions on delete set null;

alter table public.table_sessions enable row level security;
alter table public.table_requests enable row level security;
alter table public.session_guests enable row level security;
alter table public.join_attempts enable row level security;
drop policy if exists ts_read on public.table_sessions;
create policy ts_read on public.table_sessions for select to authenticated using (public.is_staff(restaurant_id));
drop policy if exists tr_read on public.table_requests;
create policy tr_read on public.table_requests for select to authenticated using (public.is_staff(restaurant_id));
-- session_guests и join_attempts: без политик, доступ только через функции ниже.

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'table_requests') then
    alter publication supabase_realtime add table public.table_requests;
  end if;
end $$;

-- ---------- служебные ----------
create or replace function public.open_session_for(p_table uuid) returns public.table_sessions
language plpgsql volatile security definer set search_path = public as $$
declare s public.table_sessions; t public.tables;
begin
  update public.table_sessions set closed_at = now()
    where table_id = p_table and closed_at is null and created_at < now() - interval '10 hours';
  select * into s from public.table_sessions where table_id = p_table and closed_at is null for update;
  if found then return s; end if;
  select * into t from public.tables where id = p_table;
  insert into public.table_sessions(restaurant_id, table_id, table_number, code, opened_by)
  values (t.restaurant_id, t.id, t.number, lpad((abs(hashtextextended(gen_random_uuid()::text, 0)) % 10000)::text, 4, '0'), auth.uid())
  on conflict do nothing
  returning * into s;
  if s.id is null then select * into s from public.table_sessions where table_id = p_table and closed_at is null; end if;
  return s;
end $$;

create or replace function public.live_session(p_table uuid) returns public.table_sessions
language sql stable security definer set search_path = public as $$
  select * from public.table_sessions
  where table_id = p_table and closed_at is null and created_at > now() - interval '10 hours' limit 1
$$;

-- Счёт по столу закрыт, если не осталось неоплаченных заказов этой сессии
create or replace function public.maybe_close_session(p_sid uuid) returns void
language sql volatile security definer set search_path = public as $$
  update public.table_sessions s set closed_at = now()
  where s.id = p_sid and s.closed_at is null
    and exists (select 1 from public.orders o where o.session_id = p_sid and o.status <> 'cancelled')
    and not exists (select 1 from public.orders o where o.session_id = p_sid and not o.paid and o.status <> 'cancelled')
$$;

-- ---------- для гостя ----------
create or replace function public.table_access(p_tag text, p_guest uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tables; r public.restaurants; s public.table_sessions; q public.table_requests; fails int;
begin
  select * into t from public.tables where tag_code = upper(trim(p_tag));
  if not found then return jsonb_build_object('ok', false, 'code', 'tag_not_found'); end if;
  select * into r from public.restaurants where id = t.restaurant_id;
  if not r.table_guard then return jsonb_build_object('ok', true, 'guard', false, 'state', 'open'); end if;
  s := public.live_session(t.id);
  if s.id is not null and p_guest is not null and exists (select 1 from public.session_guests where session_id = s.id and guest_token = p_guest) then
    return jsonb_build_object('ok', true, 'guard', true, 'state', 'member', 'code', s.code);
  end if;
  select count(*) into fails from public.join_attempts where table_id = t.id and guest_token = p_guest and created_at > now() - interval '10 minutes';
  if fails >= 3 then return jsonb_build_object('ok', true, 'guard', true, 'state', 'blocked'); end if;
  select * into q from public.table_requests where table_id = t.id and guest_token = p_guest and created_at > now() - interval '15 minutes' order by created_at desc limit 1;
  if q.id is not null and q.status = 'pending' then return jsonb_build_object('ok', true, 'guard', true, 'state', 'pending'); end if;
  if q.id is not null and q.status = 'denied' and q.decided_at > now() - interval '5 minutes' then return jsonb_build_object('ok', true, 'guard', true, 'state', 'denied'); end if;
  return jsonb_build_object('ok', true, 'guard', true, 'state', 'none');
end $$;

create or replace function public.request_table(p_tag text, p_guest uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t public.tables; r public.restaurants; st jsonb;
begin
  if p_guest is null then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  select * into t from public.tables where tag_code = upper(trim(p_tag));
  if not found then return jsonb_build_object('ok', false, 'code', 'tag_not_found'); end if;
  select * into r from public.restaurants where id = t.restaurant_id;
  if not public.serviceable(r) or not t.active then return jsonb_build_object('ok', false, 'code', 'table_off'); end if;
  st := public.table_access(p_tag, p_guest);
  if st->>'state' in ('open', 'member', 'pending') then return st; end if;
  if (select count(*) from public.table_requests where table_id = t.id and status = 'pending' and created_at > now() - interval '15 minutes') >= 6
     or (select count(*) from public.table_requests where guest_token = p_guest and created_at > now() - interval '10 minutes') >= 4 then
    return jsonb_build_object('ok', false, 'code', 'too_fast');
  end if;
  insert into public.table_requests(restaurant_id, table_id, table_number, guest_token) values (r.id, t.id, t.number, p_guest);
  return jsonb_build_object('ok', true, 'guard', true, 'state', 'pending');
end $$;

create or replace function public.join_table(p_tag text, p_guest uuid, p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t public.tables; r public.restaurants; s public.table_sessions; fails int; tfails int;
begin
  if p_guest is null then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  select * into t from public.tables where tag_code = upper(trim(p_tag));
  if not found then return jsonb_build_object('ok', false, 'code', 'tag_not_found'); end if;
  select * into r from public.restaurants where id = t.restaurant_id;
  if not r.table_guard then return jsonb_build_object('ok', true, 'guard', false, 'state', 'open'); end if;
  -- перебор: не больше 3 ошибок с одного телефона и 10 ошибок на стол за 10 минут
  select count(*) into fails from public.join_attempts where table_id = t.id and guest_token = p_guest and created_at > now() - interval '10 minutes';
  select count(*) into tfails from public.join_attempts where table_id = t.id and created_at > now() - interval '10 minutes';
  if fails >= 3 or tfails >= 10 then return jsonb_build_object('ok', false, 'code', 'blocked'); end if;
  s := public.live_session(t.id);
  if s.id is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;
  if coalesce(trim(p_code), '') <> s.code then
    insert into public.join_attempts(table_id, guest_token) values (t.id, p_guest);
    return jsonb_build_object('ok', false, 'code', case when fails + 1 >= 3 then 'blocked' else 'wrong_code' end, 'left', greatest(0, 2 - fails));
  end if;
  insert into public.session_guests(session_id, guest_token) values (s.id, p_guest) on conflict do nothing;
  return jsonb_build_object('ok', true, 'guard', true, 'state', 'member', 'code', s.code);
end $$;

-- ---------- для персонала ----------
create or replace function public.approve_table_request(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare q public.table_requests; s public.table_sessions;
begin
  select * into q from public.table_requests where id = p_id for update;
  if not found or not public.is_staff(q.restaurant_id) then raise exception 'forbidden'; end if;
  if q.status = 'pending' then
    s := public.open_session_for(q.table_id);
    insert into public.session_guests(session_id, guest_token) values (s.id, q.guest_token) on conflict do nothing;
    update public.table_requests set status = 'approved', session_id = s.id, decided_at = now(), decided_by = auth.uid() where id = p_id;
    -- остальные гости этого стола, которые тоже нажали «позвать официанта», подтверждаются вместе
    insert into public.session_guests(session_id, guest_token)
      select s.id, guest_token from public.table_requests where table_id = q.table_id and status = 'pending' and created_at > now() - interval '15 minutes'
      on conflict do nothing;
    update public.table_requests set status = 'approved', session_id = s.id, decided_at = now(), decided_by = auth.uid()
      where table_id = q.table_id and status = 'pending';
  else
    s := public.live_session(q.table_id);
  end if;
  return jsonb_build_object('ok', true, 'table_number', q.table_number, 'code', s.code);
end $$;

create or replace function public.deny_table_request(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare q public.table_requests;
begin
  select * into q from public.table_requests where id = p_id for update;
  if not found or not public.is_staff(q.restaurant_id) then raise exception 'forbidden'; end if;
  if q.status = 'pending' then update public.table_requests set status = 'denied', decided_at = now(), decided_by = auth.uid() where id = p_id; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.open_table(p_table uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t public.tables; s public.table_sessions;
begin
  select * into t from public.tables where id = p_table;
  if not found or not public.is_staff(t.restaurant_id) then raise exception 'forbidden'; end if;
  s := public.open_session_for(p_table);
  return jsonb_build_object('ok', true, 'table_number', t.number, 'code', s.code);
end $$;

create or replace function public.close_table(p_table uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare t public.tables;
begin
  select * into t from public.tables where id = p_table;
  if not found or not public.is_staff(t.restaurant_id) then raise exception 'forbidden'; end if;
  update public.table_sessions set closed_at = now() where table_id = p_table and closed_at is null;
  update public.table_requests set status = 'denied', decided_at = now(), decided_by = auth.uid() where table_id = p_table and status = 'pending';
  return jsonb_build_object('ok', true);
end $$;

-- оплата и отмена закрывают стол, когда по нему не осталось неоплаченных заказов
create or replace function public.mark_paid(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found or not public.is_staff(o.restaurant_id) then raise exception 'forbidden'; end if;
  if o.pay_method <> 'waiter' then raise exception 'online_order'; end if;
  update public.orders set paid = true, paid_at = now(), updated_at = now() where id = p_id;
  if o.session_id is not null then perform public.maybe_close_session(o.session_id); end if;
  return public.order_json(p_id);
end $$;

create or replace function public.cancel_order(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found or not public.is_staff(o.restaurant_id) then raise exception 'forbidden'; end if;
  if o.paid then raise exception 'paid_order'; end if;
  update public.orders set status = 'cancelled', updated_at = now() where id = p_id;
  if o.session_id is not null then perform public.maybe_close_session(o.session_id); end if;
  return public.order_json(p_id);
end $$;

-- меню сообщает гостю, включено ли подтверждение стола
create or replace function public.get_menu(p_tag text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tables; r public.restaurants;
begin
  select * into t from public.tables where tag_code = upper(trim(p_tag));
  if not found then return jsonb_build_object('ok', false, 'code', 'tag_not_found'); end if;
  select * into r from public.restaurants where id = t.restaurant_id;
  if not public.serviceable(r) then return jsonb_build_object('ok', false, 'code', 'restaurant_off'); end if;
  return jsonb_build_object('ok', true,
    'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'tagline', r.tagline, 'cover_url', r.cover_url, 'logo_url', r.logo_url, 'online_pay', r.online_pay, 'table_guard', r.table_guard),
    'table', jsonb_build_object('number', t.number, 'active', t.active),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.name->>'ru')
                            from public.categories c where c.restaurant_id = r.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'category_id', i.category_id, 'name', i.name, 'descr', i.descr, 'ingredients', i.ingredients,
                'allergens', i.allergens, 'portion', i.portion, 'price', i.price, 'available', i.available, 'photo_url', i.photo_url,
                'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price) order by a.sort, a.price)
                                    from public.addons a where a.item_id = i.id), '[]'::jsonb))
              order by i.sort, i.created_at)
              from public.items i where i.restaurant_id = r.id), '[]'::jsonb));
end $$;

-- заказ принимается только от гостя, подтверждённого за этим столом
create or replace function public.create_order(p_tag text, p_lines jsonb, p_pay text, p_note text, p_idem text, p_guest uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tables; r public.restaurants; o public.orders; it public.items;
  l jsonb; v_qty int; v_add_sum int; v_adds jsonb; v_unit int; v_total int := 0;
  v_gone jsonb := '[]'::jsonb; v_lines jsonb := '[]'::jsonb; v_no int; v_ids uuid[]; v_sid uuid;
begin
  if p_idem is null or length(p_idem) not between 8 and 100 or p_guest is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request');
  end if;
  select * into t from public.tables where tag_code = upper(trim(p_tag));
  if not found then return jsonb_build_object('ok', false, 'code', 'tag_not_found'); end if;
  select * into r from public.restaurants where id = t.restaurant_id;

  select * into o from public.orders where restaurant_id = r.id and idem_key = p_idem;
  if found then return jsonb_build_object('ok', true, 'duplicate', true, 'order', public.order_json(o.id)); end if;

  if not public.serviceable(r) or not t.active then return jsonb_build_object('ok', false, 'code', 'table_off'); end if;
  if r.table_guard then
    select s.id into v_sid from public.table_sessions s join public.session_guests g on g.session_id = s.id and g.guest_token = p_guest
      where s.table_id = t.id and s.closed_at is null and s.created_at > now() - interval '10 hours' limit 1;
    if v_sid is null then return jsonb_build_object('ok', false, 'code', 'need_access'); end if;
  end if;
  -- защита от потока заказов: не больше 6 заказов за 2 минуты на стол и 3 в минуту с одного устройства
  if (select count(*) from public.orders where table_id = t.id and created_at > now() - interval '2 minutes') >= 6
     or (select count(*) from public.orders where guest_token = p_guest and created_at > now() - interval '1 minute') >= 3 then
    return jsonb_build_object('ok', false, 'code', 'too_fast');
  end if;
  if p_pay not in ('waiter','online') then return jsonb_build_object('ok', false, 'code', 'bad_request'); end if;
  if p_pay = 'online' and not r.online_pay then return jsonb_build_object('ok', false, 'code', 'online_unavailable'); end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty');
  end if;
  if jsonb_array_length(p_lines) > 60 then return jsonb_build_object('ok', false, 'code', 'too_many'); end if;

  for l in select value from jsonb_array_elements(p_lines) loop
    select * into it from public.items where id = public.try_uuid(l->>'item_id') and restaurant_id = r.id;
    if not found or not it.available then
      v_gone := v_gone || jsonb_build_array(l->>'item_id'); continue;
    end if;
    v_qty := greatest(1, least(50, coalesce(case when (l->>'qty') ~ '^\d{1,3}$' then (l->>'qty')::int end, 1)));
    select coalesce(array_agg(public.try_uuid(x)), '{}') into v_ids
      from jsonb_array_elements_text(case when jsonb_typeof(l->'addons') = 'array' then l->'addons' else '[]'::jsonb end) x;
    select coalesce(jsonb_agg(a.name order by a.sort, a.price), '[]'::jsonb), coalesce(sum(a.price), 0)
      into v_adds, v_add_sum
      from public.addons a where a.item_id = it.id and a.id = any(v_ids);
    v_unit := it.price + v_add_sum;
    v_total := v_total + v_unit * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id', it.id, 'name', it.name, 'qty', v_qty, 'unit_price', v_unit, 'addons', v_adds));
  end loop;

  if jsonb_array_length(v_gone) > 0 then
    return jsonb_build_object('ok', false, 'code', 'unavailable', 'gone', v_gone);
  end if;

  update public.restaurants set order_seq = order_seq + 1 where id = r.id returning order_seq into v_no;
  insert into public.orders(restaurant_id, table_id, table_number, no, pay_method, total, note, idem_key, guest_token, payment, session_id)
  values (r.id, t.id, t.number, v_no, p_pay, v_total, left(coalesce(p_note, ''), 300), p_idem, p_guest,
          case when p_pay = 'online' then jsonb_build_object('state', 'pending') end, v_sid)
  on conflict (restaurant_id, idem_key) do nothing
  returning * into o;
  if o.id is null then
    select * into o from public.orders where restaurant_id = r.id and idem_key = p_idem;
    return jsonb_build_object('ok', true, 'duplicate', true, 'order', public.order_json(o.id));
  end if;

  insert into public.order_lines(order_id, item_id, name, qty, unit_price, addons)
  select o.id, (x->>'item_id')::uuid, x->'name', (x->>'qty')::int, (x->>'unit_price')::int, x->'addons'
  from jsonb_array_elements(v_lines) x;

  return jsonb_build_object('ok', true, 'order', public.order_json(o.id));
end $$;

-- очистка: связи с телефонами гостей в запросах и сессиях — через 2 дня
create or replace function public.privacy_cleanup() returns void
language sql security definer set search_path = public as $$
  update public.orders set guest_token = '00000000-0000-0000-0000-000000000000'
    where guest_token <> '00000000-0000-0000-0000-000000000000' and created_at < now() - interval '2 days';
  update public.orders set note = '' where note <> '' and created_at < now() - interval '30 days';
  update public.table_requests set guest_token = '00000000-0000-0000-0000-000000000000'
    where guest_token <> '00000000-0000-0000-0000-000000000000' and created_at < now() - interval '2 days';
  delete from public.session_guests where joined_at < now() - interval '2 days';
  delete from public.join_attempts where created_at < now() - interval '1 day';
$$;

revoke execute on function public.open_session_for(uuid), public.live_session(uuid), public.maybe_close_session(uuid), public.privacy_cleanup() from public, anon, authenticated;
grant execute on function public.table_access(text, uuid), public.request_table(text, uuid), public.join_table(text, uuid, text) to anon, authenticated;
revoke execute on function public.approve_table_request(uuid), public.deny_table_request(uuid), public.open_table(uuid), public.close_table(uuid) from public, anon;
grant execute on function public.approve_table_request(uuid), public.deny_table_request(uuid), public.open_table(uuid), public.close_table(uuid) to authenticated;

-- Для уже работающих ресторанов: открыть стол демо можно и без запроса — кнопкой «Открыть стол» в кабинете.
