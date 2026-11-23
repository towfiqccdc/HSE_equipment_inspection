'use strict';
/* CCDC HSE — equipment joint inspection. Static app: Supabase handles login, data rules and photo storage. */
const sb = supabase.createClient(CFG.url, CFG.key);
const BUCKET = 'inspection-photos';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid8 = () => Math.random().toString(36).slice(2, 10);

const S = { session: null, uid: null, profile: null, tok: 0, rows: null, filter: 'all', search: '', checklist: null, draft: null, condFilter: null, reportInternal: false, badge: 0 };
let lang = 'en';
try { lang = localStorage.getItem('lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'); } catch (e) { /* storage blocked */ }

const T = (k, v = {}) => {
  let s = (I18N[lang] && I18N[lang][k]) ?? I18N.en[k] ?? k;
  for (const [a, b] of Object.entries(v)) s = s.split('{' + a + '}').join(String(b));
  return s;
};
const lbl = (o, base) => (lang === 'zh' && o[base + '_zh']) || o[base + '_en'] || '';
const locale = () => (lang === 'zh' ? 'zh-CN' : 'en-GB');
const fmtDate = d => {
  if (!d) return '—';
  const x = new Date(String(d).length === 10 ? d + 'T00:00:00' : d);
  return x.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtDT = d => new Date(d).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
const role = () => S.profile && S.profile.role;
const isStaff = () => ['hse', 'operations', 'admin'].includes(role());
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysSince = d => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), err ? 6000 : 3500);
}
const fail = e => toast((e && e.message) || T('common.error'), 1);

/* ---------- small UI pieces ---------- */
const stagePill = k => `<span class="stag s-${esc(k)}">${esc(T('stage.' + k))}</span>`;
function certChip(days, date) {
  if (days == null) return `<span class="muted">${esc(T('cert.none'))}</span>`;
  const c = days < 0 ? 'bad' : days <= 30 ? 'warn' : 'ok';
  const note = days < 0 ? T('cert.expired', { n: -days }) : days <= 30 ? T('cert.days', { n: days }) : '';
  return `<span class="cert ${c}">${fmtDate(date)}${note ? ` <b>${esc(note)}</b>` : ''}</span>`;
}
const isVideo = p => /\.(mp4|mov|webm)$/i.test(p);
function media(paths, urls) {
  return (paths || []).map(p => {
    const u = urls[p];
    if (!u) return '<span class="thumb missing">?</span>';
    return isVideo(p)
      ? `<video class="thumb vid" src="${esc(u)}" controls preload="metadata" playsinline></video>`
      : `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(u)}" loading="lazy" alt=""></a>`;
  }).join('');
}
async function signed(paths) {
  paths = [...new Set((paths || []).filter(Boolean))];
  if (!paths.length) return {};
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const m = {};
  (data || []).forEach(d => { if (d.signedUrl) m[d.path] = d.signedUrl; });
  return m;
}
function paint(tok, title, html) {
  if (tok !== S.tok) return false;
  $('#title').textContent = title;
  $('#body').innerHTML = html;
  return true;
}
const stageOf = (ins, conds) => {
  if (ins.status !== 'decided') return ins.status;
  if (ins.decision === 'conditional' && conds.length && conds.every(c => c.status === 'closed')) return 'cleared';
  return ins.decision;
};

/* ---------- auth screens ---------- */
function brandMark() {
  return `<div class="brandmark"><span class="hole"></span><span class="bm-name">${esc(T('app.name'))}</span></div>`;
}
function langSwitch() {
  return `<div class="langs"><button data-lang="en" class="${lang === 'en' ? 'on' : ''}">EN</button><button data-lang="zh" class="${lang === 'zh' ? 'on' : ''}">中文</button></div>`;
}
function bindLang() {
  $$('[data-lang]').forEach(b => b.onclick = () => {
    lang = b.dataset.lang;
    try { localStorage.setItem('lang', lang); } catch (e) { /* ignore */ }
    document.documentElement.lang = lang;
    start();
  });
}
function renderAuth(mode = 'signin', note = '') {
  document.documentElement.lang = lang;
  $('#root').innerHTML = `<div class="authwrap">
    <section class="authart" aria-hidden="true">
      <div class="hangs"><span class="stag s-cleared">${esc(T('stage.cleared'))}</span><span class="stag s-conditional">${esc(T('stage.conditional'))}</span><span class="stag s-out_of_service">${esc(T('stage.out_of_service'))}</span></div>
      <h2>${esc(T('app.tagline'))}</h2>
    </section>
    <section class="authcard">
      <div class="authtop">${brandMark()}${langSwitch()}</div>
      <div class="tabs"><button data-mode="signin" class="${mode === 'signin' ? 'on' : ''}">${esc(T('auth.signin'))}</button><button data-mode="signup" class="${mode === 'signup' ? 'on' : ''}">${esc(T('auth.signup'))}</button></div>
      ${note ? `<div class="alert ok">${esc(note)}</div>` : ''}
      <form id="authform" class="form" novalidate>
        ${mode === 'signup' ? `<label class="field"><span>${esc(T('auth.name'))}</span><input id="a-name" autocomplete="name" required></label>` : ''}
        <label class="field"><span>${esc(T('auth.email'))}</span><input id="a-email" type="email" autocomplete="email" required></label>
        <label class="field"><span>${esc(T('auth.password'))}</span><input id="a-pass" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required></label>
        ${mode === 'signup' ? `<label class="field"><span>${esc(T('auth.role'))}</span><select id="a-role"><option value="contractor">${esc(T('role.contractor'))}</option><option value="hse">${esc(T('role.hse'))}</option><option value="operations">${esc(T('role.operations'))}</option></select></label>
        <label class="field" id="a-cowrap"><span>${esc(T('auth.company'))}</span><input id="a-company" autocomplete="organization"></label>` : ''}
        <div id="a-err" class="alert bad" hidden></div>
        <button class="btn primary wide" id="a-go" type="submit">${esc(T(mode === 'signup' ? 'auth.signup' : 'auth.signin'))}</button>
        ${mode === 'signin' ? `<button class="link" type="button" id="a-forgot">${esc(T('auth.forgot'))}</button>` : ''}
      </form>
    </section></div>`;
  bindLang();
  $$('[data-mode]').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  const showErr = m => { const e = $('#a-err'); e.textContent = m; e.hidden = !m; };
  if (mode === 'signup') {
    const sync = () => { $('#a-cowrap').hidden = $('#a-role').value !== 'contractor'; };
    $('#a-role').onchange = sync; sync();
  }
  $('#authform').onsubmit = async ev => {
    ev.preventDefault(); showErr('');
    const email = $('#a-email').value.trim(), password = $('#a-pass').value;
    const btn = $('#a-go'); btn.disabled = true;
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const full_name = $('#a-name').value.trim(), requested_role = $('#a-role').value, company = $('#a-company').value.trim();
        if (password.length < 8) throw new Error(T('auth.min_password'));
        if (requested_role === 'contractor' && !company) throw new Error(T('auth.need_company'));
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, requested_role, company }, emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) renderAuth('signin', T('auth.check_email'));
      }
    } catch (e) { showErr(e.message); btn.disabled = false; }
  };
  const fg = $('#a-forgot');
  if (fg) fg.onclick = async () => {
    const email = $('#a-email').value.trim();
    if (!email) return showErr(T('auth.need_email'));
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return showErr(error.message);
    renderAuth('signin', T('auth.reset_sent'));
  };
}
function renderRecovery() {
  $('#root').innerHTML = `<div class="authwrap single"><section class="authcard"><div class="authtop">${brandMark()}${langSwitch()}</div>
    <form id="rf" class="form"><label class="field"><span>${esc(T('auth.new_password'))}</span><input id="r-pass" type="password" autocomplete="new-password" required></label>
    <div id="r-err" class="alert bad" hidden></div><button class="btn primary wide" type="submit">${esc(T('auth.save_password'))}</button></form></section></div>`;
  bindLang();
  $('#rf').onsubmit = async ev => {
    ev.preventDefault();
    const p = $('#r-pass').value;
    const err = $('#r-err');
    if (p.length < 8) { err.textContent = T('auth.min_password'); err.hidden = false; return; }
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    toast(T('auth.password_saved')); start();
  };
}
function renderPending() {
  $('#root').innerHTML = `<div class="authwrap single"><section class="authcard"><div class="authtop">${brandMark()}${langSwitch()}</div>
    <h2 class="pendtitle">${esc(T('pending.title'))}</h2><p>${esc(T('pending.body'))}</p>
    <p class="muted">${esc(S.profile.email || '')}</p>
    <div class="row"><button class="btn" id="p-again">${esc(T('pending.refresh'))}</button><button class="btn ghost" id="p-out">${esc(T('auth.signout'))}</button></div></section></div>`;
  bindLang();
  $('#p-again').onclick = () => start();
  $('#p-out').onclick = () => sb.auth.signOut();
}

