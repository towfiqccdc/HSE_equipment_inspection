const sb = supabase.createClient(CFG.url, CFG.key);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = d => d ? new Date(d).toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'}) : '—';
// Photo criteria the contractor must cover (information only, no pass/fail). Edit freely.
const CL = {
  forklift: ['Overall — front','Overall — rear','Left side','Right side','Forks & heel','Mast & lift chains','Tyres','Overhead guard & backrest','Hydraulic hoses / leaks','Data plate / capacity plate','Certificates & inspection tag'],
  crane: ['Overall — front','Overall — rear','Left side','Right side','Boom / structure','Wire rope & hook','Load chart & SWL plate','Outriggers / tracks / tyres','Cabin & controls','Limit switches & safety devices','Certificates & inspection tag']
};
const DEC = {cleared:'Accepted', conditional:'Accepted with conditions', out_of_service:'Rejected'};
const REC = {accept:'Recommend accept', conditions:'Recommend accept with conditions', reject:'Recommend reject', more_info:'Need more photos / info'};
const LABEL = {...DEC, awaiting_hse:'Awaiting HSE', awaiting_ops:'Awaiting Operations', none:'No photos yet'};
const badge = k => `<span class="badge b-${k}">${LABEL[k] || k}</span>`;
const ROLES = ['Contractor', 'HSE', 'Operations'];
let me = JSON.parse(localStorage.getItem('me') || 'null');

function toast(m, err) { const t = document.createElement('div'); t.className = 'toast' + (err ? ' error' : ''); t.textContent = m; $('#toast').append(t); setTimeout(() => t.remove(), 3500); }
function showMe() { $('#me').innerHTML = me ? `<b>${esc(me.name)}</b><br><span class="muted">${esc(me.dept)} · change</span>` : 'Set your name &amp; role'; }
function askMe() {
  const name = prompt('Your name:', me?.name || ''); if (!name) return;
  const dept = prompt('Your role — type Contractor, HSE or Operations:', me?.dept || 'Contractor');
  if (!ROLES.includes(dept)) return toast('Role must be Contractor, HSE or Operations', 1);
  me = {name, dept}; localStorage.setItem('me', JSON.stringify(me)); showMe();
}
function needMe() { if (!me) askMe(); return !!me; }
const q = async p => { const {data, error} = await p; if (error) throw error; return data; };
const stage = (ins, revs) => !ins ? 'none' : ins.decision || (revs.some(r => r.inspection_id === ins.id && r.dept === 'HSE') ? 'awaiting_ops' : 'awaiting_hse');

async function go(view, arg) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#body').innerHTML = '<p class="muted">Loading…</p>';
  try { await views[view](arg); } catch (e) { $('#body').innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
}

