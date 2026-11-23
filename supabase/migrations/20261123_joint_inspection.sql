-- CCDC HSE Equipment Inspection — joint inspection workflow (roles, locked-down access, review rules)
-- Safe to run once on the project created for this app. Replaces the open-access policies.

-- ============================================================ helpers & profiles
create schema if not exists app;
grant usage on schema app to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  role text check (role in ('contractor','hse','operations','admin')),
  company text,
  requested_role text,
  requested_company text,
  created_at timestamptz not null default now(),
  constraint contractor_needs_company check (role is distinct from 'contractor' or nullif(btrim(company), '') is not null)
);
alter table public.profiles enable row level security;

create function app.user_role() returns text language sql stable security definer set search_path = '' as
$fn$ select p.role from public.profiles p where p.id = auth.uid() $fn$;

create function app.company() returns text language sql stable security definer set search_path = '' as
$fn$ select p.company from public.profiles p where p.id = auth.uid() $fn$;

create function app.is_staff() returns boolean language sql stable security definer set search_path = '' as
$fn$ select coalesce((select p.role in ('hse','operations','admin') from public.profiles p where p.id = auth.uid()), false) $fn$;

-- "today" at the rig (Bangladesh time) so expiry and due dates do not flip at the wrong hour
create function app.today() returns date language sql stable set search_path = '' as
$fn$ select (now() at time zone 'Asia/Dhaka')::date $fn$;

create function app.actor(out uid uuid, out urole text, out uname text, out ucompany text)
returns record language sql stable security definer set search_path = '' as
$fn$ select p.id, p.role, p.full_name, p.company from public.profiles p where p.id = auth.uid() $fn$;

create function app.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as
$fn$
begin
  insert into public.profiles (id, email, full_name, requested_role, requested_company)
  values (
    new.id,
    new.email,
    left(coalesce(btrim(new.raw_user_meta_data->>'full_name'), ''), 120),
    case when new.raw_user_meta_data->>'requested_role' in ('contractor','hse','operations')
         then new.raw_user_meta_data->>'requested_role' end,
    left(nullif(btrim(new.raw_user_meta_data->>'company'), ''), 120)
  );
  return new;
end
$fn$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

insert into public.profiles (id, email)
select u.id, u.email from auth.users u on conflict (id) do nothing;

create policy "read profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.user_role()) = 'admin');

-- ============================================================ equipment
drop policy "open equipment" on public.equipment;
drop table public.reviews;
drop table public.inspections;

alter table public.equipment add column company text;
alter table public.equipment add column created_by uuid references auth.users(id) on delete set null;
update public.equipment set company = contractor where contractor is not null;
alter table public.equipment drop column contractor;
alter table public.equipment drop constraint equipment_tag_key;
create unique index equipment_tag_company_uniq on public.equipment (lower(btrim(tag)), lower(btrim(coalesce(company, ''))));
create unique index equipment_serial_uniq on public.equipment (lower(btrim(serial))) where nullif(btrim(serial), '') is not null;
create index equipment_company_idx on public.equipment (company);
create index equipment_created_by_idx on public.equipment (created_by);

-- ============================================================ checklist (editable by admin in the dashboard)
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  equipment_type text not null check (equipment_type in ('crane','forklift')),
  key text not null,
  sort int not null,
  kind text not null check (kind in ('photo','video')),
  required boolean not null default true,
  label_en text not null,
  label_zh text not null,
  hint_en text,
  hint_zh text,
  reading_label_en text,
  reading_label_zh text,
  reading_unit text,
  active boolean not null default true,
  unique (equipment_type, key)
);
alter table public.checklist_items enable row level security;
create policy "checklist readable" on public.checklist_items for select to authenticated using (true);