/* ---------- shell and routing ---------- */
const NAV = [
  { id: 'dashboard', roles: ['contractor', 'hse', 'operations', 'admin'] },
  { id: 'submit', roles: ['contractor'] },
  { id: 'queue', roles: ['hse', 'operations', 'admin'] },
  { id: 'conditions', roles: ['contractor', 'hse', 'operations', 'admin'] },
  { id: 'register', roles: ['contractor', 'hse', 'operations', 'admin'] },
  { id: 'alerts', roles: ['contractor', 'hse', 'operations', 'admin'] },
  { id: 'scorecard', roles: ['hse', 'operations', 'admin'] },
  { id: 'team', roles: ['admin'] }
];
function renderShell() {
  document.documentElement.lang = lang;
  const p = S.profile;
  const nav = NAV.filter(n => n.roles.includes(p.role)).map(n =>
    `<a href="#/${n.id}" data-nav="${n.id}"><span>${esc(T('nav.' + n.id))}</span>${n.id === 'alerts' ? '<i class="count" id="alertcount" hidden></i>' : ''}</a>`).join('');
  $('#root').innerHTML = `<div class="shell">
    <header class="topbar">${brandMark()}<div class="row">${langSwitch()}<button class="btn ghost sm" data-signout>${esc(T('auth.signout'))}</button></div></header>
    <aside class="side">
      <div class="sidebrand">${brandMark()}<p>${esc(T('app.sub'))}</p></div>
      <nav class="nav" id="nav">${nav}</nav>
      <div class="sidefoot">
        <div class="me"><b>${esc(p.full_name || p.email)}</b><span>${esc(T('role.' + p.role))}${p.company ? ' · ' + esc(p.company) : ''}</span></div>
        ${langSwitch()}
        <button class="btn ghost sm" data-signout>${esc(T('auth.signout'))}</button>
      </div>
    </aside>
    <main class="main"><header class="pagehead"><h1 id="title"></h1><div id="actions"></div></header><div id="body"></div></main>
  </div>`;
  bindLang();
  $$('[data-signout]').forEach(b => b.onclick = () => sb.auth.signOut());
}
function canView(name) {
  const n = NAV.find(x => x.id === name);
  return n ? n.roles.includes(role()) : ['inspection', 'report'].includes(name);
}
const VIEWS = {};
async function route() {
  if (!S.profile || !S.profile.role) return;
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  name = name || 'dashboard';
  if (!VIEWS[name] || !canView(name)) name = 'dashboard';
  const tok = ++S.tok;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === (name === 'inspection' ? 'dashboard' : name)));
  $('#actions').innerHTML = '';
  $('#title').textContent = '';
  $('#body').innerHTML = `<p class="muted">${esc(T('common.loading'))}</p>`;
  window.scrollTo(0, 0);
  try { await VIEWS[name](arg, tok); }
  catch (e) { if (tok === S.tok) $('#body').innerHTML = `<div class="alert bad">${esc(e.message || e)}</div>`; }
}
window.addEventListener('hashchange', route);

function computeAlerts(rows) {
  const out = [], r = role();
  rows.forEach(e => {
    if (e.cert_days != null && e.cert_days < 0) out.push({ sev: 0, e, text: T('alerts.expired'), href: '#/register' });
    else if (e.cert_days != null && e.cert_days <= 30) out.push({ sev: 2, e, text: T('alerts.expiring', { n: e.cert_days }), href: '#/register' });
    if (e.overdue_conditions > 0) out.push({ sev: 1, e, text: T('alerts.overdue', { n: e.overdue_conditions }), href: '#/conditions' });
    if (e.stage === 'info_requested') out.push({ sev: 1, e, text: r === 'contractor' ? T('alerts.info_me') : T('alerts.info'), href: r === 'contractor' ? '#/submit/' + e.id : '#/inspection/' + e.inspection_id });
    if (e.proofs_waiting > 0 && (r === 'hse' || r === 'admin')) out.push({ sev: 1, e, text: T('alerts.proofs', { n: e.proofs_waiting }), href: '#/conditions' });
    if ((r === 'hse' && e.stage === 'awaiting_hse') || (r === 'operations' && e.stage === 'awaiting_ops')) out.push({ sev: 3, e, text: T('alerts.review_me'), href: '#/inspection/' + e.inspection_id });
  });
  return out.sort((a, b) => a.sev - b.sev);
}
function setBadge(rows) {
  const n = computeAlerts(rows).length;
  S.badge = n;
  const el = $('#alertcount');
  if (el) { el.textContent = n; el.hidden = !n; }
}
async function refreshBadge() {
  try { setBadge(await q(sb.from('equipment_overview').select('*'))); } catch (e) { /* badge is optional */ }
}

/* ---------- dashboard: the tag board ---------- */
function tagCard(r) {
  const href = r.inspection_id ? `#/inspection/${r.inspection_id}` : (role() === 'contractor' ? `#/submit/${r.id}` : '');
  const bits = [];
  if (r.open_conditions > 0) bits.push(`<span>${esc(T('card.conditions_open', { n: r.open_conditions }))}</span>`);
  if (r.overdue_conditions > 0) bits.push(`<span class="bad">${esc(T('card.conditions_overdue', { n: r.overdue_conditions }))}</span>`);
  if (r.proofs_waiting > 0 && isStaff()) bits.push(`<span class="warn">${esc(T('card.proofs', { n: r.proofs_waiting }))}</span>`);
  let when = '';
  if (r.submitted_at) {
    const waiting = ['awaiting_hse', 'awaiting_ops'].includes(r.stage);
    const d = daysSince(r.submitted_at);
    when = waiting ? (d === 0 ? T('card.waiting_today') : T('card.waiting', { n: d })) : T('card.sent', { d: fmtDate(r.submitted_at) });
  } else if (role() === 'contractor') when = T('card.send_photos');
  const tag = href ? 'a' : 'div';
  return `<${tag} class="tagcard s-${esc(r.stage)}" ${href ? `href="${href}"` : ''}>
    <div class="tcstrip"><span class="hole"></span><span>${esc(T('stage.' + r.stage))}</span></div>
    <div class="tcbody">
      <div class="tcnum"><b>${esc(r.tag)}</b>${r.version ? `<small>${esc(T('card.version', { n: r.version }))}</small>` : ''}</div>
      <div class="tcsub">${esc(T('type.' + r.type))}${r.company ? ' — ' + esc(r.company) : ''}</div>
      <div class="tcsub muted">${esc(r.serial || '')}${r.rig ? ' / ' + esc(r.rig) : ''}</div>
      <div class="tcline"><span class="muted">${esc(T('card.cert'))}</span>${certChip(r.cert_days, r.cert_expiry)}</div>
      ${bits.length ? `<div class="tcflags">${bits.join('')}</div>` : ''}
      ${when ? `<div class="tcwhen">${esc(when)}</div>` : ''}
    </div></${tag}>`;
}
const FILTERS = ['all', 'awaiting_hse', 'awaiting_ops', 'info_requested', 'cleared', 'conditional', 'out_of_service', 'none', 'cert'];
const matchFilter = (r, f) => f === 'all' || (f === 'cert' ? r.cert_days != null && r.cert_days <= 30 : r.stage === f);
VIEWS.dashboard = async (_, tok) => {
  const rows = await q(sb.from('equipment_overview').select('*').order('tag'));
  S.rows = rows; setBadge(rows);
  if (!paint(tok, T('nav.dashboard'), `<div class="toolbar"><input id="search" type="search" placeholder="${esc(T('dash.search'))}" value="${esc(S.search)}"><div id="chips" class="chips"></div></div><div id="board" class="board"></div>`)) return;
  const draw = () => {
    const term = S.search.trim().toLowerCase();
    const inSearch = r => !term || [r.tag, r.serial, r.company, r.rig].some(x => String(x || '').toLowerCase().includes(term));
    const base = rows.filter(inSearch);
    $('#chips').innerHTML = FILTERS.map(f => {
      const n = base.filter(r => matchFilter(r, f)).length;
      if (!n && f !== 'all' && S.filter !== f) return '';
      const label = f === 'all' ? T('dash.all') : f === 'cert' ? T('dash.cert') : T('stage.' + f);
      return `<button class="chip ${S.filter === f ? 'on' : ''} ${f === 'cert' ? 's-cert' : 's-' + f}" data-f="${f}"><i></i>${esc(label)} <b>${n}</b></button>`;
    }).join('');
    $$('#chips .chip').forEach(b => b.onclick = () => { S.filter = b.dataset.f; draw(); });
    const shown = base.filter(r => matchFilter(r, S.filter));
    if (shown.length) $('#board').innerHTML = shown.map(tagCard).join('');
    else if (!rows.length) $('#board').innerHTML = `<div class="empty"><p>${esc(role() === 'contractor' ? T('dash.none_yet') : T('dash.staff_empty'))}</p>${role() === 'contractor' ? `<a class="btn primary" href="#/register">${esc(T('dash.add_first'))}</a>` : ''}</div>`;
    else $('#board').innerHTML = `<div class="empty"><p>${esc(T('dash.empty'))}</p></div>`;
  };
  $('#search').oninput = e => { S.search = e.target.value; draw(); };
  draw();
};

