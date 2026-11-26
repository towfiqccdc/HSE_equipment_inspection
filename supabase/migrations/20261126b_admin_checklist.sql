-- Admin page: edit the checklist form for crane and forklift (names, sections, order, add/remove).
create or replace function public.admin_save_checklist(p_type text, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_it jsonb; v_i int := 0; v_key text; v_keep text[] := '{}'; v_label text; v_sec text; v_lzh text;
begin
  select * into v_a from app.actor();
  if v_a.urole is distinct from 'admin' then raise exception 'Only an admin can edit the checklist'; end if;
  if p_type is null or p_type not in ('crane','forklift') then raise exception 'Choose crane or forklift'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Invalid list'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'The checklist cannot be empty'; end if;
  if jsonb_array_length(p_items) > 80 then raise exception 'Too many items (80 at most)'; end if;
  for v_it in select x from jsonb_array_elements(p_items) as x loop
    v_i := v_i + 1;
    v_label := left(btrim(coalesce(v_it->>'label_en', '')), 120);
    if v_label = '' then raise exception 'Every item needs an English name (item %)', v_i; end if;
    v_lzh := coalesce(nullif(left(btrim(coalesce(v_it->>'label_zh', '')), 120), ''), v_label);
    v_sec := coalesce(nullif(left(btrim(coalesce(v_it->>'section_en', '')), 80), ''), 'General');
    v_key := nullif(btrim(coalesce(v_it->>'key', '')), '');
    if v_key is not null and not exists (select 1 from public.checklist_items where equipment_type = p_type and key = v_key) then v_key := null; end if;
    if v_key is null then v_key := 'c_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8); end if;
    v_keep := v_keep || v_key;
    insert into public.checklist_items (equipment_type, key, sort, kind, required, section_en, section_zh, label_en, label_zh, hint_en, hint_zh,
                                        reading_label_en, reading_label_zh, reading_unit, active)
    values (p_type, v_key, v_i * 10, 'photo', true, v_sec, coalesce(nullif(left(btrim(coalesce(v_it->>'section_zh', '')), 80), ''), v_sec),
            v_label, v_lzh, nullif(left(btrim(coalesce(v_it->>'hint_en', '')), 300), ''), nullif(left(btrim(coalesce(v_it->>'hint_zh', '')), 300), ''),
            nullif(left(btrim(coalesce(v_it->>'reading_label_en', '')), 60), ''), nullif(left(btrim(coalesce(v_it->>'reading_label_zh', '')), 60), ''),
            nullif(left(btrim(coalesce(v_it->>'reading_unit', '')), 12), ''), coalesce((v_it->>'active')::boolean, true))
    on conflict (equipment_type, key) do update set
      sort = excluded.sort, section_en = excluded.section_en, section_zh = excluded.section_zh, label_en = excluded.label_en, label_zh = excluded.label_zh,
      hint_en = excluded.hint_en, hint_zh = excluded.hint_zh, reading_label_en = excluded.reading_label_en, reading_label_zh = excluded.reading_label_zh,
      reading_unit = excluded.reading_unit, active = excluded.active;
  end loop;
  delete from public.checklist_items where equipment_type = p_type and not (key = any (v_keep));
end
$fn$;
revoke all on function public.admin_save_checklist(text, jsonb) from public, anon;
grant execute on function public.admin_save_checklist(text, jsonb) to authenticated;

-- the test account can use both views (Inspector and Admin)
update public.profiles set role = 'admin' where email = 'hse.test@example.com';