insert into public.checklist_items (equipment_type, key, sort, kind, required, label_en, label_zh, hint_en, hint_zh, reading_label_en, reading_label_zh, reading_unit) values
('forklift','overall_front',10,'photo',true,'Overall — front','整体 — 正面','Whole machine in one frame, tag or plate number visible.','整机入镜，需能看到编号牌。',null,null,null),
('forklift','overall_rear',20,'photo',true,'Overall — rear','整体 — 背面',null,null,null,null,null),
('forklift','left_side',30,'photo',true,'Left side','左侧',null,null,null,null,null),
('forklift','right_side',40,'photo',true,'Right side','右侧',null,null,null,null,null),
('forklift','forks',50,'photo',true,'Forks & heel','货叉及叉跟','Show both forks and the heel area for cracks or bends.','拍摄两个货叉及叉跟部位，注意裂纹或弯曲。',null,null,null),
('forklift','mast_chains',60,'photo',true,'Mast & lift chains','门架及起升链条',null,null,'Chain elongation (if measured)','链条伸长量（如已测量）','%'),
('forklift','tyres',70,'photo',true,'Tyres','轮胎','All tyres, including wear and any cuts.','所有轮胎，包括磨损和割伤。','Tread depth (if measured)','胎纹深度（如已测量）','mm'),
('forklift','overhead_guard',80,'photo',true,'Overhead guard & backrest','护顶架及挡货架',null,null,null,null,null),
('forklift','hydraulics',90,'photo',true,'Hydraulic hoses / leaks','液压软管 / 泄漏','Hoses, fittings and the ground under the machine.','软管、接头及机器下方地面。',null,null,null),
('forklift','safety_devices',100,'photo',true,'Seat belt, lights, horn & reverse alarm','安全带、灯光、喇叭及倒车报警器',null,null,null,null,null),
('forklift','data_plate',110,'photo',true,'Data plate / capacity plate','铭牌 / 额定载荷牌','Plate must be readable.','铭牌内容必须清晰可读。',null,null,null),
('forklift','certificates',120,'photo',true,'Certificates & inspection tag','证书及检验标签','Show issue and expiry dates clearly.','清晰显示签发日期和到期日期。',null,null,null),
('forklift','lift_test',130,'video',true,'Lift & tilt function test (video)','起升与倾斜功能测试（视频）','Short clip, about 15 seconds: raise, lower and tilt the mast.','约15秒短视频：升降并倾斜门架。',null,null,null),
('forklift','brake_test',140,'video',true,'Brake test (video)','制动测试（视频）','Short clip showing the machine stopping and holding.','短视频：展示车辆制动和驻车。',null,null,null),
('crane','overall_front',10,'photo',true,'Overall — front','整体 — 正面','Whole machine in one frame, tag or plate number visible.','整机入镜，需能看到编号牌。',null,null,null),
('crane','overall_rear',20,'photo',true,'Overall — rear','整体 — 背面',null,null,null,null,null),
('crane','left_side',30,'photo',true,'Left side','左侧',null,null,null,null,null),
('crane','right_side',40,'photo',true,'Right side','右侧',null,null,null,null,null),
('crane','boom',50,'photo',true,'Boom / structure','吊臂 / 结构','Welds, pins and any bends or cracks.','焊缝、销轴及任何弯曲或裂纹。',null,null,null),
('crane','rope_hook',60,'photo',true,'Wire rope & hook','钢丝绳及吊钩','Close-up of rope condition, hook latch and sheaves.','钢丝绳状况、吊钩保险及滑轮特写。','Wire rope diameter (if measured)','钢丝绳直径（如已测量）','mm'),
('crane','load_chart',70,'photo',true,'Load chart & SWL plate','载荷表及额定起重量牌','Plate must be readable.','铭牌内容必须清晰可读。',null,null,null),
('crane','outriggers',80,'photo',true,'Outriggers / tracks / tyres','支腿 / 履带 / 轮胎',null,null,null,null,null),
('crane','cabin',90,'photo',true,'Cabin & controls','驾驶室及操作装置',null,null,null,null,null),
('crane','limit_switches',100,'photo',true,'Limit switches & safety devices','限位器及安全装置',null,null,null,null,null),
('crane','data_plate',110,'photo',true,'Data plate','铭牌','Plate must be readable.','铭牌内容必须清晰可读。',null,null,null),
('crane','certificates',120,'photo',true,'Certificates & inspection tag','证书及检验标签','Show issue and expiry dates clearly.','清晰显示签发日期和到期日期。',null,null,null),
('crane','load_test_cert',130,'photo',true,'Load test / thorough examination certificate','载荷试验 / 全面检验证书',null,null,null,null,null),
('crane','hoist_test',140,'video',true,'Hoist / lift function test (video)','起升功能测试（视频）','Short clip, about 15 seconds: hoist and lower with no load.','约15秒短视频：空载升降。',null,null,null),
('crane','brake_test',150,'video',true,'Brake test (video)','制动测试（视频）','Short clip showing the brake holding.','短视频：展示制动保持。',null,null,null);