/* ---------- send photos (contractor) ---------- */
async function loadChecklist() {
  if (!S.checklist) S.checklist = await q(sb.from('checklist_items').select('*').eq('active', true).order('sort'));
  return S.checklist;
}
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error(T('err.photo_read')))), 'image/jpeg', 0.75));
}
async function uploadFile(path, blob, type) {
  for (let a = 0; a < 3; a++) {
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (!error) return;
    if (/already exists|duplicate/i.test(error.message || '') || String(error.statusCode) === '409') return;
    if (a === 2) throw error;
    await sleep(900 * (a + 1));
  }
}
async function pool(items, n, fn) {
  let i = 0; const errs = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) { errs.push(e); } }
  }));
  if (errs.length) throw errs[0];
}
const extFor = (f, kind) => kind === 'photo' ? 'jpg' : ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[f.type] || 'mp4');
// Photos are shrunk once, when added, so a draft saved on the phone stays small.
async function readyFile(file, kind) {
  if (kind === 'photo') return { blob: await shrink(file), type: 'image/jpeg' };
  return { blob: file, type: file.type };
}
const prepareUpload = async f => ({ blob: f.blob, type: f.type });
const withUrl = f => ({ ...f, url: URL.createObjectURL(f.blob) });
const plain = f => ({ id: f.id, kind: f.kind, type: f.type, blob: f.blob });

