-- Simplify: HSE-only inspection tool. No contractor or Operations steps.
-- Removes the old workflow tables and functions, adds one table (inspections) and two functions.

-- ---- remove the old workflow
drop policy if exists "evidence read" on storage.objects;
drop policy if exists "evidence upload" on storage.objects;
drop view if exists public.equipment_overview;
drop table if exists public.inspection_conditions, public.reviews, public.audit_events, public.inspections, public.equipment cascade;
do $d$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $d$;
drop function if exists app.log(uuid, uuid, text, jsonb, uuid, text, text);

-- ---- inspections
create table public.inspections (
  id uuid primary key,                       -- made on the phone, so photo paths are known before saving
  created_by uuid references auth.users(id) on delete set null,
  inspector_name text not null,
  equipment_type text not null check (equipment_type in ('crane','forklift')),
  tag text not null check (btrim(tag) <> ''),
  serial text,
  company text,                              -- contractor / owner of the machine, free text
  rig text,
  inspected_on date not null,
  cert_expiry date,
  items jsonb not null default '[]'::jsonb,  -- checklist with ratings, notes, photo paths
  others jsonb not null default '[]'::jsonb, -- extra observations
  verdict text not null check (verdict in ('accept','conditions','reject')),
  comment text,
  conditions text,
  created_at timestamptz not null default now()
);
create index inspections_created_by_idx on public.inspections (created_by);
create index inspections_date_idx on public.inspections (inspected_on desc, created_at desc);
alter table public.inspections enable row level security;
create policy inspections_select on public.inspections for select to authenticated
  using ((select app.user_role()) in ('hse','admin'));
revoke all on public.inspections from anon, authenticated;
grant select on public.inspections to authenticated;

-- ---- save (one call, after the photos are uploaded)
create function public.save_inspection(p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_id uuid; v_type text; v_c public.checklist_items%rowtype; v_in jsonb; v_o jsonb;
  v_sev text; v_files text[]; v_file text; v_out jsonb := '[]'::jsonb; v_oth jsonb := '[]'::jsonb;
  v_critical boolean := false; v_verdict text; v_tag text; v_cond text; v_date date; v_cert date; v_n int := 0;
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
  v_tag := left(btrim(coalesce(p_data->>'tag', '')), 80);
  if v_tag = '' then raise exception 'Enter the tag or ID of the machine'; end if;
  begin v_date := coalesce(nullif(p_data->>'inspected_on', '')::date, app.today()); exception when others then raise exception 'Invalid inspection date'; end;
  begin v_cert := nullif(p_data->>'cert_expiry', '')::date; exception when others then raise exception 'Invalid certificate date'; end;
  v_verdict := p_data->>'verdict';
  if v_verdict is null or v_verdict not in ('accept','conditions','reject') then raise exception 'Choose the result'; end if;
  v_cond := nullif(left(btrim(coalesce(p_data->>'conditions', '')), 2000), '');

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

  if v_critical and v_verdict <> 'reject' then raise exception 'A critical finding means the machine must be rejected'; end if;
  if v_verdict = 'conditions' and v_cond is null then raise exception 'Write the conditions'; end if;

  insert into public.inspections (id, created_by, inspector_name, equipment_type, tag, serial, company, rig, inspected_on, cert_expiry,
                                  items, others, verdict, comment, conditions)
  values (v_id, v_a.uid, coalesce(nullif(left(btrim(coalesce(p_data->>'inspector', '')), 120), ''), nullif(v_a.uname, ''), 'HSE'),
          v_type, v_tag, nullif(left(btrim(coalesce(p_data->>'serial', '')), 80), ''), nullif(left(btrim(coalesce(p_data->>'company', '')), 120), ''),
          nullif(left(btrim(coalesce(p_data->>'rig', '')), 120), ''), v_date, v_cert, v_out, v_oth, v_verdict,
          nullif(left(btrim(coalesce(p_data->>'comment', '')), 2000), ''), v_cond);
  return v_id;
end
$fn$;

create function public.delete_inspection(p_id uuid)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare v_a record;
begin
  select * into v_a from app.actor();
  if v_a.urole is null or v_a.urole not in ('hse','admin') then raise exception 'Only HSE can delete an inspection'; end if;
  delete from public.inspections where id = p_id and (created_by = v_a.uid or v_a.urole = 'admin');
  if not found then raise exception 'Inspection not found'; end if;
end
$fn$;
revoke all on function public.save_inspection(jsonb), public.delete_inspection(uuid) from public, anon;
grant execute on function public.save_inspection(jsonb), public.delete_inspection(uuid) to authenticated;

-- ---- private photo storage: HSE only
create policy "hse files read" on storage.objects for select to authenticated
  using (bucket_id = 'inspection-photos' and (select app.user_role()) in ('hse','admin'));
create policy "hse files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'inspection-photos' and (select app.user_role()) in ('hse','admin'));
create policy "hse files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'inspection-photos' and (select app.user_role()) in ('hse','admin'));

-- ---- people: only the HSE test account is kept; new sign-ups wait for an admin to set their role
delete from auth.users where email in ('contractor.test@example.com','contractor2.test@example.com','ops.test@example.com','admin.test@example.com');