-- ============================================================ inspections (versioned, locked after submit)
create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  version int not null,
  status text not null check (status in ('awaiting_hse','awaiting_ops','info_requested','decided','superseded')),
  items jsonb not null,
  inspector_id uuid references auth.users(id) on delete set null,
  inspector_name text not null,
  contractor_message text,
  decision text check (decision in ('cleared','conditional','out_of_service')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (equipment_id, version),
  constraint decision_matches_status check ((status = 'decided') = (decision is not null))
);
create index inspections_status_idx on public.inspections (status);
create index inspections_inspector_idx on public.inspections (inspector_id);
create index inspections_decided_by_idx on public.inspections (decided_by);
alter table public.inspections enable row level security;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete restrict,
  dept text not null check (dept in ('HSE','Operations')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewer_name text not null,
  verdict text not null check (verdict in ('accept','conditions','reject','more_info')),
  comment text not null check (btrim(comment) <> ''),
  item_ratings jsonb,
  created_at timestamptz not null default now(),
  unique (inspection_id, dept)
);
create index reviews_reviewer_idx on public.reviews (reviewer_id);
alter table public.reviews enable row level security;

create table public.inspection_conditions (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete restrict,
  equipment_id uuid not null references public.equipment(id) on delete restrict,
  text text not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open','proof_submitted','closed')),
  proof_files jsonb not null default '[]'::jsonb,
  proof_note text,
  proof_by_name text,
  proof_at timestamptz,
  review_note text,
  closed_by_name text,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index conditions_inspection_idx on public.inspection_conditions (inspection_id);
create index conditions_equipment_idx on public.inspection_conditions (equipment_id);
alter table public.inspection_conditions enable row level security;

create table public.audit_events (
  id bigint generated always as identity primary key,
  equipment_id uuid,
  inspection_id uuid,
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_equipment_idx on public.audit_events (equipment_id);
create index audit_inspection_idx on public.audit_events (inspection_id);
alter table public.audit_events enable row level security;

create function app.log(p_equipment uuid, p_inspection uuid, p_action text, p_detail jsonb, p_actor uuid, p_name text, p_role text)
returns void language sql security definer set search_path = '' as
$fn$
  insert into public.audit_events (equipment_id, inspection_id, actor_id, actor_name, actor_role, action, detail)
  values (p_equipment, p_inspection, p_actor, p_name, p_role, p_action, p_detail)
$fn$;

-- ============================================================ read access (nobody can write directly)
create policy equipment_select on public.equipment for select to authenticated using (
  (select app.is_staff())
  or ((select app.user_role()) = 'contractor' and company is not null and company = (select app.company()))
);
create policy inspections_select on public.inspections for select to authenticated using (
  (select app.is_staff())
  or exists (select 1 from public.equipment e where e.id = inspections.equipment_id)
);
create policy conditions_select on public.inspection_conditions for select to authenticated using (
  (select app.is_staff())
  or exists (select 1 from public.equipment e where e.id = inspection_conditions.equipment_id)
);
create policy reviews_staff_select on public.reviews for select to authenticated using ((select app.is_staff()));
create policy audit_staff_select on public.audit_events for select to authenticated using ((select app.is_staff()));

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
grant select on public.equipment, public.inspections, public.reviews, public.inspection_conditions,
  public.audit_events, public.checklist_items, public.profiles to authenticated;

-- ============================================================ overview used by the dashboard
create view public.equipment_overview with (security_invoker = true) as
select
  e.id, e.tag, e.type, e.serial, e.rig, e.company, e.cert_expiry,
  case when e.cert_expiry is null then null else e.cert_expiry - app.today() end as cert_days,
  i.id as inspection_id, i.version, i.status as inspection_status, i.decision,
  i.created_at as submitted_at, i.decided_at,
  coalesce(c.open_count, 0) as open_conditions,
  coalesce(c.overdue_count, 0) as overdue_conditions,
  coalesce(c.proof_count, 0) as proofs_waiting,
  case
    when i.id is null then 'none'
    when i.status = 'decided' and i.decision = 'conditional' and coalesce(c.total, 0) > 0 and coalesce(c.open_count, 0) = 0 then 'cleared'
    when i.status = 'decided' then i.decision
    else i.status
  end as stage
from public.equipment e
left join lateral (
  select x.* from public.inspections x where x.equipment_id = e.id order by x.version desc limit 1
) i on true
left join lateral (
  select count(*) as total,
         count(*) filter (where k.status <> 'closed') as open_count,
         count(*) filter (where k.status = 'open' and k.due_date < app.today()) as overdue_count,
         count(*) filter (where k.status = 'proof_submitted') as proof_count
  from public.inspection_conditions k where k.inspection_id = i.id
) c on i.id is not null;
grant select on public.equipment_overview to authenticated;

-- ============================================================ workflow functions (the only way to change data)
create function public.register_equipment(p_tag text, p_type text, p_serial text, p_rig text, p_cert_expiry date, p_company text default null)
returns uuid language plpgsql security definer set search_path = '' as
$fn$
declare v_a record; v_company text; v_id uuid;
begin
  select * into v_a from app.actor();
  if v_a.urole is null then raise exception 'Your account is not approved yet'; end if;
  v_company := case when v_a.urole = 'contractor' then v_a.ucompany else nullif(btrim(coalesce(p_company, '')), '') end;
  if v_company is null then raise exception 'Company is required'; end if;
  if nullif(btrim(coalesce(p_tag, '')), '') is null then raise exception 'Tag or plate number is required'; end if;
  if p_type is null or p_type not in ('crane','forklift') then raise exception 'Type must be crane or forklift'; end if;
  if nullif(btrim(coalesce(p_serial, '')), '') is null then raise exception 'Serial number is required'; end if;
  if p_cert_expiry is null then raise exception 'Certificate expiry date is required'; end if;
  begin
    insert into public.equipment (tag, type, serial, rig, company, cert_expiry, created_by)
    values (btrim(p_tag), p_type, btrim(p_serial), nullif(btrim(coalesce(p_rig, '')), ''), v_company, p_cert_expiry, v_a.uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This tag or serial number is already registered';
  end;
  perform app.log(v_id, null, 'equipment_registered', jsonb_build_object('tag', btrim(p_tag), 'serial', btrim(p_serial)), v_a.uid, v_a.uname, v_a.urole);
  return v_id;
end
$fn$;

create function public.set_cert_expiry(p_equipment_id uuid, p_expiry date)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare v_a record; v_old date;
begin
  select * into v_a from app.actor();
  if v_a.urole not in ('hse','operations','admin') or v_a.urole is null then raise exception 'Only HSE, Operations or an admin can change a certificate date'; end if;
  if p_expiry is null then raise exception 'Certificate expiry date is required'; end if;
  select cert_expiry into v_old from public.equipment where id = p_equipment_id for update;
  if not found then raise exception 'Equipment not found'; end if;
  update public.equipment set cert_expiry = p_expiry where id = p_equipment_id;
  perform app.log(p_equipment_id, null, 'cert_expiry_changed', jsonb_build_object('from', v_old, 'to', p_expiry), v_a.uid, v_a.uname, v_a.urole);
end
$fn$;

create function public.submit_inspection(p_equipment_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_eq public.equipment%rowtype; v_last public.inspections%rowtype;
  v_c public.checklist_items%rowtype; v_it jsonb; v_files text[]; v_file text;
  v_out jsonb := '[]'::jsonb; v_version int; v_id uuid;
begin
  select * into v_a from app.actor();
  if v_a.urole is distinct from 'contractor' then raise exception 'Only contractors can submit inspections'; end if;
  select * into v_eq from public.equipment where id = p_equipment_id and company = v_a.ucompany for update;
  if not found then raise exception 'Equipment not found'; end if;
  select * into v_last from public.inspections where equipment_id = p_equipment_id order by version desc limit 1;
  if found and v_last.status in ('awaiting_hse','awaiting_ops') then
    raise exception 'A submission for this equipment is already under review';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Invalid items'; end if;

  for v_c in select * from public.checklist_items where equipment_type = v_eq.type and active order by sort loop
    v_it := null;
    select x into v_it from jsonb_array_elements(p_items) as x where x->>'key' = v_c.key limit 1;
    select coalesce(array_agg(fe.val), '{}'::text[]) into v_files
      from jsonb_array_elements_text(case when jsonb_typeof(v_it->'files') = 'array' then v_it->'files' else '[]'::jsonb end) as fe(val);
    if coalesce(array_length(v_files, 1), 0) = 0 then
      if v_c.required then raise exception 'Missing required item: %', v_c.label_en; end if;
      continue;
    end if;
    if array_length(v_files, 1) > 8 then raise exception 'Too many files for: %', v_c.label_en; end if;
    foreach v_file in array v_files loop
      if v_file not like (p_equipment_id::text || '/%') or position('..' in v_file) > 0 then
        raise exception 'Invalid file reference';
      end if;
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'inspection-photos' and o.name = v_file
          and (o.metadata->>'mimetype') like (case when v_c.kind = 'video' then 'video/%' else 'image/%' end)
      ) then
        raise exception 'File missing or wrong type for: %', v_c.label_en;
      end if;
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_c.key, 'kind', v_c.kind,
      'label_en', v_c.label_en, 'label_zh', v_c.label_zh,
      'files', to_jsonb(v_files),
      'note', left(btrim(coalesce(v_it->>'note', '')), 500),
      'reading', nullif(left(btrim(coalesce(v_it->>'reading', '')), 20), ''),
      'reading_label_en', v_c.reading_label_en, 'reading_label_zh', v_c.reading_label_zh, 'reading_unit', v_c.reading_unit
    ));
  end loop;
  if jsonb_array_length(v_out) = 0 then raise exception 'Nothing to submit'; end if;

  select coalesce(max(version), 0) + 1 into v_version from public.inspections where equipment_id = p_equipment_id;
  if v_last.status = 'info_requested' then
    update public.inspections set status = 'superseded' where id = v_last.id;
  end if;
  insert into public.inspections (equipment_id, version, status, items, inspector_id, inspector_name)
  values (p_equipment_id, v_version, 'awaiting_hse', v_out, v_a.uid, coalesce(nullif(v_a.uname, ''), 'Contractor'))
  returning id into v_id;
  perform app.log(p_equipment_id, v_id, 'inspection_submitted', jsonb_build_object('version', v_version), v_a.uid, v_a.uname, v_a.urole);
  return v_id;
end
$fn$;

create function public.hse_review(p_inspection_id uuid, p_verdict text, p_comment text, p_ratings jsonb, p_contractor_message text default null)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_ins public.inspections%rowtype; v_item jsonb; v_key text; v_sev text;
  v_clean jsonb := '{}'::jsonb; v_critical boolean := false;
  v_msg text := nullif(btrim(coalesce(p_contractor_message, '')), '');
begin
  select * into v_a from app.actor();
  if v_a.urole is distinct from 'hse' then raise exception 'Only HSE can submit an HSE review'; end if;
  select * into v_ins from public.inspections where id = p_inspection_id for update;
  if not found then raise exception 'Inspection not found'; end if;
  if v_ins.status <> 'awaiting_hse' then raise exception 'This inspection is not waiting for HSE review'; end if;
  if p_verdict is null or p_verdict not in ('accept','conditions','reject','more_info') then raise exception 'Invalid verdict'; end if;
  if nullif(btrim(coalesce(p_comment, '')), '') is null then raise exception 'A comment is required'; end if;
  if p_verdict = 'more_info' and v_msg is null then raise exception 'Tell the contractor what is needed'; end if;

  for v_item in select x from jsonb_array_elements(v_ins.items) as x loop
    v_key := v_item->>'key';
    v_sev := case when jsonb_typeof(p_ratings) = 'object' then p_ratings->v_key->>'sev' end;
    if v_sev is null then
      if p_verdict <> 'more_info' then raise exception 'Rate every checklist item'; end if;
      continue;
    end if;
    if v_sev not in ('ok','minor','major','critical') then raise exception 'Invalid severity'; end if;
    if v_sev = 'critical' then v_critical := true; end if;
    v_clean := v_clean || jsonb_build_object(v_key, jsonb_build_object('sev', v_sev, 'note', left(btrim(coalesce(p_ratings->v_key->>'note', '')), 500)));
  end loop;
  if v_critical and p_verdict in ('accept','conditions') then
    raise exception 'A critical finding means this equipment cannot be accepted';
  end if;

  insert into public.reviews (inspection_id, dept, reviewer_id, reviewer_name, verdict, comment, item_ratings)
  values (p_inspection_id, 'HSE', v_a.uid, coalesce(nullif(v_a.uname, ''), 'HSE'), p_verdict, btrim(p_comment), v_clean);
  update public.inspections
     set status = case when p_verdict = 'more_info' then 'info_requested' else 'awaiting_ops' end,
         contractor_message = case when p_verdict = 'more_info' then v_msg else contractor_message end
   where id = p_inspection_id;
  perform app.log(v_ins.equipment_id, p_inspection_id, 'hse_review', jsonb_build_object('verdict', p_verdict), v_a.uid, v_a.uname, v_a.urole);
end
$fn$;

create function public.ops_review(p_inspection_id uuid, p_verdict text, p_comment text, p_contractor_message text default null, p_conditions jsonb default null)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_ins public.inspections%rowtype; v_hse public.reviews%rowtype; v_eq public.equipment%rowtype;
  v_msg text := nullif(btrim(coalesce(p_contractor_message, '')), '');
  v_cond jsonb; v_text text; v_due date; v_dec text;
begin
  select * into v_a from app.actor();
  if v_a.urole is distinct from 'operations' then raise exception 'Only Operations can record this review'; end if;
  select * into v_ins from public.inspections where id = p_inspection_id for update;
  if not found then raise exception 'Inspection not found'; end if;
  if v_ins.status <> 'awaiting_ops' then raise exception 'This inspection is not waiting for Operations'; end if;
  if p_verdict is null or p_verdict not in ('accept','conditions','reject','more_info') then raise exception 'Invalid verdict'; end if;
  if nullif(btrim(coalesce(p_comment, '')), '') is null then raise exception 'A comment is required'; end if;
  select * into v_hse from public.reviews where inspection_id = p_inspection_id and dept = 'HSE';
  if not found then raise exception 'The HSE review is missing'; end if;
  if v_hse.verdict = 'reject' and p_verdict <> 'reject' then
    raise exception 'HSE rejected this equipment. Only a rejection can be recorded until a senior sign-off is set up';
  end if;
  if v_hse.verdict = 'conditions' and p_verdict = 'accept' then
    raise exception 'HSE set conditions. Accept with conditions, or reject';
  end if;
  if p_verdict in ('conditions','reject','more_info') and v_msg is null then
    raise exception 'Write the message for the contractor';
  end if;
  if p_verdict in ('accept','conditions') then
    select * into v_eq from public.equipment where id = v_ins.equipment_id;
    if v_eq.cert_expiry is null or v_eq.cert_expiry < app.today() then
      raise exception 'The certificate is expired or missing. Update it before accepting';
    end if;
  end if;
  if p_verdict = 'conditions' then
    if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' or jsonb_array_length(p_conditions) = 0 then
      raise exception 'Add at least one condition';
    end if;
    for v_cond in select x from jsonb_array_elements(p_conditions) as x loop
      v_text := nullif(btrim(coalesce(v_cond->>'text', '')), '');
      begin v_due := (v_cond->>'due')::date; exception when others then v_due := null; end;
      if v_text is null or v_due is null then raise exception 'Each condition needs a description and a due date'; end if;
      if v_due < app.today() then raise exception 'A due date cannot be in the past'; end if;
    end loop;
  end if;

  if p_verdict = 'more_info' then
    update public.inspections set status = 'info_requested', contractor_message = v_msg where id = p_inspection_id;
  else
    v_dec := case p_verdict when 'accept' then 'cleared' when 'conditions' then 'conditional' else 'out_of_service' end;
    update public.inspections
       set status = 'decided', decision = v_dec, contractor_message = v_msg,
           decided_by = v_a.uid, decided_by_name = coalesce(nullif(v_a.uname, ''), 'Operations'), decided_at = now()
     where id = p_inspection_id;
    if p_verdict = 'conditions' then
      for v_cond in select x from jsonb_array_elements(p_conditions) as x loop
        insert into public.inspection_conditions (inspection_id, equipment_id, text, due_date)
        values (p_inspection_id, v_ins.equipment_id, left(btrim(v_cond->>'text'), 500), (v_cond->>'due')::date);
      end loop;
    end if;
  end if;
  insert into public.reviews (inspection_id, dept, reviewer_id, reviewer_name, verdict, comment)
  values (p_inspection_id, 'Operations', v_a.uid, coalesce(nullif(v_a.uname, ''), 'Operations'), p_verdict, btrim(p_comment));
  perform app.log(v_ins.equipment_id, p_inspection_id, 'ops_review',
    jsonb_build_object('verdict', p_verdict, 'decision', v_dec), v_a.uid, v_a.uname, v_a.urole);
end
$fn$;

create function public.submit_condition_proof(p_condition_id uuid, p_files text[], p_note text default null)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare v_a record; v_cond public.inspection_conditions%rowtype; v_eq public.equipment%rowtype; v_file text;
begin
  select * into v_a from app.actor();
  if v_a.urole is distinct from 'contractor' then raise exception 'Only the contractor can send proof'; end if;
  select * into v_cond from public.inspection_conditions where id = p_condition_id for update;
  if not found then raise exception 'Condition not found'; end if;
  select * into v_eq from public.equipment where id = v_cond.equipment_id and company = v_a.ucompany;
  if not found then raise exception 'Condition not found'; end if;
  if v_cond.status <> 'open' then raise exception 'This condition is not waiting for proof'; end if;
  if p_files is null or coalesce(array_length(p_files, 1), 0) = 0 then raise exception 'Add at least one photo or video'; end if;
  if array_length(p_files, 1) > 8 then raise exception 'Too many files'; end if;
  foreach v_file in array p_files loop
    if v_file not like (v_cond.equipment_id::text || '/%') or position('..' in v_file) > 0 then
      raise exception 'Invalid file reference';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'inspection-photos' and o.name = v_file
        and ((o.metadata->>'mimetype') like 'image/%' or (o.metadata->>'mimetype') like 'video/%')
    ) then
      raise exception 'File not found';
    end if;
  end loop;
  update public.inspection_conditions
     set status = 'proof_submitted', proof_files = to_jsonb(p_files), proof_note = left(btrim(coalesce(p_note, '')), 500),
         proof_by_name = coalesce(nullif(v_a.uname, ''), 'Contractor'), proof_at = now(), review_note = null
   where id = p_condition_id;
  perform app.log(v_cond.equipment_id, v_cond.inspection_id, 'condition_proof_submitted', jsonb_build_object('condition', p_condition_id), v_a.uid, v_a.uname, v_a.urole);