/* ---------- drafts saved on this device, so closing the app loses nothing ---------- */
let _db = null;
function idb() {
  if (!_db) {
    _db = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no storage'));
      const r = indexedDB.open('hse-drafts', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'key' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return _db;
}
async function draftGet(key) {
  try { const db = await idb(); return await new Promise((res, rej) => { const r = db.transaction('drafts').objectStore('drafts').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); }
  catch (e) { return null; }
}
async function draftPut(key, val) {
  try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put({ ...val, key, updated: Date.now() }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); return true; }
  catch (e) { return false; }
}
async function draftDel(key) {
  try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { /* nothing to delete */ }
}
let _warnedSave = false;
function saveWarn() { if (!_warnedSave) { _warnedSave = true; toast(T('draft.cannot_save'), 1); } }
const later = (fn, ms = 500) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

VIEWS.submit = async (arg, tok) => {
  const [rows, cl] = await Promise.all([q(sb.from('equipment_overview').select('*').order('tag')), loadChecklist()]);
  setBadge(rows);
  if (!rows.length) { paint(tok, T('nav.submit'), `<div class="empty"><p>${esc(T('submit.no_equipment'))}</p><a class="btn primary" href="#/register">${esc(T('nav.register'))}</a></div>`); return; }
  const busy = r => ['awaiting_hse', 'awaiting_ops'].includes(r.stage);
  const free = rows.filter(r => !busy(r));
  let sel = rows.find(r => r.id === arg && !busy(r)) || (S.draft && free.find(r => r.id === S.draft.eq.id)) || free[0];
  if (!paint(tok, T('nav.submit'), `<p class="lead">${esc(T('submit.intro'))}</p>
    <label class="field narrow"><span>${esc(T('submit.pick'))}</span><select id="n-eq">${rows.map(r => `<option value="${esc(r.id)}" ${busy(r) ? 'disabled' : ''} ${sel && r.id === sel.id ? 'selected' : ''}>${esc(r.tag)} — ${esc(T('type.' + r.type))}${busy(r) ? ' (' + esc(T('submit.under_review')) + ')' : ''}</option>`).join('')}</select></label>
    <div id="n-form"></div>`)) return;
  if (!sel) { $('#n-form').innerHTML = `<div class="empty"><p>${esc(T('submit.none_free'))}</p></div>`; return; }

  async function drawForm(eq) {
    const dkey = `insp:${S.uid}:${eq.id}`;
    if (!S.draft || S.draft.eq.id !== eq.id) {
      const saved = await draftGet(dkey);
      S.draft = { eq, id: (saved && saved.draftId) || uid8() + uid8(), items: {}, uploaded: (saved && saved.uploaded) || {}, restored: 0 };
      if (saved) Object.entries(saved.items || {}).forEach(([k, it]) => {
        S.draft.items[k] = { note: it.note || '', reading: it.reading || '', files: (it.files || []).map(withUrl) };
        S.draft.restored += S.draft.items[k].files.length;
      });
    }
    const list = cl.filter(c => c.equipment_type === eq.type);
    let banner = S.draft.restored ? `<div class="alert ok">${esc(T('draft.restored', { n: S.draft.restored }))}</div>` : '';
    if (eq.stage === 'info_requested' && eq.inspection_id) {
      try {
        const prev = await q(sb.from('inspections').select('contractor_message').eq('id', eq.inspection_id).single());
        banner += `<div class="alert warn"><b>${esc(T('submit.resubmit'))}</b><p class="pre">${esc(prev.contractor_message || '')}</p><p>${esc(T('submit.resubmit_help', { n: (eq.version || 0) + 1 }))}</p></div>`;
      } catch (e) { /* message is optional */ }
    }
    $('#n-form').innerHTML = `${banner}${list.map(c => {
      const hint = lbl(c, 'hint'), rl = lbl(c, 'reading_label');
      return `<section class="item" data-key="${esc(c.key)}">
        <header><h3>${esc(lbl(c, 'label'))}</h3><span class="kind ${c.kind}">${esc(T(c.kind === 'video' ? 'submit.video' : 'submit.photo'))}${c.required ? '' : ''}</span></header>
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${c.kind === 'video' ? `<p class="hint">${esc(T('submit.hint_video'))}</p>` : ''}
        <div class="thumbs" data-th="${esc(c.key)}"></div>
        <label class="btn pick"><input type="file" hidden data-pick="${esc(c.key)}" accept="${c.kind === 'video' ? 'video/*' : 'image/*'}" multiple>${esc(T(c.kind === 'video' ? 'submit.add_video' : 'submit.add_photo'))}</label>
        <input class="note" data-note="${esc(c.key)}" maxlength="500" placeholder="${esc(T('submit.note'))}">
        ${rl ? `<label class="reading"><span>${esc(rl)}</span><input data-reading="${esc(c.key)}" maxlength="20" inputmode="decimal"> ${esc(c.reading_unit || '')}</label>` : ''}
      </section>`;
    }).join('')}
    <div class="submitbar"><div><span id="n-count"></span><small id="n-saved"></small></div><button class="btn primary" id="n-go">${esc(T('submit.send'))}</button></div>`;

    const required = list.filter(c => c.required);
    const itemOf = k => (S.draft.items[k] ||= { files: [], note: '', reading: '' });
    const ready = () => required.filter(c => itemOf(c.key).files.length > 0).length;
    const bar = () => { $('#n-count').textContent = T('submit.ready', { a: ready(), b: required.length }); $('#n-go').disabled = ready() < required.length; };
    const snapshot = () => ({ eqId: eq.id, draftId: S.draft.id, uploaded: S.draft.uploaded, items: Object.fromEntries(Object.entries(S.draft.items).map(([k, it]) => [k, { note: it.note, reading: it.reading, files: it.files.map(plain) }])) });
    const save = async () => {
      const ok = await draftPut(dkey, snapshot());
      const el = $('#n-saved'); if (el) el.textContent = ok ? T('draft.saved') : '';
      if (!ok) saveWarn();
    };
    const saveSoon = later(save);
    const thumbs = key => {
      const box = $(`[data-th="${key}"]`); const d = itemOf(key);
      box.innerHTML = d.files.map(f => `<div class="th">${f.kind === 'video' ? `<video src="${esc(f.url)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(f.url)}" alt="">`}<button type="button" data-rm="${esc(f.id)}" aria-label="${esc(T('submit.remove'))}">×</button></div>`).join('');
      $$('[data-rm]', box).forEach(b => b.onclick = () => { const i = d.files.findIndex(x => x.id === b.dataset.rm); if (i >= 0) { URL.revokeObjectURL(d.files[i].url); d.files.splice(i, 1); } thumbs(key); bar(); save(); });
    };
    list.forEach(c => {
      const d = itemOf(c.key);
      thumbs(c.key);
      const note = $(`[data-note="${c.key}"]`); note.value = d.note; note.oninput = () => { d.note = note.value; saveSoon(); };
      const rd = $(`[data-reading="${c.key}"]`); if (rd) { rd.value = d.reading; rd.oninput = () => { d.reading = rd.value; saveSoon(); }; }
      $(`[data-pick="${c.key}"]`).onchange = async e => {
        const picked = [...e.target.files]; e.target.value = '';
        for (const f of picked) {
          if (c.kind === 'photo' && !f.type.startsWith('image/')) { toast(T('err.not_image'), 1); continue; }
          if (c.kind === 'video' && !f.type.startsWith('video/')) { toast(T('err.not_video'), 1); continue; }
          if (c.kind === 'video' && f.size > 40 * 1024 * 1024) { toast(T('err.video_big'), 1); continue; }
          if (d.files.length >= 8) { toast(T('err.too_many'), 1); break; }
          try { const r = await readyFile(f, c.kind); d.files.push(withUrl({ id: uid8(), kind: c.kind, type: r.type, blob: r.blob })); }
          catch (er) { toast(T('err.photo_read'), 1); }
        }
        thumbs(c.key); bar(); save();
      };
    });
    bar();
    if (S.draft.restored) save();
    $('#n-go').onclick = async () => {
      const btn = $('#n-go'); btn.disabled = true;
      const jobs = [];
      list.forEach(c => itemOf(c.key).files.forEach(f => jobs.push({ c, f, path: `${eq.id}/${S.draft.id}/${c.key}-${f.id}.${extFor(f, c.kind)}` })));
      let done = jobs.filter(j => S.draft.uploaded[j.f.id]).length;
      const prog = () => { btn.textContent = T('submit.uploading', { a: done, b: jobs.length }); };
      prog();
      try {
        await pool(jobs.filter(j => !S.draft.uploaded[j.f.id]), 3, async j => {
          const { blob, type } = await prepareUpload(j.f); await uploadFile(j.path, blob, type);
          S.draft.uploaded[j.f.id] = j.path; done++; prog(); await draftPut(dkey, snapshot());
        });
        const items = list.map(c => {
          const d = itemOf(c.key);
          return { key: c.key, files: jobs.filter(j => j.c.key === c.key).map(j => j.path), note: d.note.trim(), reading: (d.reading || '').trim() };
        }).filter(i => i.files.length);
        const id = await q(sb.rpc('submit_inspection', { p_equipment_id: eq.id, p_items: items }));
        await draftDel(dkey); S.draft = null; toast(T('submit.sent'));
        location.hash = '#/inspection/' + id;
      } catch (e) { fail(e); btn.disabled = false; btn.textContent = T('submit.send'); }
    };
  }
  $('#n-eq').onchange = e => { const r = rows.find(x => x.id === e.target.value); if (r) drawForm(r); };
  await drawForm(sel);
};

/* ---------- review queue ---------- */
VIEWS.queue = async (_, tok) => {
  const rows = await q(sb.from('equipment_overview').select('*'));
  setBadge(rows);
  const r = role();
  const byAge = (a, b) => new Date(a.submitted_at) - new Date(b.submitted_at);
  const mineStage = r === 'operations' ? 'awaiting_ops' : 'awaiting_hse';
  const mine = rows.filter(x => (r === 'admin' ? ['awaiting_hse', 'awaiting_ops'].includes(x.stage) : x.stage === mineStage)).sort(byAge);
  const others = r === 'admin' ? [] : rows.filter(x => ['awaiting_hse', 'awaiting_ops'].includes(x.stage) && x.stage !== mineStage).sort(byAge);
  const proofs = r === 'hse' || r === 'admin' ? rows.filter(x => x.proofs_waiting > 0) : [];
  const sec = (title, list) => list.length ? `<h2 class="sect">${esc(title)}</h2><div class="board">${list.map(tagCard).join('')}</div>` : '';
  paint(tok, T('nav.queue'), (mine.length || others.length || proofs.length)
    ? sec(T('queue.mine'), mine) + sec(T('queue.proofs'), proofs) + sec(T('queue.others'), others)
    : `<div class="empty"><p>${esc(T('queue.empty'))}</p></div>`);
};

/* ---------- inspection detail ---------- */
function condCard(c, urls, withEquip) {
  const overdue = c.status === 'open' && c.due_date < todayISO();
  const eq = withEquip && c.equipment ? `<a class="condeq" href="#/inspection/${esc(c.inspection_id)}">${esc(c.equipment.tag)}${c.equipment.company ? ' — ' + esc(c.equipment.company) : ''}</a>` : '';
  const r = role();
  let proof = '';
  if (c.status !== 'open' && (c.proof_files || []).length) {
    proof = `<div class="proof"><h4>${esc(T('cond.proof_title'))}</h4><div class="thumbs">${media(c.proof_files, urls)}</div>${c.proof_note ? `<p class="pre">${esc(c.proof_note)}</p>` : ''}<p class="muted small">${esc(T('cond.proof_by', { n: c.proof_by_name || '', d: fmtDT(c.proof_at) }))}</p></div>`;
  }
  let act = '';
  if (r === 'contractor' && c.status === 'open') {
    act = `<div class="condact"><label class="btn pick"><input type="file" hidden multiple accept="image/*,video/*" data-proofpick>${esc(T('cond.add_files'))}</label><div class="thumbs" data-proofthumbs></div>
      <input class="note" data-proofnote maxlength="500" placeholder="${esc(T('cond.note_ph'))}"><button class="btn primary" data-act="proof">${esc(T('cond.send_proof'))}</button></div>`;
  }
  if (r === 'hse' && c.status === 'proof_submitted') {
    act = `<div class="condact"><input class="note" data-backnote maxlength="500" placeholder="${esc(T('cond.back_note_ph'))}"><div class="row"><button class="btn primary" data-act="approve">${esc(T('cond.approve'))}</button><button class="btn" data-act="back">${esc(T('cond.send_back'))}</button></div></div>`;
  }
  return `<article class="cond c-${esc(c.status)}" data-cond="${esc(c.id)}" data-eq="${esc(c.equipment_id)}">
    <header><span class="cpill c-${esc(c.status)}">${esc(T('cond.status.' + c.status))}</span>${overdue ? `<span class="cpill c-overdue">${esc(T('cond.overdue'))}</span>` : ''}<span class="muted">${esc(T('cond.due', { d: fmtDate(c.due_date) }))}</span></header>
    ${eq}<p class="ctext pre">${esc(c.text)}</p>
    ${c.review_note && c.status === 'open' ? `<div class="alert warn small">${esc(T('cond.sent_back', { n: c.review_note }))}</div>` : ''}
    ${proof}${c.status === 'closed' ? `<p class="muted small">${esc(T('cond.closed_by', { n: c.closed_by_name || '', d: fmtDT(c.closed_at) }))}</p>` : ''}${act}</article>`;
}
function bindCond(root, reload) {
  $$('[data-cond]', root).forEach(card => {
    const id = card.dataset.cond, eqId = card.dataset.eq;
    const files = [];
    const pkey = `proof:${S.uid}:${id}`;
    const th = $('[data-proofthumbs]', card);
    const noteEl = $('[data-proofnote]', card);
    const pSave = async () => { if (!th) return; if (!(await draftPut(pkey, { files: files.map(plain), note: noteEl ? noteEl.value : '' }))) saveWarn(); };
    const pSaveSoon = later(pSave);
    const drawTh = () => { if (th) th.innerHTML = files.map(f => `<div class="th">${f.kind === 'video' ? `<video src="${esc(f.url)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(f.url)}" alt="">`}<button type="button" data-rm="${esc(f.id)}">×</button></div>`).join(''); $$('[data-rm]', th).forEach(b => b.onclick = () => { const i = files.findIndex(x => x.id === b.dataset.rm); if (i >= 0) { URL.revokeObjectURL(files[i].url); files.splice(i, 1); drawTh(); pSave(); } }); };
    if (th) draftGet(pkey).then(saved => { if (saved) { (saved.files || []).forEach(f => files.push(withUrl(f))); if (noteEl && saved.note) noteEl.value = saved.note; drawTh(); } });
    if (noteEl) noteEl.oninput = pSaveSoon;
    const pick = $('[data-proofpick]', card);
    if (pick) pick.onchange = async e => {
      const picked = [...e.target.files]; e.target.value = '';
      for (const f of picked) {
        const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'photo' : null;
        if (!kind) { toast(T('err.not_image'), 1); continue; }
        if (kind === 'video' && f.size > 40 * 1024 * 1024) { toast(T('err.video_big'), 1); continue; }
        if (files.length >= 8) { toast(T('err.too_many'), 1); break; }
        try { const r = await readyFile(f, kind); files.push(withUrl({ id: uid8(), kind, type: r.type, blob: r.blob })); }
        catch (er) { toast(T('err.photo_read'), 1); }
      }
      drawTh(); pSave();
    };
    $$('[data-act]', card).forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        if (b.dataset.act === 'proof') {
          if (!files.length) throw new Error(T('cond.add_files'));
          const paths = files.map(f => `${eqId}/proof-${id}/${f.id}.${extFor(f, f.kind)}`);
          await pool(files.map((f, i) => ({ f, p: paths[i] })), 3, async j => { const { blob, type } = await prepareUpload(j.f); await uploadFile(j.p, blob, type); });
          await q(sb.rpc('submit_condition_proof', { p_condition_id: id, p_files: paths, p_note: ($('[data-proofnote]', card).value || '').trim() }));
          await draftDel(pkey); toast(T('cond.proof_sent'));
        } else {
          const approve = b.dataset.act === 'approve';
          await q(sb.rpc('review_condition', { p_condition_id: id, p_approve: approve, p_note: ($('[data-backnote]', card).value || '').trim() || null }));
          toast(T(approve ? 'cond.closed' : 'cond.sent_back_done'));
        }
        reload();
      } catch (e) { fail(e); b.disabled = false; }
    });
  });
}

