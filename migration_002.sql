-- Dastorkon: миграция 002 — усиление безопасности и автоматическое удаление лишних данных
-- Запуск: Supabase → SQL Editor → New query → вставить файл → Run. Повторный запуск безопасен.

-- 1. Фиксированный search_path у служебных функций
alter function public.try_uuid(text) set search_path = public;
alter function public.serviceable(public.restaurants) set search_path = public;

-- 2. Проверки прав вызываются только из правил доступа для вошедших пользователей
revoke execute on function public.is_platform_admin(), public.is_staff(uuid), public.is_manager(uuid) from public, anon;
grant execute on function public.is_platform_admin(), public.is_staff(uuid), public.is_manager(uuid) to authenticated;

-- 3. Первичное назначение администратора больше не нужно: администраторы уже есть
drop function if exists public.claim_platform_admin();

-- 4. Список сотрудников с email видят только владелец и управляющий
create or replace function public.list_staff(p_rid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager(p_rid) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email, 'role', s.role) order by s.created_at)
    from public.staff s join auth.users u on u.id = s.user_id where s.restaurant_id = p_rid), '[]'::jsonb);
end $$;


-- 5. Ссылки на фото — только https (защита от вредных ссылок в кабинете)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_cover_https') then
    alter table public.restaurants add constraint restaurants_cover_https check (cover_url is null or cover_url ~ '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restaurants_logo_https') then
    alter table public.restaurants add constraint restaurants_logo_https check (logo_url is null or logo_url ~ '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_photo_https') then
    alter table public.items add constraint items_photo_https check (photo_url is null or photo_url ~ '^https://');
  end if;
end $$;

-- 6. Ограничение частоты заказов
create index if not exists orders_table_created on public.orders(table_id, created_at desc);
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


-- 7. Автоматическое удаление лишнего: связь заказа с устройством гостя — через 2 дня, комментарий — через 30 дней
create or replace function public.privacy_cleanup() returns void
language sql security definer set search_path = public as $$
  update public.orders set guest_token = '00000000-0000-0000-0000-000000000000'
    where guest_token <> '00000000-0000-0000-0000-000000000000' and created_at < now() - interval '2 days';
  update public.orders set note = '' where note <> '' and created_at < now() - interval '30 days';
$$;
revoke execute on function public.privacy_cleanup() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'dastorkon-privacy-cleanup';
select cron.schedule('dastorkon-privacy-cleanup', '17 3 * * *', 'select public.privacy_cleanup()');
select public.privacy_cleanup();