end
$fn$;

create function public.review_condition(p_condition_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare v_a record; v_cond public.inspection_conditions%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_a from app.actor();
  if v_a.urole is distinct from 'hse' then raise exception 'Only HSE can verify a condition'; end if;
  select * into v_cond from public.inspection_conditions where id = p_condition_id for update;
  if not found then raise exception 'Condition not found'; end if;
  if v_cond.status <> 'proof_submitted' then raise exception 'No proof is waiting for this condition'; end if;
  if p_approve is null then raise exception 'Choose approve or send back'; end if;
  if not p_approve and v_note is null then raise exception 'Tell the contractor what is still wrong'; end if;
  if p_approve then
    update public.inspection_conditions
       set status = 'closed', review_note = v_note, closed_by_name = coalesce(nullif(v_a.uname, ''), 'HSE'), closed_at = now()
     where id = p_condition_id;
  else
    update public.inspection_conditions set status = 'open', review_note = v_note where id = p_condition_id;
  end if;
  perform app.log(v_cond.equipment_id, v_cond.inspection_id, case when p_approve then 'condition_closed' else 'condition_sent_back' end,
    jsonb_build_object('condition', p_condition_id), v_a.uid, v_a.uname, v_a.urole);
end
$fn$;

create function public.admin_set_profile(p_user_id uuid, p_role text, p_company text, p_name text default null)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare v_a record; v_company text := nullif(btrim(coalesce(p_company, '')), '');
begin
  select * into v_a from app.actor();
  if v_a.urole is distinct from 'admin' then raise exception 'Only an admin can manage users'; end if;
  if p_role is not null and p_role not in ('contractor','hse','operations','admin') then raise exception 'Invalid role'; end if;
  if p_user_id = v_a.uid and p_role is distinct from 'admin' then raise exception 'You cannot remove your own admin role'; end if;
  if p_role = 'contractor' and v_company is null then raise exception 'Contractors need a company'; end if;
  update public.profiles
     set role = p_role,
         company = case when p_role = 'contractor' then v_company else null end,
         full_name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), full_name)
   where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  perform app.log(null, null, 'profile_changed', jsonb_build_object('user', p_user_id, 'role', p_role, 'company', v_company), v_a.uid, v_a.uname, v_a.urole);