VIEWS.inspection = async (id, tok) => {
  const ins = await q(sb.from('inspections').select('*, equipment(*)').eq('id', id).single());
  const staff = isStaff(), r = role(), e = ins.equipment;
  const [vers, conds, revs, audit] = await Promise.all([
    q(sb.from('inspections').select('id,version,status,decision,created_at').eq('equipment_id', ins.equipment_id).order('version', { ascending: false })),
    q(sb.from('inspection_conditions').select('*').eq('inspection_id', id).order('due_date')),
    staff ? q(sb.from('reviews').select('*').eq('inspection_id', id).order('created_at')) : Promise.resolve([]),
    staff ? q(sb.from('audit_events').select('*').eq('inspection_id', id).order('created_at')) : Promise.resolve([])
  ]);
  const urls = await signed(ins.items.flatMap(i => i.files || []).concat(conds.flatMap(c => c.proof_files || [])));
  const st = stageOf(ins, conds);
  const hse = revs.find(x => x.dept === 'HSE'), ratings = (hse && hse.item_ratings) || {};
  const latest = vers[0] && vers[0].id === id;
  const hseForm = r === 'hse' && ins.status === 'awaiting_hse';
  const opsForm = r === 'operations' && ins.status === 'awaiting_ops';

  const itemsHtml = ins.items.map(i => {
    const rt = ratings[i.key];
    const rl = lbl(i, 'reading_label');
    return `<article class="item" data-key="${esc(i.key)}">
      <header><h3>${esc(lbl(i, 'label'))}</h3>${rt ? `<span class="sevchip sev-${esc(rt.sev)}">${esc(T('sev.' + rt.sev))}</span>` : ''}</header>
      ${i.note ? `<p class="pre">${esc(i.note)}</p>` : ''}${i.reading ? `<p class="muted">${esc(rl || T('detail.reading'))}: <b>${esc(i.reading)}</b> ${esc(i.reading_unit || '')}</p>` : ''}
      ${rt && rt.note ? `<p class="rnote">${esc(rt.note)}</p>` : ''}
      <div class="thumbs">${media(i.files, urls)}</div>
      ${hseForm ? `<div class="sevpick" data-sev="${esc(i.key)}">${['ok', 'minor', 'major', 'critical'].map((s, n) => `<label class="sev-${s}"><input type="radio" name="sev-${esc(i.key)}" value="${s}" ${n === 0 ? 'checked' : ''}><span>${esc(T('sev.' + s))}</span></label>`).join('')}</div>
        <input class="note" data-sevnote="${esc(i.key)}" maxlength="500" placeholder="${esc(T('hse.note_ph'))}">` : ''}
    </article>`;
  }).join('');

  const verHtml = vers.length > 1 ? `<nav class="vers" aria-label="${esc(T('detail.versions'))}">${vers.map(v => `<a href="#/inspection/${esc(v.id)}" class="${v.id === id ? 'on' : ''}">${esc(T('card.version', { n: v.version }))}</a>`).join('')}</nav>` : '';
  const facts = [[T('detail.contractor'), e.company], [T('detail.serial'), e.serial], [T('detail.rig'), e.rig], [T('detail.cert'), null], [T('detail.sent_by'), ins.inspector_name], [T('detail.sent_on'), fmtDT(ins.created_at)]];
  const certDays = e.cert_expiry ? Math.round((new Date(e.cert_expiry + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000) : null;
  const factsHtml = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v === null ? certChip(certDays, e.cert_expiry) : esc(v || '—')}</dd></div>`).join('');

  let status = '';
  if (ins.status === 'awaiting_hse' && r !== 'hse') status = `<p class="muted">${esc(T('detail.waiting_hse'))}</p>`;
  if (ins.status === 'awaiting_ops' && r !== 'operations') status = `<p class="muted">${esc(T('detail.waiting_ops'))}</p>`;
  const msg = ins.contractor_message && ['info_requested', 'decided'].includes(ins.status)
    ? `<section class="panel msg s-${esc(st)}"><h3>${esc(ins.status === 'decided' ? T('detail.decision') : T('detail.message'))}</h3>${ins.status === 'decided' ? `<p>${stagePill(st)}</p>` : ''}<p class="pre">${esc(ins.contractor_message)}</p>${ins.decided_at ? `<p class="muted small">${esc(T('detail.decided_by', { n: ins.decided_by_name || '', d: fmtDT(ins.decided_at) }))}</p>` : ''}</section>`
    : (ins.status === 'decided' ? `<section class="panel msg s-${esc(st)}"><h3>${esc(T('detail.decision'))}</h3><p>${stagePill(st)}</p><p class="muted small">${esc(T('detail.decided_by', { n: ins.decided_by_name || '', d: fmtDT(ins.decided_at) }))}</p></section>` : '');
  const resend = r === 'contractor' && ins.status === 'info_requested' && latest ? `<a class="btn primary" href="#/submit/${esc(ins.equipment_id)}">${esc(T('detail.send_updated'))}</a>` : '';

  const hseHtml = hseForm ? `<section class="panel form" id="hse-form"><h3>${esc(T('hse.title'))}</h3><p class="muted">${esc(T('hse.help'))}</p>
    <label class="field"><span>${esc(T('hse.verdict'))}</span><select id="h-verdict"><option value="" disabled selected>${esc(T('hse.choose'))}</option>${['accept', 'conditions', 'reject', 'more_info'].map(v => `<option value="${v}">${esc(T('hverdict.' + v))}</option>`).join('')}</select></label>
    <label class="field"><span>${esc(T('hse.comment'))}</span><textarea id="h-comment" rows="4" maxlength="2000"></textarea></label>
    <label class="field" id="h-msgwrap" hidden><span>${esc(T('hse.message'))}</span><textarea id="h-msg" rows="3" maxlength="2000"></textarea></label>
    <button class="btn primary" id="h-go">${esc(T('hse.go'))}</button></section>` : '';
  const opsHtml = opsForm ? `<section class="panel form" id="ops-form"><h3>${esc(T('ops.title'))}</h3>
    ${hse ? `<p class="hsesaid">${esc(T('ops.hse_said'))} <b>${esc(T('hverdict.' + hse.verdict))}</b></p>` : ''}${hse && hse.verdict === 'reject' ? `<div class="alert warn">${esc(T('ops.locked'))}</div>` : ''}
    <label class="field"><span>${esc(T('ops.verdict'))}</span><select id="o-verdict"><option value="" disabled selected>${esc(T('hse.choose'))}</option>${['accept', 'conditions', 'reject', 'more_info'].filter(v => !(hse && hse.verdict === 'reject' && v !== 'reject') && !(hse && hse.verdict === 'conditions' && v === 'accept')).map(v => `<option value="${v}">${esc(T('overdict.' + v))}</option>`).join('')}</select></label>
    <label class="field"><span>${esc(T('ops.comment'))}</span><textarea id="o-comment" rows="3" maxlength="2000"></textarea></label>
    <div id="o-condwrap" hidden><h4>${esc(T('ops.conditions'))}</h4><div id="o-conds"></div><button type="button" class="btn sm" id="o-addcond">${esc(T('ops.add_condition'))}</button></div>
    <label class="field" id="o-msgwrap"><span>${esc(T('ops.message'))}</span><textarea id="o-msg" rows="3" maxlength="2000"></textarea></label>
    <button class="btn primary" id="o-go">${esc(T('ops.go'))}</button></section>` : '';

  const revHtml = staff ? `<section class="panel"><h3>${esc(T('detail.comments'))}</h3>${revs.length ? revs.map(x => `<div class="rev d-${esc(x.dept)}"><div class="revhead"><b>${esc(T(x.dept === 'HSE' ? 'role.hse' : 'role.operations'))}</b><span>${esc(x.reviewer_name)}</span><em>${esc(T((x.dept === 'HSE' ? 'hverdict.' : 'overdict.') + x.verdict))}</em><small>${esc(fmtDT(x.created_at))}</small></div><p class="pre">${esc(x.comment)}</p></div>`).join('') : `<p class="muted">${esc(T('detail.no_comments'))}</p>`}</section>` : '';
  const condHtml = conds.length ? `<section class="panel"><h3>${esc(T('detail.conditions'))}</h3><div class="conds">${conds.map(c => condCard(c, urls, false)).join('')}</div></section>` : '';
  const auditHtml = staff && audit.length ? `<details class="panel audit"><summary>${esc(T('detail.audit'))} (${audit.length})</summary><ul>${audit.map(a => `<li><time>${esc(fmtDT(a.created_at))}</time> ${esc(a.actor_name || '')} <small>${esc(a.actor_role ? T('role.' + a.actor_role) : '')}</small> ${esc(T('audit.' + a.action))}</li>`).join('')}</ul></details>` : '';

  if (!paint(tok, `${e.tag} — ${T('type.' + e.type)}`, `
    <section class="panel head s-${esc(st)}"><div class="headtop">${stagePill(st)}<span class="muted">${esc(T('card.version', { n: ins.version }))}${latest ? '' : ' · ' + esc(T('detail.old_version'))}</span></div>
      <dl class="facts">${factsHtml}</dl>${verHtml}${status}</section>
    ${msg}${resend ? `<div class="actionrow">${resend}</div>` : ''}
    <section class="panel"><h3>${esc(T('detail.items'))}</h3><div class="items">${itemsHtml}</div></section>
    ${condHtml}${revHtml}${hseHtml}${opsHtml}${auditHtml}`)) return;
  $('#actions').innerHTML = `<a class="btn" href="#/report/${esc(id)}">${esc(T('detail.report'))}</a>`;
  bindCond($('#body'), route);

  if (hseForm) {
    $('#h-verdict').onchange = ev => { $('#h-msgwrap').hidden = ev.target.value !== 'more_info'; };
    $('#h-go').onclick = async () => {
      const verdict = $('#h-verdict').value;
      if (!verdict) return toast(T('hse.choose'), 1);
      const ratingsOut = {};
      $$('.item[data-key]').forEach(it => {
        const k = it.dataset.key, sel = $(`input[name="sev-${k}"]:checked`, it);
        ratingsOut[k] = { sev: sel ? sel.value : 'ok', note: ($(`[data-sevnote="${k}"]`, it) || {}).value || '' };
      });
      const b = $('#h-go'); b.disabled = true;
      try {
        await q(sb.rpc('hse_review', { p_inspection_id: id, p_verdict: verdict, p_comment: $('#h-comment').value, p_ratings: ratingsOut, p_contractor_message: verdict === 'more_info' ? $('#h-msg').value : null }));
        toast(T('hse.done')); route();
      } catch (er) { fail(er); b.disabled = false; }
    };
  }
  if (opsForm) {
    const condRow = () => { const d = document.createElement('div'); d.className = 'condrow'; d.innerHTML = `<input class="ctxt" maxlength="500" placeholder="${esc(T('ops.cond_ph'))}"><input class="cdue" type="date" min="${todayISO()}" aria-label="${esc(T('ops.due'))}"><button type="button" class="btn ghost sm" aria-label="${esc(T('submit.remove'))}">×</button>`; $('button', d).onclick = () => d.remove(); $('#o-conds').append(d); };
    $('#o-addcond').onclick = condRow;
    $('#o-verdict').onchange = ev => {
      $('#o-condwrap').hidden = ev.target.value !== 'conditions';
      if (ev.target.value === 'conditions' && !$('#o-conds').children.length) condRow();
    };
    $('#o-go').onclick = async () => {
      const verdict = $('#o-verdict').value;
      if (!verdict) return toast(T('hse.choose'), 1);
      const conditions = verdict === 'conditions' ? $$('.condrow').map(d => ({ text: $('.ctxt', d).value, due: $('.cdue', d).value })) : null;
      const b = $('#o-go'); b.disabled = true;
      try {
        await q(sb.rpc('ops_review', { p_inspection_id: id, p_verdict: verdict, p_comment: $('#o-comment').value, p_contractor_message: $('#o-msg').value, p_conditions: conditions }));
        toast(T('ops.done')); route();
      } catch (er) { fail(er); b.disabled = false; }
    };
  }
};

/* ---------- conditions ---------- */
VIEWS.conditions = async (_, tok) => {
  if (!S.condFilter) S.condFilter = role() === 'hse' ? 'proof_submitted' : 'open';
  const list =await q(sb.from('inspection_conditions').select('*, equipment(tag,type,company)').order('due_date'));
  const urls = await signed(list.flatMap(c => c.proof_files || []));
  const draw = () => {
    const shown = list.filter(c => S.condFilter === 'all' || c.status === S.condFilter);
    $('#cchips').innerHTML = ['open', 'proof_submitted', 'closed', 'all'].map(f => `<button class="chip ${S.condFilter === f ? 'on' : ''}" data-cf="${f}"><i></i>${esc(T('cond.f_' + f))} <b>${f === 'all' ? list.length : list.filter(c => c.status === f).length}</b></button>`).join('');
    $$('[data-cf]').forEach(b => b.onclick = () => { S.condFilter = b.dataset.cf; draw(); });
    $('#clist').innerHTML = shown.length ? shown.map(c => condCard(c, urls, true)).join('') : `<div class="empty"><p>${esc(T('cond.empty'))}</p></div>`;
    bindCond($('#clist'), route);
  };
  if (!paint(tok, T('nav.conditions'), '<div class="toolbar"><div id="cchips" class="chips"></div></div><div id="clist" class="conds"></div>')) return;
  draw();
};

/* ---------- equipment register ---------- */
VIEWS.register = async (_, tok) => {
  const rows = await q(sb.from('equipment_overview').select('*').order('tag'));
  setBadge(rows);
  const staff = isStaff();
  if (!paint(tok, T('nav.register'), `<section class="panel form"><h3>${esc(T('reg.add'))}</h3>
    <div class="grid2">
      <label class="field"><span>${esc(T('reg.tag'))}</span><input id="e-tag" maxlength="40"></label>
      <label class="field"><span>${esc(T('reg.type'))}</span><select id="e-type"><option value="forklift">${esc(T('type.forklift'))}</option><option value="crane">${esc(T('type.crane'))}</option></select></label>
      ${staff ? `<label class="field"><span>${esc(T('reg.company'))}</span><input id="e-co" maxlength="120"></label>` : ''}
      <label class="field"><span>${esc(T('reg.serial'))}</span><input id="e-ser" maxlength="60"></label>
      <label class="field"><span>${esc(T('reg.rig'))}</span><input id="e-rig" maxlength="60"></label>
      <label class="field"><span>${esc(T('reg.cert'))}</span><input id="e-exp" type="date"></label>
    </div><button class="btn primary" id="e-add">${esc(T('reg.go'))}</button></section>
    <h2 class="sect">${esc(T('reg.list'))}</h2>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>${esc(T('reg.tag'))}</th><th>${esc(T('reg.type'))}</th><th>${esc(T('reg.company'))}</th><th>${esc(T('reg.serial'))}</th><th>${esc(T('reg.rig'))}</th><th>${esc(T('reg.cert'))}</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.tag)}</b></td><td>${esc(T('type.' + r.type))}</td><td>${esc(r.company || '—')}</td><td>${esc(r.serial || '—')}</td><td>${esc(r.rig || '—')}</td>
      <td>${staff ? `<div class="inl"><input type="date" value="${esc(r.cert_expiry || '')}" data-cert="${esc(r.id)}"><button class="btn sm" data-savecert="${esc(r.id)}">${esc(T('reg.save'))}</button></div>` : certChip(r.cert_days, r.cert_expiry)}</td></tr>`).join('')}
    </tbody></table></div>`)) return;
  $('#e-add').onclick = async () => {
    const b = $('#e-add'); b.disabled = true;
    try {
      await q(sb.rpc('register_equipment', { p_tag: $('#e-tag').value, p_type: $('#e-type').value, p_serial: $('#e-ser').value, p_rig: $('#e-rig').value, p_cert_expiry: $('#e-exp').value || null, p_company: staff ? $('#e-co').value : null }));
      toast(T('reg.added')); route();
    } catch (e) { fail(e); b.disabled = false; }
  };
  $$('[data-savecert]').forEach(b => b.onclick = async () => {
    const id = b.dataset.savecert, v = $(`[data-cert="${id}"]`).value;
    b.disabled = true;
    try { await q(sb.rpc('set_cert_expiry', { p_equipment_id: id, p_expiry: v || null })); toast(T('reg.saved')); route(); } catch (e) { fail(e); b.disabled = false; }
  });
};

