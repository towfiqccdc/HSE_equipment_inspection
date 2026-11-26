-- The inspector no longer decides. The report carries a decision section that the HSE / Operations
-- departments tick after they receive it. New header fields: brand, model, capacity, location.
alter table public.inspections add column if not exists brand text, add column if not exists model text,
  add column if not exists capacity text, add column if not exists location text;
alter table public.inspections alter column tag drop not null;
alter table public.inspections drop constraint if exists inspections_tag_check;
alter table public.inspections alter column verdict drop not null;
alter table public.inspections drop constraint if exists inspections_verdict_check;

create or replace function public.save_inspection(p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_id uuid; v_type text; v_c public.checklist_items%rowtype; v_in jsonb; v_o jsonb;
  v_sev text; v_files text[]; v_file text; v_out jsonb := '[]'::jsonb; v_oth jsonb := '[]'::jsonb;
  v_critical boolean := false; v_brand text; v_date date; v_cert date; v_n int := 0;
begin
  select * into v_a from app.actor();
  if v_a.urole is null or v_a.urole not in ('hse','admin') then raise exception 'Only HSE can save an inspection'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'Invalid data'; end if;
  begin v_id := (p_data->>'id')::uuid; exception when others then raise exception 'Invalid inspection id'; end;
  if exists (select 1 from public.inspections where id = v_id) then
    if exists (select 1 from public.inspections where id = v_id and created_by = v_a.uid) then return v_id; end if;
    raise exception 'This inspection id is already used';
  end if;
  v_type := p_data->>'type';
  if v_type is null or v_type not in ('crane','forklift') then raise exception 'Choose crane or forklift'; end if;
  v_brand := left(btrim(coalesce(p_data->>'brand', '')), 80);
  if v_brand = '' then raise exception 'Enter the brand of the machine'; end if;
  begin v_date := coalesce(nullif(p_data->>'inspected_on', '')::date, app.today()); exception when others then raise exception 'Invalid inspection date'; end;
  begin v_cert := nullif(p_data->>'cert_expiry', '')::date; exception when others then raise exception 'Invalid certificate date'; end;

  for v_c in select * from public.checklist_items where equipment_type = v_type and active order by sort loop
    v_in := null;
    select x into v_in from jsonb_array_elements(case when jsonb_typeof(p_data->'items') = 'array' then p_data->'items' else '[]'::jsonb end) as x where x->>'key' = v_c.key limit 1;
    v_sev := v_in->>'sev';
    if v_sev is null or v_sev not in ('ok','minor','major','critical','na') then raise exception 'Rate every checklist item: %', v_c.label_en; end if;
    if v_sev = 'critical' then v_critical := true; end if;
    select coalesce(array_agg(fe.val), '{}'::text[]) into v_files
      from jsonb_array_elements_text(case when jsonb_typeof(v_in->'files') = 'array' then v_in->'files' else '[]'::jsonb end) as fe(val);
    if coalesce(array_length(v_files, 1), 0) > 8 then raise exception 'Too many files for: %', v_c.label_en; end if;
    foreach v_file in array v_files loop
      if v_file not like (v_id::text || '/%') or position('..' in v_file) > 0 then raise exception 'Invalid file reference'; end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'inspection-photos' and o.name = v_file
                     and ((o.metadata->>'mimetype') like 'image/%' or (o.metadata->>'mimetype') like 'video/%')) then
        raise exception 'File missing or wrong type for: %', v_c.label_en;
      end if;
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_c.key, 'kind', v_c.kind, 'section_en', v_c.section_en, 'section_zh', v_c.section_zh,
      'label_en', v_c.label_en, 'label_zh', v_c.label_zh,
      'sev', v_sev, 'note', left(btrim(coalesce(v_in->>'note', '')), 500),
      'reading', nullif(left(btrim(coalesce(v_in->>'reading', '')), 20), ''),
      'reading_label_en', v_c.reading_label_en, 'reading_label_zh', v_c.reading_label_zh, 'reading_unit', v_c.reading_unit,
      'files', to_jsonb(v_files)));
  end loop;

  if jsonb_typeof(p_data->'others') = 'array' then
    for v_o in select x from jsonb_array_elements(p_data->'others') as x loop
      if left(btrim(coalesce(v_o->>'note', '')), 500) = '' then continue; end if;
      v_n := v_n + 1;
      if v_n > 20 then raise exception 'Too many observations in Others'; end if;
      v_sev := v_o->>'sev';
      if v_sev is null or v_sev not in ('minor','major','critical') then raise exception 'Choose a severity for each observation in Others'; end if;
      if v_sev = 'critical' then v_critical := true; end if;
      select coalesce(array_agg(fe.val), '{}'::text[]) into v_files
        from jsonb_array_elements_text(case when jsonb_typeof(v_o->'files') = 'array' then v_o->'files' else '[]'::jsonb end) as fe(val);
      if coalesce(array_length(v_files, 1), 0) > 8 then raise exception 'Too many files in Others'; end if;
      foreach v_file in array v_files loop
        if v_file not like (v_id::text || '/%') or position('..' in v_file) > 0 then raise exception 'Invalid file reference'; end if;
        if not exists (select 1 from storage.objects o where o.bucket_id = 'inspection-photos' and o.name = v_file
                       and ((o.metadata->>'mimetype') like 'image/%' or (o.metadata->>'mimetype') like 'video/%')) then
          raise exception 'File missing or wrong type in Others';
        end if;
      end loop;
      v_oth := v_oth || jsonb_build_array(jsonb_build_object('sev', v_sev, 'note', left(btrim(v_o->>'note'), 500), 'files', to_jsonb(v_files)));
    end loop;
  end if;

  insert into public.inspections (id, created_by, inspector_name, equipment_type, brand, model, capacity, location, inspected_on, cert_expiry,
                                  items, others, comment)
  values (v_id, v_a.uid, coalesce(nullif(left(btrim(coalesce(p_data->>'inspector', '')), 120), ''), nullif(v_a.uname, ''), 'HSE'),
          v_type, v_brand, nullif(left(btrim(coalesce(p_data->>'model', '')), 80), ''), nullif(left(btrim(coalesce(p_data->>'capacity', '')), 80), ''),
          nullif(left(btrim(coalesce(p_data->>'location', '')), 120), ''), v_date, v_cert, v_out, v_oth,
          nullif(left(btrim(coalesce(p_data->>'comment', '')), 2000), ''));
  return v_id;
end
$fn$;

revoke all on function public.save_inspection(jsonb) from public, anon;
grant execute on function public.save_inspection(jsonb) to authenticated;