end
$fn$;

create function public.vendor_scorecard()
returns table (company text, machines bigint, submissions bigint, decided bigint, accepted bigint,
               conditional bigint, rejected bigint, rejection_rate numeric, resubmissions bigint,
               avg_days_to_decision numeric, overdue_conditions bigint)
language plpgsql stable security definer set search_path = '' as
$fn$
begin
  if not app.is_staff() then raise exception 'Not allowed'; end if;
  return query
  select e.company,
         count(distinct e.id),
         count(i.id),
         count(i.id) filter (where i.status = 'decided'),
         count(i.id) filter (where i.decision = 'cleared'),
         count(i.id) filter (where i.decision = 'conditional'),
         count(i.id) filter (where i.decision = 'out_of_service'),
         round(100.0 * count(i.id) filter (where i.decision = 'out_of_service') / nullif(count(i.id) filter (where i.status = 'decided'), 0), 1),
         count(i.id) filter (where i.version > 1),
         round((avg(extract(epoch from (i.decided_at - i.created_at)) / 86400.0) filter (where i.status = 'decided'))::numeric, 1),
         (select count(*) from public.inspection_conditions c join public.equipment e2 on e2.id = c.equipment_id
           where e2.company = e.company and c.status = 'open' and c.due_date < app.today())
  from public.equipment e
  left join public.inspections i on i.equipment_id = e.id
  where e.company is not null
  group by e.company
  order by e.company;