/* ---------- alerts ---------- */
VIEWS.alerts = async (_, tok) => {
  const rows = await q(sb.from('equipment_overview').select('*'));
  setBadge(rows);
  const list = computeAlerts(rows);
  paint(tok, T('nav.alerts'), list.length ? `<ul class="alerts">${list.map(a => `<li class="al sev${a.sev}"><a href="${a.href}"><b>${esc(a.e.tag)}</b><span>${esc(a.e.company || '')}</span><em>${esc(a.text)}</em></a></li>`).join('')}</ul>` : `<div class="empty"><p>${esc(T('alerts.empty'))}</p></div>`);
};

/* ---------- vendor scorecard ---------- */
VIEWS.scorecard = async (_, tok) => {
  const rows = await q(sb.rpc('vendor_scorecard'));
  const n = v => (v == null ? '—' : esc(v));
  paint(tok, T('nav.scorecard'), rows.length ? `<div class="tblwrap"><table class="tbl score"><thead><tr><th>${esc(T('score.company'))}</th><th>${esc(T('score.machines'))}</th><th>${esc(T('score.submissions'))}</th><th>${esc(T('score.accepted'))}</th><th>${esc(T('score.conditional'))}</th><th>${esc(T('score.rejected'))}</th><th>${esc(T('score.rate'))}</th><th>${esc(T('score.resub'))}</th><th>${esc(T('score.days'))}</th><th>${esc(T('score.overdue'))}</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.company)}</b></td><td>${n(r.machines)}</td><td>${n(r.submissions)}</td><td>${n(r.accepted)}</td><td>${n(r.conditional)}</td><td>${n(r.rejected)}</td>
      <td>${r.rejection_rate == null ? '—' : `<span class="rate"><span class="bar"><i style="width:${Math.min(100, Number(r.rejection_rate))}%"></i></span><b>${esc(r.rejection_rate)}%</b></span>`}</td><td>${n(r.resubmissions)}</td><td>${n(r.avg_days_to_decision)}</td><td class="${r.overdue_conditions > 0 ? 'bad' : ''}">${n(r.overdue_conditions)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty"><p>${esc(T('score.empty'))}</p></div>`);
};

