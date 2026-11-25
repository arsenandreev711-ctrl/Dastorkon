-- NFC menu: схема базы данных для Supabase
-- Запуск: Supabase → SQL Editor → New query → вставить весь файл → Run.
-- Повторный запуск безопасен только на пустой базе (файл создаёт таблицы).


-- ============ ТАБЛИЦЫ ============

create table public.platform_admins(
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table public.restaurants(
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  tagline jsonb not null default '{}'::jsonb,
  city text not null default 'Бишкек',
  cover_url text,
  logo_url text,
  plan text not null default 'start' check (plan in ('start','cafe','net')),
  paid_until date,
  active boolean not null default true,
  online_pay boolean not null default false,
  route text not null default 'waiter' check (route in ('waiter','kitchen')),
  order_seq int not null default 100,
  created_at timestamptz not null default now()
);

create table public.staff(
  restaurant_id uuid not null references public.restaurants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'manager' check (role in ('owner','manager','waiter','kitchen')),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

create table public.categories(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  name jsonb not null default '{}'::jsonb,
  sort int not null default 0
);

create table public.items(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  category_id uuid references public.categories on delete set null,
  name jsonb not null default '{}'::jsonb,
  descr jsonb not null default '{}'::jsonb,
  ingredients jsonb not null default '{}'::jsonb,
  allergens text[] not null default '{}',
  portion text not null default '',
  price int not null default 0 check (price >= 0 and price <= 10000000),
  available boolean not null default true,
  photo_url text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.addons(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  name jsonb not null default '{}'::jsonb,
  price int not null default 0 check (price >= 0 and price <= 10000000),
  sort int not null default 0
);

create table public.tags(
  code text primary key check (code ~ '^[A-Z0-9]{6,12}$'),
  restaurant_id uuid references public.restaurants on delete set null,
  created_at timestamptz not null default now()
);

create table public.tables(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  number int not null check (number between 1 and 9999),
  tag_code text unique references public.tags(code) on delete set null,
  active boolean not null default true,
  unique (restaurant_id, number)
);

create table public.orders(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants on delete cascade,
  table_id uuid references public.tables on delete set null,
  table_number int not null,
  no int not null,
  status text not null default 'accepted' check (status in ('accepted','cooking','ready','served','cancelled')),
  pay_method text not null check (pay_method in ('online','waiter')),
  paid boolean not null default false,
  paid_at timestamptz,
  total int not null check (total >= 0),
  note text not null default '',
  idem_key text not null,
  guest_token uuid not null,
  payment jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, idem_key)
);
create index orders_rest_created on public.orders(restaurant_id, created_at desc);
create index orders_guest on public.orders(guest_token, created_at desc);

create table public.order_lines(
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders on delete cascade,
  item_id uuid,
  name jsonb not null,
  qty int not null check (qty between 1 and 50),
  unit_price int not null check (unit_price >= 0),
  addons jsonb not null default '[]'::jsonb
);
create index order_lines_order on public.order_lines(order_id);

-- ============ ПРАВА ============

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  if t is null or t !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return t::uuid;
end $$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.is_staff(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists(select 1 from public.staff where restaurant_id = rid and user_id = auth.uid())
$$;

create or replace function public.is_manager(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin()
      or exists(select 1 from public.staff where restaurant_id = rid and user_id = auth.uid() and role in ('owner','manager'))
$$;

alter table public.platform_admins enable row level security;
alter table public.restaurants enable row level security;
alter table public.staff enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.addons enable row level security;
alter table public.tags enable row level security;
alter table public.tables enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

create policy pa_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

create policy r_read on public.restaurants for select to authenticated using (public.is_staff(id));
create policy r_update on public.restaurants for update to authenticated using (public.is_manager(id)) with check (public.is_manager(id));
create policy r_admin on public.restaurants for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy s_read on public.staff for select to authenticated using (public.is_staff(restaurant_id));
create policy s_admin on public.staff for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy c_read on public.categories for select to authenticated using (public.is_staff(restaurant_id));
create policy c_write on public.categories for all to authenticated using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));
create policy i_read on public.items for select to authenticated using (public.is_staff(restaurant_id));
create policy i_write on public.items for all to authenticated using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));
create policy a_read on public.addons for select to authenticated using (public.is_staff(restaurant_id));
create policy a_write on public.addons for all to authenticated using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));

create policy tg_read on public.tags for select to authenticated using (public.is_platform_admin() or public.is_staff(restaurant_id));
create policy tg_admin on public.tags for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy t_read on public.tables for select to authenticated using (public.is_staff(restaurant_id));
create policy t_write on public.tables for all to authenticated using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));

