-- Crane checklist (21 items) in walk-around order, sections, and "Others" observations.

alter table public.checklist_items add column if not exists section_en text, add column if not exists section_zh text;
alter table public.reviews add column if not exists extra_findings jsonb not null default '[]'::jsonb;

-- ---- crane: replace the list
delete from public.checklist_items where equipment_type = 'crane';
insert into public.checklist_items (equipment_type, key, sort, kind, required, section_en, section_zh, label_en, label_zh, hint_en, hint_zh) values
('crane','crane_whole',10,'photo',true,'Machine and papers','整机与文件','Crane whole view','吊车整体外观','Whole crane in one frame, plate or tag number visible.','整机入镜，需能看到编号牌。'),
('crane','crane_docs',20,'photo',true,'Machine and papers','整机与文件','Crane documents','吊车文件','Registration, inspection certificate and insurance. Dates must be readable.','登记证、检验证书及保险，日期必须清晰。'),
('crane','driver_docs',30,'photo',true,'Machine and papers','整机与文件','Driver documents','司机证件','Licence and operator certificate. Dates must be readable.','驾驶证及操作证，日期必须清晰。'),
('crane','load_chart',40,'photo',true,'Machine and papers','整机与文件','Load chart','载荷表','Chart as fitted in the cab. Must be readable.','驾驶室内载荷表，内容必须清晰可读。'),
('crane','tyres',50,'photo',true,'Ground level (walk around)','地面检查（绕机一圈）','Tyres','轮胎','All tyres, including wear, cuts and bulges.','所有轮胎，注意磨损、割伤和鼓包。'),
('crane','outrigger',60,'photo',true,'Ground level (walk around)','地面检查（绕机一圈）','Outrigger','支腿','One close-up of the outrigger beam, jack and pad.','支腿横梁、油缸及支腿垫板特写。'),
('crane','outriggers_all',70,'photo',true,'Ground level (walk around)','地面检查（绕机一圈）','Outriggers (all sides)','支腿（各侧）','All sides, extended and set on firm ground.','各侧支腿，伸出并支撑于坚实地面。'),
('crane','battery',80,'photo',true,'Ground level (walk around)','地面检查（绕机一圈）','Battery','蓄电池','Terminals, clamps, cover and any leaks.','接线柱、卡箍、护盖及有无泄漏。'),
('crane','hook_block',90,'photo',true,'Hook and rope','吊钩与钢丝绳','Hook block','吊钩滑轮组','Hook, block body and any cracks, wear or deformation.','吊钩及滑轮组本体，注意裂纹、磨损或变形。'),
('crane','hook_sheave',100,'photo',true,'Hook and rope','吊钩与钢丝绳','Hook block sheave','吊钩滑轮','Sheave groove wear and rope seating.','滑轮槽磨损及钢丝绳入槽情况。'),
('crane','latch_main',110,'photo',true,'Hook and rope','吊钩与钢丝绳','Safety latch (main hook)','安全舌片（主钩）','Latch must close fully and spring back.','舌片必须能完全闭合并回弹。'),
('crane','latch_aux',120,'photo',true,'Hook and rope','吊钩与钢丝绳','Safety latch (auxiliary hook)','安全舌片（副钩）','Latch must close fully and spring back.','舌片必须能完全闭合并回弹。'),
('crane','rope_drum',130,'photo',true,'Hook and rope','吊钩与钢丝绳','Wire rope drum','钢丝绳卷筒','Rope winding, broken wires, kinks and drum condition.','钢丝绳排绳、断丝、扭结及卷筒状况。'),
('crane','lmi',140,'photo',true,'Safety devices','安全装置','Load Moment Indicator (LMI)','力矩限制器（LMI）','Display on and working, no error shown.','显示屏开启且工作正常，无故障提示。'),
('crane','anti_two_block',150,'photo',true,'Safety devices','安全装置','Anti-two-block device','防过卷装置','Weight and switch at the boom head.','吊臂头部的重锤及开关。'),
('crane','alarm',160,'photo',true,'Safety devices','安全装置','Warning alarm / buzzer','警报器 / 蜂鸣器','Alarm unit fitted. Add a short video in Others if you can.','报警器已安装。如可，请在“其他”中补充短视频。'),
('crane','seat_belt',170,'photo',true,'Cab','驾驶室','Operator seat and seat belt','操作员座椅及安全带','Seat condition and belt buckled.','座椅状况及安全带扣紧情况。'),
('crane','mirrors',180,'photo',true,'Cab','驾驶室','Mirrors','后视镜','All mirrors, not cracked and correctly set.','所有后视镜，无破裂且角度正确。'),
('crane','windscreen',190,'photo',true,'Cab','驾驶室','Windscreen and wipers','挡风玻璃及雨刮器','Glass free of cracks, wipers fitted.','玻璃无裂纹，雨刮器已安装。'),
('crane','extinguisher',200,'photo',true,'Cab','驾驶室','Fire extinguisher','灭火器','Gauge in the green and the inspection date.','压力表在绿区及检验日期。'),
('crane','first_aid',210,'photo',true,'Cab','驾驶室','First-aid kit','急救箱','Open box showing the contents.','打开急救箱，显示内部物品。');