/* ---------- team (admin) ---------- */
VIEWS.team = async (_, tok) => {
  const users = await q(sb.from('profiles').select('*').order('created_at', { ascending: false }));
  const pending = users.filter(u => !u.role), active = users.filter(u => u.role);
  const row = u => `<tr data-user="${esc(u.id)}"><td><b>${esc(u.full_name || '—')}</b><div class="muted small">${esc(u.email || '')}</div>${!u.role && u.requested_role ? `<div class="small">${esc(T('team.requested', { r: T('role.' + u.requested_role) + (u.requested_company ? ' / ' + u.requested_company : '') }))}</div>` : ''}</td>
    <td><select data-role>${[['', 'role.none'], ['contractor', 'role.contractor'], ['hse', 'role.hse'], ['operations', 'role.operations'], ['admin', 'role.admin']].map(([v, k]) => `<option value="${v}" ${(u.role || '') === v ? 'selected' : ''}>${esc(T(k))}</option>`).join('')}</select></td>
    <td><input data-company value="${esc(u.company || u.requested_company || '')}" placeholder="${esc(T('team.company_ph'))}" maxlength="120"></td><td><button class="btn sm primary" data-saveuser>${esc(T('team.save'))}</button></td></tr>`;
  const table = list => `<div class="tblwrap"><table class="tbl"><tbody>${list.map(row).join('')}</tbody></table></div>`;
  if (!paint(tok, T('nav.team'), `${pending.length ? `<h2 class="sect">${esc(T('team.pending'))} (${pending.length})</h2>${table(pending)}` : ''}<h2 class="sect">${esc(T('team.members'))}</h2>${active.length ? table(active) : `<p class="muted">${esc(T('team.empty'))}</p>`}`)) return;
  $$('[data-saveuser]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'); b.disabled = true;
    try {
      await q(sb.rpc('admin_set_profile', { p_user_id: tr.dataset.user, p_role: $('[data-role]', tr).value || null, p_company: $('[data-company]', tr).value, p_name: null }));
      toast(T('team.saved')); route();
    } catch (e) { fail(e); b.disabled = false; }
  });
};