-- Заказы читают сотрудники; меняются только через функции ниже.
create policy o_read on public.orders for select to authenticated using (public.is_staff(restaurant_id));
create policy ol_read on public.order_lines for select to authenticated
  using (exists(select 1 from public.orders o where o.id = order_id and public.is_staff(o.restaurant_id)));

-- Тариф, оплату подписки и включение онлайн-оплаты меняет только админ платформы.
create or replace function public.protect_restaurant() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') and not public.is_platform_admin() then
    new.plan := old.plan; new.paid_until := old.paid_until; new.active := old.active;
    new.online_pay := old.online_pay; new.order_seq := old.order_seq;
  end if;
  return new;
end $$;
create trigger restaurants_protect before update on public.restaurants
  for each row execute function public.protect_restaurant();

-- К столу можно привязать только метку, выданную этому ресторану.
create or replace function public.check_table_tag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tag_code is not null and not exists(
      select 1 from public.tags where code = new.tag_code and restaurant_id = new.restaurant_id) then
    raise exception 'tag_not_yours';
  end if;
  return new;
end $$;
create trigger tables_tag before insert or update on public.tables
  for each row execute function public.check_table_tag();

-- ============ ФУНКЦИИ ДЛЯ ГОСТЯ ============

create or replace function public.serviceable(r public.restaurants) returns boolean
language sql stable as $$
  select r.active and (r.paid_until is null or r.paid_until >= current_date - 3)
$$;

create or replace function public.order_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'no', o.no, 'table_number', o.table_number, 'status', o.status,
    'pay_method', o.pay_method, 'paid', o.paid, 'total', o.total, 'note', o.note,
    'created_at', o.created_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'qty', l.qty, 'unit_price', l.unit_price, 'addons', l.addons) order by l.id)
                       from public.order_lines l where l.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_id
$$;

-- Меню по коду NFC-метки
create or replace function public.get_menu(p_tag text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tables; r public.restaurants;
begin
  select * into t from public.tables where tag_code = upper(trim(p_tag));
  if not found then return jsonb_build_object('ok', false, 'code', 'tag_not_found'); end if;
  select * into r from public.restaurants where id = t.restaurant_id;
  if not public.serviceable(r) then return jsonb_build_object('ok', false, 'code', 'restaurant_off'); end if;
  return jsonb_build_object('ok', true,
    'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'tagline', r.tagline, 'cover_url', r.cover_url, 'logo_url', r.logo_url, 'online_pay', r.online_pay),
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

-- Создание заказа. Цены и наличие берутся из базы, повтор с тем же ключом возвращает тот же заказ.
create or replace function public.create_order(p_tag text, p_lines jsonb, p_pay text, p_note text, p_idem text, p_guest uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tables; r public.restaurants; o public.orders; it public.items;
  l jsonb; v_qty int; v_add_sum int; v_adds jsonb; v_unit int; v_total int := 0;
  v_gone jsonb := '[]'::jsonb; v_lines jsonb := '[]'::jsonb; v_no int; v_ids uuid[];
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
  insert into public.orders(restaurant_id, table_id, table_number, no, pay_method, total, note, idem_key, guest_token, payment)
  values (r.id, t.id, t.number, v_no, p_pay, v_total, left(coalesce(p_note, ''), 300), p_idem, p_guest,
          case when p_pay = 'online' then jsonb_build_object('state', 'pending') end)
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

-- Заказы гостя за последние 12 часов (по секретному токену из его телефона)
create or replace function public.guest_orders(p_guest uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.order_json(o.id) order by o.created_at), '[]'::jsonb)
  from public.orders o where o.guest_token = p_guest and o.created_at > now() - interval '12 hours'
$$;

-- ============ ФУНКЦИИ ДЛЯ ПЕРСОНАЛА ============

create or replace function public.advance_order(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o public.orders; nxt text;
begin
  select * into o from public.orders where id = p_id for update;
  if not found or not public.is_staff(o.restaurant_id) then raise exception 'forbidden'; end if;
  nxt := case o.status when 'accepted' then 'cooking' when 'cooking' then 'ready' when 'ready' then 'served' else o.status end;
  update public.orders set status = nxt, updated_at = now() where id = p_id;
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
  return public.order_json(p_id);
end $$;

-- Отметить оплату официанту. Онлайн-оплату отмечает только платёжный провайдер (серверная функция с секретным ключом).
create or replace function public.mark_paid(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found or not public.is_staff(o.restaurant_id) then raise exception 'forbidden'; end if;
  if o.pay_method <> 'waiter' then raise exception 'online_order'; end if;
  update public.orders set paid = true, paid_at = now(), updated_at = now() where id = p_id;
  return public.order_json(p_id);
end $$;

create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'email', (select email from auth.users where id = auth.uid()),
    'is_admin', public.is_platform_admin(),
    'admins_exist', exists(select 1 from public.platform_admins),
    'restaurants', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'role', coalesce(s.role, 'admin')) order by r.name)
      from public.restaurants r
      left join public.staff s on s.restaurant_id = r.id and s.user_id = auth.uid()
      where s.user_id is not null or public.is_platform_admin()), '[]'::jsonb))