-- ---- forklift: same section idea, order unchanged in spirit
update public.checklist_items set section_en='Machine and papers', section_zh='整机与文件' where equipment_type='forklift' and key in ('overall_front','overall_rear','data_plate','certificates');
update public.checklist_items set section_en='Ground level (walk around)', section_zh='地面检查（绕机一圈）' where equipment_type='forklift' and key in ('left_side','right_side','forks','mast_chains','tyres','overhead_guard','hydraulics');
update public.checklist_items set section_en='Safety and function tests', section_zh='安全与功能测试' where equipment_type='forklift' and key in ('safety_devices','lift_test','brake_test');
update public.checklist_items c set sort = v.s from (values
 ('overall_front',10),('overall_rear',20),('data_plate',30),('certificates',40),
 ('left_side',50),('right_side',60),('forks',70),('mast_chains',80),('tyres',90),('overhead_guard',100),('hydraulics',110),
 ('safety_devices',120),('lift_test',130),('brake_test',140)) as v(k,s)
 where c.equipment_type='forklift' and c.key = v.k;

-- ---- submit: sections in the snapshot + optional "Others" observations (other_1 .. other_10)
create or replace function public.submit_inspection(p_equipment_id uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_eq public.equipment%rowtype; v_last public.inspections%rowtype;
  v_c public.checklist_items%rowtype; v_it jsonb; v_files text[]; v_file text;
  v_out jsonb := '[]'::jsonb; v_version int; v_id uuid; v_n int; v_note text; v_kind text; v_extra int := 0;
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
      'section_en', v_c.section_en, 'section_zh', v_c.section_zh,
      'label_en', v_c.label_en, 'label_zh', v_c.label_zh,
      'files', to_jsonb(v_files),
      'note', left(btrim(coalesce(v_it->>'note', '')), 500),
      'reading', nullif(left(btrim(coalesce(v_it->>'reading', '')), 20), ''),
      'reading_label_en', v_c.reading_label_en, 'reading_label_zh', v_c.reading_label_zh, 'reading_unit', v_c.reading_unit
    ));
  end loop;

  -- Others: extra observations, optional, up to 10. Each needs a description; photos or videos are optional.
  for v_it in select x from jsonb_array_elements(p_items) as x where x->>'key' ~ '^other_[0-9]{1,2}$' order by (substring(x->>'key' from 7))::int loop
    v_n := (substring(v_it->>'key' from 7))::int;
    select coalesce(array_agg(fe.val), '{}'::text[]) into v_files
      from jsonb_array_elements_text(case when jsonb_typeof(v_it->'files') = 'array' then v_it->'files' else '[]'::jsonb end) as fe(val);
    v_note := left(btrim(coalesce(v_it->>'note', '')), 500);
    if v_note = '' and coalesce(array_length(v_files, 1), 0) = 0 then continue; end if;
    if v_note = '' then raise exception 'Describe each observation in Others'; end if;
    v_extra := v_extra + 1;
    if v_extra > 10 then raise exception 'Too many observations in Others'; end if;
    if coalesce(array_length(v_files, 1), 0) > 8 then raise exception 'Too many files for an observation in Others'; end if;
    v_kind := 'photo';
    foreach v_file in array v_files loop
      if v_file not like (p_equipment_id::text || '/%') or position('..' in v_file) > 0 then
        raise exception 'Invalid file reference';
      end if;
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'inspection-photos' and o.name = v_file
          and ((o.metadata->>'mimetype') like 'image/%' or (o.metadata->>'mimetype') like 'video/%')
      ) then
        raise exception 'File missing or wrong type in Others';
      end if;
      if exists (select 1 from storage.objects o where o.bucket_id = 'inspection-photos' and o.name = v_file and (o.metadata->>'mimetype') like 'video/%') then v_kind := 'video'; end if;
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', 'other_' || v_n, 'kind', v_kind,
      'section_en', 'Others', 'section_zh', '其他',
      'label_en', 'Other observation ' || v_extra, 'label_zh', '其他情况 ' || v_extra,
      'files', to_jsonb(v_files), 'note', v_note, 'reading', null
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