/* ---------- printable report ---------- */
VIEWS.report = async (id, tok) => {
  const ins = await q(sb.from('inspections').select('*, equipment(*)').eq('id', id).single());
  const staff = isStaff(), e = ins.equipment;
  const [conds, revs] = await Promise.all([
    q(sb.from('inspection_conditions').select('*').eq('inspection_id', id).order('due_date')),
    staff ? q(sb.from('reviews').select('*').eq('inspection_id', id).order('created_at')) : Promise.resolve([])
  ]);
  const urls = await signed(ins.items.flatMap(i => i.files || []));
  const st = stageOf(ins, conds);
  const hse = revs.find(x => x.dept === 'HSE'), ratings = (hse && hse.item_ratings) || {};
  const draw = () => {
    const internal = staff && S.reportInternal;
    const findings = ins.items.map(i => {
      const rt = ratings[i.key];
      const photos = (i.files || []).filter(p => !isVideo(p) && urls[p]).map(p => `<img class="rimg" src="${esc(urls[p])}" alt="">`).join('');
      const vids = (i.files || []).filter(isVideo).length;
      return `<div class="ritem"><div class="rhead"><b>${esc(lbl(i, 'label'))}</b>${internal && rt ? `<span class="sevchip sev-${esc(rt.sev)}">${esc(T('sev.' + rt.sev))}</span>` : ''}</div>
        ${i.note ? `<p class="pre">${esc(i.note)}</p>` : ''}${i.reading ? `<p>${esc(lbl(i, 'reading_label') || T('detail.reading'))}: ${esc(i.reading)} ${esc(i.reading_unit || '')}</p>` : ''}
        ${internal && rt && rt.note ? `<p class="rnote">${esc(rt.note)}</p>` : ''}<div class="rimgs">${photos}</div>${vids ? `<p class="muted small">${esc(T('report.video'))} (${vids})</p>` : ''}</div>`;
    }).join('');
    $('#rbody').innerHTML = `<header class="rtitle"><h2>${esc(T('app.name'))} — ${esc(T('report.title'))}</h2><p class="muted">${esc(T('report.generated', { d: fmtDT(new Date()), n: S.profile.full_name || S.profile.email }))}</p></header>
      <dl class="facts rfacts"><div><dt>${esc(T('reg.tag'))}</dt><dd><b>${esc(e.tag)}</b> — ${esc(T('type.' + e.type))}</dd></div>
        <div><dt>${esc(T('detail.contractor'))}</dt><dd>${esc(e.company || '—')}</dd></div><div><dt>${esc(T('detail.serial'))}</dt><dd>${esc(e.serial || '—')}</dd></div>
        <div><dt>${esc(T('detail.rig'))}</dt><dd>${esc(e.rig || '—')}</dd></div><div><dt>${esc(T('detail.cert'))}</dt><dd>${esc(fmtDate(e.cert_expiry))}</dd></div>
        <div><dt>${esc(T('detail.versions'))}</dt><dd>${esc(T('card.version', { n: ins.version }))}</dd></div>
        <div><dt>${esc(T('detail.sent_by'))}</dt><dd>${esc(ins.inspector_name)}</dd></div><div><dt>${esc(T('detail.sent_on'))}</dt><dd>${esc(fmtDT(ins.created_at))}</dd></div></dl>
      <section class="rsec"><h3>${esc(T('report.decision'))}</h3><p>${stagePill(st)}</p>${ins.contractor_message ? `<p class="pre">${esc(ins.contractor_message)}</p>` : ''}${ins.decided_at ? `<p class="muted small">${esc(T('detail.decided_by', { n: ins.decided_by_name || '', d: fmtDT(ins.decided_at) }))}</p>` : ''}</section>
      ${conds.length ? `<section class="rsec"><h3>${esc(T('detail.conditions'))}</h3><ul>${conds.map(c => `<li>${esc(c.text)} — ${esc(T('cond.due', { d: fmtDate(c.due_date) }))} (${esc(T('cond.status.' + c.status))})</li>`).join('')}</ul></section>` : ''}
      ${internal && revs.length ? `<section class="rsec"><h3>${esc(T('report.internal_reviews'))}</h3>${revs.map(x => `<p><b>${esc(T(x.dept === 'HSE' ? 'role.hse' : 'role.operations'))}</b> — ${esc(x.reviewer_name)} — ${esc(T((x.dept === 'HSE' ? 'hverdict.' : 'overdict.') + x.verdict))}<br><span class="pre">${esc(x.comment)}</span></p>`).join('')}</section>` : ''}
      <section class="rsec"><h3>${esc(T('report.findings'))}</h3>${findings}</section>
      <section class="rsec sign"><div><span></span>${esc(T('report.hse_sign'))}</div><div><span></span>${esc(T('report.ops_sign'))}</div><div><span></span>${esc(T('report.date'))}</div></section>`;
  };
  if (!paint(tok, T('report.title'), `<div class="toolbar noprint"><a class="btn" href="#/inspection/${esc(id)}">${esc(T('report.back'))}</a>
    ${staff ? `<label class="check"><input type="checkbox" id="r-int" ${S.reportInternal ? 'checked' : ''}> ${esc(T('report.internal'))}</label>` : ''}
    <button class="btn primary" id="r-print">${esc(T('report.print'))}</button></div><article class="report" id="rbody"></article>`)) return;
  draw();
  const cb = $('#r-int'); if (cb) cb.onchange = () => { S.reportInternal = cb.checked; draw(); };
  $('#r-print').onclick = () => window.print();
};

/* ---------- boot ---------- */
async function start() {
  if (!S.session) { renderAuth(); return; }
  try { S.profile = await q(sb.from('profiles').select('*').eq('id', S.session.user.id).single()); }
  catch (e) { $('#root').innerHTML = `<div class="authwrap single"><section class="authcard"><div class="alert bad">${esc(e.message || e)}</div><button class="btn" onclick="location.reload()">${esc(T('common.refresh'))}</button></section></div>`; return; }
  if (!S.profile.role) { renderPending(); return; }
  renderShell();
  refreshBadge();
  route();
}
sb.auth.onAuthStateChange((ev, session) => {
  setTimeout(() => {
    const newUid = session && session.user ? session.user.id : null;
    if (ev === 'PASSWORD_RECOVERY') { S.session = session; S.uid = newUid; renderRecovery(); return; }
    if (ev === 'INITIAL_SESSION' || ev === 'SIGNED_OUT' || newUid !== S.uid) {
      S.session = session; S.uid = newUid; if (!newUid) { S.profile = null; S.draft = null; }
      start();
    } else S.session = session;
  }, 0);
});