$$;

create or replace function public.list_staff(p_rid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager(p_rid) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email, 'role', s.role) order by s.created_at)
    from public.staff s join auth.users u on u.id = s.user_id where s.restaurant_id = p_rid), '[]'::jsonb);
end $$;

-- Добавить сотрудника по email. Человек сначала сам регистрируется в кабинете.
create or replace function public.add_staff(p_rid uuid, p_email text, p_role text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid; me_owner boolean;
begin
  me_owner := exists(select 1 from public.staff where restaurant_id = p_rid and user_id = auth.uid() and role = 'owner');
  if not (public.is_platform_admin() or me_owner) then raise exception 'forbidden'; end if;
  if p_role not in ('owner','manager','waiter','kitchen') then raise exception 'bad_role'; end if;
  if p_role = 'owner' and not public.is_platform_admin() then raise exception 'forbidden'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return jsonb_build_object('ok', false, 'code', 'user_not_found'); end if;
  insert into public.staff(restaurant_id, user_id, role) values (p_rid, uid, p_role)
    on conflict (restaurant_id, user_id) do update set role = excluded.role;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.remove_staff(p_rid uuid, p_user uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare me_owner boolean;
begin
  me_owner := exists(select 1 from public.staff where restaurant_id = p_rid and user_id = auth.uid() and role = 'owner');
  if not (public.is_platform_admin() or me_owner) then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_remove_self'; end if;
  delete from public.staff where restaurant_id = p_rid and user_id = p_user;
  return true;
end $$;

-- Выпуск NFC-меток для ресторана (только админ платформы)
create or replace function public.issue_tags(p_rid uuid, p_count int) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_code text; made jsonb := '[]'::jsonb; i int; k int;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if p_count < 1 or p_count > 200 then raise exception 'bad_count'; end if;
  for i in 1..p_count loop
    loop
      v_code := '';
      for k in 1..7 loop v_code := v_code || substr(alphabet, 1 + (get_byte(uuid_send(gen_random_uuid()), 0) % 32), 1); end loop;
      exit when not exists(select 1 from public.tags t where t.code = v_code);
    end loop;
    insert into public.tags(code, restaurant_id) values (v_code, p_rid);
    made := made || jsonb_build_array(v_code);
  end loop;
  return made;
end $$;

create or replace function public.admin_staff() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'admins', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email)) from public.platform_admins p join auth.users u on u.id = p.user_id), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('restaurant_id', s.restaurant_id, 'restaurant', r.name, 'user_id', s.user_id, 'email', u.email, 'role', s.role) order by r.name, u.email)
       from public.staff s join auth.users u on u.id = s.user_id join public.restaurants r on r.id = s.restaurant_id), '[]'::jsonb));
end $$;

-- ============ ДОСТУП К ФУНКЦИЯМ ============

revoke execute on function public.order_json(uuid) from public, anon, authenticated;
revoke execute on function public.protect_restaurant() from public, anon, authenticated;
revoke execute on function public.check_table_tag() from public, anon, authenticated;
grant execute on function public.get_menu(text) to anon, authenticated;
grant execute on function public.create_order(text, jsonb, text, text, text, uuid) to anon, authenticated;
grant execute on function public.guest_orders(uuid) to anon, authenticated;
revoke execute on function public.advance_order(uuid), public.cancel_order(uuid), public.mark_paid(uuid), public.my_context(),
  public.list_staff(uuid), public.add_staff(uuid, text, text), public.remove_staff(uuid, uuid),
  public.issue_tags(uuid, int), public.admin_staff() from public, anon;
grant execute on function public.advance_order(uuid), public.cancel_order(uuid), public.mark_paid(uuid), public.my_context(),
  public.list_staff(uuid), public.add_staff(uuid, text, text), public.remove_staff(uuid, uuid),
  public.issue_tags(uuid, int), public.admin_staff() to authenticated;

-- ============ ЗАКАЗЫ В РЕАЛЬНОМ ВРЕМЕНИ ============
alter publication supabase_realtime add table public.orders;

-- ============ ФОТО БЛЮД И ЗАВЕДЕНИЯ ============
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('menu', 'menu', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy menu_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu' and public.is_manager(public.try_uuid((storage.foldername(name))[1])));
create policy menu_update on storage.objects for update to authenticated
  using (bucket_id = 'menu' and public.is_manager(public.try_uuid((storage.foldername(name))[1])));
create policy menu_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu' and public.is_manager(public.try_uuid((storage.foldername(name))[1])));