end
$fn$;

-- ============================================================ function permissions
revoke all on function app.log(uuid, uuid, text, jsonb, uuid, text, text) from public, anon, authenticated;
revoke all on function app.actor() from public, anon, authenticated;
revoke all on function app.handle_new_user() from public, anon, authenticated;
revoke all on function app.user_role(), app.company(), app.is_staff(), app.today() from public, anon;
grant execute on function app.user_role(), app.company(), app.is_staff(), app.today() to authenticated;

do $perm$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('register_equipment','set_cert_expiry','submit_inspection','hse_review',
      'ops_review','submit_condition_proof','review_condition','admin_set_profile','vendor_scorecard')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end
$perm$;

-- ============================================================ private photo/video storage
update storage.buckets
   set public = false,
       file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm']
 where id = 'inspection-photos';

drop policy "photos read" on storage.objects;
drop policy "photos upload" on storage.objects;

create policy "evidence read" on storage.objects for select to authenticated using (
  bucket_id = 'inspection-photos'
  and ((select app.is_staff())
       or exists (select 1 from public.equipment e where e.id::text = (storage.foldername(name))[1]))
);
create policy "evidence upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'inspection-photos'
  and (select app.user_role()) = 'contractor'
  and exists (select 1 from public.equipment e where e.id::text = (storage.foldername(name))[1])
);