-- ---- HSE review: HSE can add its own extra observations (severity + text)
drop function if exists public.hse_review(uuid, text, text, jsonb, text);
create function public.hse_review(p_inspection_id uuid, p_verdict text, p_comment text, p_ratings jsonb, p_contractor_message text default null, p_extra jsonb default null)
returns void language plpgsql security definer set search_path = '' as
$fn$
declare
  v_a record; v_ins public.inspections%rowtype; v_item jsonb; v_key text; v_sev text;
  v_clean jsonb := '{}'::jsonb; v_critical boolean := false; v_x jsonb; v_xs jsonb := '[]'::jsonb; v_xnote text;
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

  if p_extra is not null then
    if jsonb_typeof(p_extra) <> 'array' then raise exception 'Invalid extra observations'; end if;
    if jsonb_array_length(p_extra) > 10 then raise exception 'Too many extra observations'; end if;
    for v_x in select x from jsonb_array_elements(p_extra) as x loop
      v_xnote := left(btrim(coalesce(v_x->>'note', '')), 500);
      if v_xnote = '' then raise exception 'Describe each extra observation'; end if;
      v_sev := v_x->>'sev';
      if v_sev is null or v_sev not in ('minor','major','critical') then raise exception 'Invalid severity'; end if;
      if v_sev = 'critical' then v_critical := true; end if;
      v_xs := v_xs || jsonb_build_array(jsonb_build_object('sev', v_sev, 'note', v_xnote));
    end loop;
  end if;

  if v_critical and p_verdict in ('accept','conditions') then
    raise exception 'A critical finding means this equipment cannot be accepted';
  end if;

  insert into public.reviews (inspection_id, dept, reviewer_id, reviewer_name, verdict, comment, item_ratings, extra_findings)
  values (p_inspection_id, 'HSE', v_a.uid, coalesce(nullif(v_a.uname, ''), 'HSE'), p_verdict, btrim(p_comment), v_clean, v_xs);
  update public.inspections
     set status = case when p_verdict = 'more_info' then 'info_requested' else 'awaiting_ops' end,
         contractor_message = case when p_verdict = 'more_info' then v_msg else contractor_message end
   where id = p_inspection_id;
  perform app.log(v_ins.equipment_id, p_inspection_id, 'hse_review', jsonb_build_object('verdict', p_verdict), v_a.uid, v_a.uname, v_a.urole);
end
$fn$;

revoke all on function public.hse_review(uuid, text, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.hse_review(uuid, text, text, jsonb, text, jsonb) to authenticated;
revoke all on function public.submit_inspection(uuid, jsonb) from public, anon;
grant execute on function public.submit_inspection(uuid, jsonb) to authenticated;