const views = {
  async matrix() {
    $('#title').textContent = 'Equipment Status';
    const [eq, ins, rev] = await Promise.all([q(sb.from('equipment').select('*').order('tag')), q(sb.from('inspections').select('id,equipment_id,decision,created_at').order('created_at', {ascending: false})), q(sb.from('reviews').select('inspection_id,dept'))]);
    const last = {}; ins.forEach(i => { if (!last[i.equipment_id]) last[i.equipment_id] = i; });
    $('#body').innerHTML = eq.length ? `<div class="tbl-wrap"><table><thead><tr><th>Tag</th><th>Type</th><th>Contractor</th><th>Rig</th><th>Status</th><th>Submitted</th></tr></thead><tbody>` +
      eq.map(e => { const l = last[e.id];
        return `<tr><td><b>${esc(e.tag)}</b><div class="muted small">${esc(e.serial)}</div></td><td>${e.type}</td><td>${esc(e.contractor)}</td><td>${esc(e.rig)}</td><td>${badge(stage(l, rev))}</td><td>${l ? `<button class="link" onclick="go('detail','${l.id}')">${fmt(l.created_at)}</button>` : '—'}</td></tr>`; }).join('') + '</tbody></table></div>'
      : '<p class="muted">No equipment yet. The contractor adds it in Equipment Register.</p>';
  },

  async register() {
    $('#title').textContent = 'Equipment Register';
    const eq = await q(sb.from('equipment').select('*').order('tag'));
    $('#body').innerHTML = `<div class="card"><h3 class="card-title">Add crane / forklift</h3><div class="row">
      <div class="field"><label>Tag / plate no.</label><input id="e-tag" placeholder="e.g. FL-012"></div>
      <div class="field"><label>Type</label><select id="e-type"><option>forklift</option><option>crane</option></select></div>
      <div class="field"><label>Contractor company</label><input id="e-con"></div></div><div class="row">
      <div class="field"><label>Serial no.</label><input id="e-ser"></div>
      <div class="field"><label>Rig</label><input id="e-rig"></div>
      <div class="field"><label>Certificate expiry</label><input id="e-exp" type="date"></div></div>
      <button class="btn btn-primary" id="e-add">Add equipment</button></div>
      <div class="tbl-wrap"><table><thead><tr><th>Tag</th><th>Type</th><th>Contractor</th><th>Serial</th><th>Rig</th><th>Cert expiry</th></tr></thead><tbody>${eq.map(e => `<tr><td>${esc(e.tag)}</td><td>${e.type}</td><td>${esc(e.contractor)}</td><td>${esc(e.serial)}</td><td>${esc(e.rig)}</td><td>${fmt(e.cert_expiry)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#e-add').onclick = async () => {
      const tag = $('#e-tag').value.trim(); if (!tag) return toast('Tag required', 1);
      try { await q(sb.from('equipment').insert({tag, type: $('#e-type').value, contractor: $('#e-con').value.trim(), serial: $('#e-ser').value.trim(), rig: $('#e-rig').value.trim(), cert_expiry: $('#e-exp').value || null})); toast('Equipment added — now send its photos'); go('register'); } catch (e) { toast(e.message, 1); }
    };
  },

  async new() {
    $('#title').textContent = 'Send Photos';
    const eq = await q(sb.from('equipment').select('*').order('tag'));
    if (!eq.length) { $('#body').innerHTML = '<p class="muted">Add the equipment first in Equipment Register.</p>'; return; }
    $('#body').innerHTML = `<p class="muted">Take clear photos for each point below. You only send information — HSE and Operations will assess it.</p><div class="field" style="max-width:360px"><label>Equipment</label><select id="n-eq">${eq.map(e => `<option value="${e.id}" data-t="${e.type}">${esc(e.tag)} (${e.type}${e.contractor ? ', ' + esc(e.contractor) : ''})</option>`).join('')}</select></div><div id="n-list"></div>`;
    const draw = () => {
      const t = $('#n-eq').selectedOptions[0].dataset.t;
      $('#n-list').innerHTML = `<div class="card">` + CL[t].map((l, i) => `<div class="item"><div class="item-head"><span>${esc(l)}</span></div>
        <input class="ph" type="file" accept="image/*" capture="environment" multiple><input class="cm" placeholder="Note (optional)" style="margin-top:6px"></div>`).join('') +
        `</div><button class="btn btn-primary" id="n-go">Send to HSE</button>`;
      $('#n-go').onclick = submit;
    };
    $('#n-eq').onchange = draw; draw();
    async function shrink(f) { const b = await createImageBitmap(f), k = Math.min(1, 1280 / Math.max(b.width, b.height)); const c = document.createElement('canvas'); c.width = b.width * k; c.height = b.height * k; c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); return new Promise(res => c.toBlob(res, 'image/jpeg', .7)); }
    async function submit() {
      if (!needMe()) return;
      const sel = $('#n-eq').selectedOptions[0], list = CL[sel.dataset.t], btn = $('#n-go'), items = [];
      const nodes = [...document.querySelectorAll('#n-list .item')];
      const miss = nodes.findIndex(n => !n.querySelector('.ph').files.length);
      if (miss >= 0) return toast(`Add at least one photo for "${list[miss]}"`, 1);
      btn.disabled = true; btn.textContent = 'Uploading photos…';
      try {
        for (const [i, n] of nodes.entries()) {
          const photos = [];
          for (const f of n.querySelector('.ph').files) { const path = `${sel.value}/${Date.now()}-${i}-${photos.length}.jpg`; const {error} = await sb.storage.from('inspection-photos').upload(path, await shrink(f), {contentType: 'image/jpeg'}); if (error) throw error; photos.push(sb.storage.from('inspection-photos').getPublicUrl(path).data.publicUrl); }
          items.push({label: list[i], note: n.querySelector('.cm').value.trim(), photos});
        }
        const row = await q(sb.from('inspections').insert({equipment_id: sel.value, inspector: me.name, items}).select().single());
        toast('Sent to HSE for review'); go('detail', row.id);
      } catch (e) { toast(e.message, 1); btn.disabled = false; btn.textContent = 'Send to HSE'; }
    }
  },

  async queue() {
    $('#title').textContent = 'Review Queue';
    const [ins, eq, rev] = await Promise.all([q(sb.from('inspections').select('*').is('decision', null).order('created_at')), q(sb.from('equipment').select('id,tag,contractor')), q(sb.from('reviews').select('inspection_id,dept'))]);
    const E = Object.fromEntries(eq.map(e => [e.id, e]));
    $('#body').innerHTML = ins.length ? `<div class="tbl-wrap"><table><thead><tr><th>Equipment</th><th>Contractor</th><th>Sent</th><th>Waiting for</th></tr></thead><tbody>` + ins.map(i =>
      `<tr><td><button class="link" onclick="go('detail','${i.id}')">${esc(E[i.equipment_id]?.tag)}</button></td><td>${esc(E[i.equipment_id]?.contractor)}</td><td>${fmt(i.created_at)}</td><td>${badge(stage(i, rev))}</td></tr>`).join('') + '</tbody></table></div>' : '<p class="muted">Nothing waiting for review.</p>';
  },

  async detail(id) {
    const ins = await q(sb.from('inspections').select('*, equipment(*)').eq('id', id).single());
    const revs = await q(sb.from('reviews').select('*').eq('inspection_id', id).order('created_at'));
    const st = stage(ins, revs.map(r => ({...r, inspection_id: id}))), role = me?.dept, e = ins.equipment;
    $('#title').textContent = `${e.tag} — ${e.type}`;
    const form = !ins.decision && role === 'HSE' ? `<div class="field"><label>HSE comment (${esc(me.name)})</label><select id="v-rec">${Object.entries(REC).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div class="field"><textarea id="v-cm" rows="3" placeholder="What did you see? Concerns, damage, what must be fixed…"></textarea></div><button class="btn btn-primary" id="v-go">Submit HSE comment</button>`
      : !ins.decision && role === 'Operations' && st === 'awaiting_ops' ? `<div class="field"><label>Operations decision (${esc(me.name)})</label><select id="d-dec">${Object.entries(DEC).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div class="field"><textarea id="d-note" rows="3" placeholder="Operations comment / conditions / reason"></textarea></div><button class="btn btn-primary" id="d-go">Record decision</button>`
      : !ins.decision ? `<p class="muted">${role === 'Operations' ? 'Waiting for HSE to comment first.' : role === 'HSE' ? '' : 'Set your role (bottom left) as HSE or Operations to comment.'}</p>` : '';
    $('#body').innerHTML = `<p>${badge(st)} <span class="muted small">Sent by ${esc(ins.inspector)} · ${fmt(ins.created_at)} · ${esc(e.contractor)} · serial ${esc(e.serial) || '—'} · ${esc(e.rig)}</span></p>
      ${ins.decision ? `<div class="card"><h3 class="card-title">Final decision</h3>${badge(ins.decision)}<p>${esc(ins.decision_note)}</p><p class="muted small">${esc(ins.decided_by)} · ${fmt(ins.decided_at)}</p></div>` : ''}
      <div class="card"><h3 class="card-title">Contractor photos</h3>${ins.items.map(i => `<div class="item"><div class="item-head"><span>${esc(i.label)}</span></div>${i.note || i.comment ? `<div class="muted">${esc(i.note || i.comment)}</div>` : ''}<div class="thumbs">${i.photos.map(u => `<a href="${u}" target="_blank"><img src="${u}" loading="lazy"></a>`).join('')}</div></div>`).join('')}</div>
      <div class="card"><h3 class="card-title">Comments</h3>${revs.map(r => `<div class="rev ${r.dept}"><b>${esc(r.dept)}</b> · ${esc(r.reviewer)} · ${esc(REC[r.verdict] || r.verdict)} <span class="muted small">${fmt(r.created_at)}</span><div>${esc(r.comment)}</div></div>`).join('') || '<p class="muted">No comments yet.</p>'}${form}</div>`;
    $('#v-go') && ($('#v-go').onclick = async () => {
      if (!$('#v-cm').value.trim()) return toast('Please write a comment', 1);
      try { await q(sb.from('reviews').insert({inspection_id: id, dept: 'HSE', reviewer: me.name, verdict: $('#v-rec').value, comment: $('#v-cm').value.trim()})); toast('HSE comment saved'); go('detail', id); } catch (er) { toast(er.message, 1); }
    });
    $('#d-go') && ($('#d-go').onclick = async () => {
      const dec = $('#d-dec').value, note = $('#d-note').value.trim(); if (!note) return toast('Please write a comment', 1);
      const map = {cleared: 'accept', conditional: 'conditions', out_of_service: 'reject'};
      try {
        await q(sb.from('reviews').insert({inspection_id: id, dept: 'Operations', reviewer: me.name, verdict: map[dec], comment: note}));
        await q(sb.from('inspections').update({decision: dec, decision_note: note, decided_by: `${me.name} (Operations)`, decided_at: new Date().toISOString()}).eq('id', id));
        toast('Decision recorded'); go('detail', id);
      } catch (er) { toast(er.message, 1); }
    });
  }
};

document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => go(b.dataset.view));
$('#me').onclick = askMe; showMe();
sb.from('equipment').select('id', {head: true, count: 'exact'}).then(({error}) => { const c = $('#conn'); c.textContent = error ? 'Not connected' : '● Connected'; c.className = 'conn ' + (error ? 'err' : 'ok'); });
go('matrix');
