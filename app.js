'use strict';
/* CCDC HSE — equipment inspection. Static app: Supabase handles login, saved inspections and photo storage. */
const sb = supabase.createClient(CFG.url, CFG.key);
const BUCKET = 'inspection-photos';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid8 = () => Math.random().toString(36).slice(2, 10);

const S = { session: null, uid: null, profile: null, tok: 0, filter: 'all', search: '', checklist: null, draft: null, reports: {} };
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
const canWork = () => ['hse', 'admin'].includes(role());
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), err ? 6000 : 3500);
}
const fail = e => toast((e && e.message) || T('common.error'), 1);

/* ---------- small UI pieces ---------- */
const VKEY = { accept: 'cleared', conditions: 'conditional', reject: 'out_of_service' };
const machineName = r => [r.brand, r.model].filter(Boolean).join(' ') || r.tag || '—';
const worstSev = r => { const c = countSev(r); return c.critical ? 'out_of_service' : c.major ? 'conditional' : 'cleared'; };
const verdictPill = v => `<span class="stag s-${esc(VKEY[v] || 'none')}">${esc(T('verdict.' + v))}</span>`;
const isVideo = p => /\.(mp4|mov|webm)$/i.test(p);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
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
const countSev = ins => {
  const c = { ok: 0, minor: 0, major: 0, critical: 0, na: 0 };
  (ins.items || []).forEach(i => { if (c[i.sev] != null) c[i.sev]++; });
  (ins.others || []).forEach(o => { if (c[o.sev] != null) c[o.sev]++; });
  return c;
};
const sevChip = s => `<span class="sevchip sev-${esc(s)}">${esc(T('sev.' + s))}</span>`;

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
  const tu = testUsers();
  const testPanel = tu.length ? `<div class="testbox"><h3>${esc(T('test.title'))}</h3><p>${esc(T('test.sub'))}</p><div class="testbtns">${tu.map((u, i) => `<button type="button" class="btn" data-test="${i}"><b>${esc(T('role.' + u.role))}</b>${u.company ? `<small>${esc(u.company)}</small>` : ''}</button>`).join('')}</div></div>` : '';
  $('#root').innerHTML = `<div class="authwrap">
    <section class="authart" aria-hidden="true">
      <div class="hangs"><span class="stag s-cleared">${esc(T('verdict.accept'))}</span><span class="stag s-conditional">${esc(T('verdict.conditions'))}</span><span class="stag s-out_of_service">${esc(T('verdict.reject'))}</span></div>
      <h2>${esc(T('app.tagline'))}</h2>
    </section>
    <section class="authcard">
      <div class="authtop">${brandMark()}${langSwitch()}</div>
      ${testPanel}
      <div class="tabs"><button data-mode="signin" class="${mode === 'signin' ? 'on' : ''}">${esc(T('auth.signin'))}</button><button data-mode="signup" class="${mode === 'signup' ? 'on' : ''}">${esc(T('auth.signup'))}</button></div>
      ${note ? `<div class="alert ok">${esc(note)}</div>` : ''}
      <form id="authform" class="form" novalidate>
        ${mode === 'signup' ? `<label class="field"><span>${esc(T('auth.name'))}</span><input id="a-name" autocomplete="name" required></label>` : ''}
        <label class="field"><span>${esc(T('auth.email'))}</span><input id="a-email" type="email" autocomplete="email" required></label>
        <label class="field"><span>${esc(T('auth.password'))}</span><input id="a-pass" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required></label>
        <div id="a-err" class="alert bad" hidden></div>
        <button class="btn primary wide" id="a-go" type="submit">${esc(T(mode === 'signup' ? 'auth.signup' : 'auth.signin'))}</button>
        ${mode === 'signin' ? `<button class="link" type="button" id="a-forgot">${esc(T('auth.forgot'))}</button>` : ''}
      </form>
    </section></div>`;
  bindLang();
  $$('[data-mode]').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  const showErr = m => { const e = $('#a-err'); e.textContent = m; e.hidden = !m; };
  $$('[data-test]').forEach(b => b.onclick = async () => {
    const u = tu[Number(b.dataset.test)];
    $$('[data-test]').forEach(x => { x.disabled = true; });
    const { error } = await sb.auth.signInWithPassword({ email: u.email, password: u.password });
    if (error) { showErr(error.message); $$('[data-test]').forEach(x => { x.disabled = false; }); }
  });
  $('#authform').onsubmit = async ev => {
    ev.preventDefault(); showErr('');
    const email = $('#a-email').value.trim(), password = $('#a-pass').value;
    const btn = $('#a-go'); btn.disabled = true;
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const full_name = $('#a-name').value.trim();
        if (password.length < 8) throw new Error(T('auth.min_password'));
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, requested_role: 'hse' }, emailRedirectTo: location.origin + location.pathname } });
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
const NAV = { inspector: [{ id: 'list', href: '#/' }, { id: 'new', href: '#/new' }], admin: [{ id: 'admin', href: '#/admin' }] };
const testUsers = () => (window.CFG && CFG.TEST_MODE && CFG.TEST_USERS) || [];
const mode = () => (/^#\/admin/.test(location.hash) && role() === 'admin' ? 'admin' : 'inspector');
function drawNav() {
  const m = mode();
  $('#nav').innerHTML = NAV[m].map(n => `<a href="${n.href}" data-nav="${n.id}"><span>${esc(T('nav.' + n.id))}</span></a>`).join('');
  $$('[data-mode]').forEach(a => a.classList.toggle('on', a.dataset.mode === m));
}
function renderShell() {
  document.documentElement.lang = lang;
  const p = S.profile;
  const out = testUsers().length ? '' : `<button class="btn ghost sm" data-signout>${esc(T('auth.signout'))}</button>`;
  const sw = role() === 'admin' ? `<div class="modesw" role="tablist" aria-label="${esc(T('mode.label'))}"><a href="#/" data-mode="inspector">${esc(T('mode.inspector'))}</a><a href="#/admin" data-mode="admin">${esc(T('mode.admin'))}</a></div>` : '';
  $('#root').innerHTML = `<div class="shell">
    <header class="topbar">${brandMark()}<div class="row">${langSwitch()}${out}</div></header>
    ${sw ? `<div class="modebar">${sw}</div>` : ''}
    <aside class="side">
      <div class="sidebrand">${brandMark()}<p>${esc(T('app.sub'))}</p></div>
      ${sw}
      <nav class="nav" id="nav"></nav>
      <div class="sidefoot">
        <div class="me"><b>${esc(p.full_name || p.email)}</b><span>${esc(T('role.' + p.role))}</span></div>
        ${langSwitch()}${out}
      </div>
    </aside>
    <main class="main"><header class="pagehead"><h1 id="title"></h1><div id="actions"></div></header><div id="body"></div></main>
  </div>`;
  bindLang();
  $$('[data-signout]').forEach(b => b.onclick = () => sb.auth.signOut());
}
const VIEWS = {};
async function route() {
  if (!S.profile || !canWork()) return;
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  name = name || 'list';
  if (!VIEWS[name] || (name === 'admin' && role() !== 'admin')) name = 'list';
  const tok = ++S.tok;
  drawNav();
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === (name === 'inspection' ? 'list' : name)));
  $('#actions').innerHTML = '';
  $('#title').textContent = '';
  $('#body').innerHTML = `<p class="muted">${esc(T('common.loading'))}</p>`;
  window.scrollTo(0, 0);
  try { await VIEWS[name](arg, tok); }
  catch (e) { if (tok === S.tok) $('#body').innerHTML = `<div class="alert bad">${esc(e.message || e)}</div>`; }
}
window.addEventListener('hashchange', route);

/* ---------- photos, uploads and drafts ---------- */
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
const extFor = f => f.kind === 'photo' ? 'jpg' : ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[f.type] || 'mp4');
// Photos are shrunk once, when added, so a draft saved on the phone stays small.
async function readyFile(file, kind) {
  if (kind === 'photo') return { blob: await shrink(file), type: 'image/jpeg' };
  return { blob: file, type: file.type };
}
const prepareUpload = async f => ({ blob: f.blob, type: f.type });
const withUrl = f => ({ ...f, url: URL.createObjectURL(f.blob) });
const plain = f => ({ id: f.id, kind: f.kind, type: f.type, blob: f.blob });

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
const draftKey = () => 'insp:' + S.uid;

/* ---------- inspections list ---------- */
function inspCard(r) {
  const c = countSev(r), issues = c.minor + c.major + c.critical;
  return `<a class="tagcard s-${worstSev(r)}" href="#/inspection/${esc(r.id)}">
    <div class="tcstrip"><span class="hole"></span><span>${esc(T('type.' + r.equipment_type))}</span></div>
    <div class="tcbody">
      <div class="tcnum"><b>${esc(machineName(r))}</b></div>
      <div class="tcsub">${esc([r.capacity, r.location].filter(Boolean).join(' — '))}</div>
      <div class="tcline"><span class="muted">${esc(T('card.date'))}</span><span>${esc(fmtDate(r.inspected_on))}</span></div>
      <div class="tcflags">${c.critical ? `<span class="bad">${esc(T('card.critical', { n: c.critical }))}</span>` : ''}${c.major ? `<span class="warn">${esc(T('card.major', { n: c.major }))}</span>` : ''}${c.minor ? `<span>${esc(T('card.minor', { n: c.minor }))}</span>` : ''}${issues ? '' : `<span class="okline">${esc(T('card.no_issues'))}</span>`}</div>
    </div></a>`;
}
const VCHIPS = ['all', 'crane', 'forklift'];
VIEWS.list = async (_, tok) => {
  const [rows, draft] = await Promise.all([
    q(sb.from('inspections').select('id,brand,model,capacity,location,equipment_type,inspected_on,items,others,created_at').order('inspected_on', { ascending: false }).order('created_at', { ascending: false })),
    draftGet(draftKey())
  ]);
  const dhtml = draft ? `<div class="alert warn draftcard"><div><b>${esc(T('list.draft'))}</b><p>${esc((draft.d && [draft.d.brand, draft.d.model].filter(Boolean).join(' ')) || T('list.draft_untitled'))}</p></div><a class="btn primary" href="#/new">${esc(T('list.resume'))}</a></div>` : '';
  if (!paint(tok, T('nav.list'), `${dhtml}<div class="toolbar"><input id="search" type="search" placeholder="${esc(T('list.search'))}" value="${esc(S.search)}"><div id="chips" class="chips"></div></div><div id="board" class="board"></div>`)) return;
  const draw = () => {
    const term = S.search.trim().toLowerCase();
    const base = rows.filter(r => !term || [r.brand, r.model, r.capacity, r.location].some(x => String(x || '').toLowerCase().includes(term)));
    $('#chips').innerHTML = VCHIPS.map(f => {
      const n = base.filter(r => f === 'all' || r.equipment_type === f).length;
      return `<button class="chip ${S.filter === f ? 'on' : ''} s-all" data-f="${f}"><i></i>${esc(f === 'all' ? T('list.all') : T('type.' + f))} <b>${n}</b></button>`;
    }).join('');
    $$('#chips .chip').forEach(b => b.onclick = () => { S.filter = b.dataset.f; draw(); });
    const shown = base.filter(r => S.filter === 'all' || r.equipment_type === S.filter);
    $('#board').innerHTML = shown.length ? shown.map(inspCard).join('')
      : `<div class="empty"><p>${esc(rows.length ? T('list.no_match') : T('list.empty'))}</p>${rows.length ? '' : `<a class="btn primary" href="#/new">${esc(T('nav.new'))}</a>`}</div>`;
  };
  $('#search').oninput = e => { S.search = e.target.value; draw(); };
  draw();
  $('#actions').innerHTML = `<a class="btn primary" href="#/new">+ ${esc(T('nav.new'))}</a>`;
};

/* ---------- new inspection ---------- */
const SEVS = ['ok', 'minor', 'major', 'critical', 'na'];
function newDraft() {
  return { id: uuid(), type: 'crane', d: { brand: '', model: '', capacity: '', location: '', date: todayISO(), cert: '', inspector: (S.profile && S.profile.full_name) || '' }, items: {}, others: [], comment: '', uploaded: {} };
}
async function loadDraft() {
  if (S.draft && S.draft.uid === S.uid) return S.draft;
  const saved = await draftGet(draftKey());
  const dr = newDraft();
  if (saved) {
    dr.id = saved.draftId || dr.id; dr.type = saved.type || 'crane'; dr.d = { ...dr.d, ...(saved.d || {}) };
    dr.comment = saved.comment || ''; dr.uploaded = saved.uploaded || {};
    Object.entries(saved.items || {}).forEach(([k, it]) => { dr.items[k] = { sev: it.sev || '', note: it.note || '', reading: it.reading || '', files: (it.files || []).map(withUrl) }; });
    dr.others = (saved.others || []).map(o => ({ id: o.id, sev: o.sev || 'minor', note: o.note || '', files: (o.files || []).map(withUrl) }));
    dr.restored = true;
  }
  dr.uid = S.uid; S.draft = dr;
  return dr;
}
VIEWS.new = async (_, tok) => {
  const cl = await loadChecklist();
  const dr = await loadDraft();
  const key = draftKey();
  const listFor = () => cl.filter(c => c.equipment_type === dr.type);
  const slot = k => k.startsWith('o_') ? dr.others.find(o => 'o_' + o.id === k) : (dr.items[k] ||= { sev: '', note: '', reading: '', files: [] });
  const snapshot = () => ({ draftId: dr.id, type: dr.type, d: dr.d, comment: dr.comment, uploaded: dr.uploaded,
    items: Object.fromEntries(Object.entries(dr.items).map(([k, it]) => [k, { sev: it.sev, note: it.note, reading: it.reading, files: it.files.map(plain) }])),
    others: dr.others.map(o => ({ id: o.id, sev: o.sev, note: o.note, files: o.files.map(plain) })) });
  const save = async () => {
    if (S.draft !== dr) return;
    const ok = await draftPut(key, snapshot());
    const el = $('#n-saved'); if (el) el.textContent = ok ? T('draft.saved') : '';
    if (!ok) saveWarn();
  };
  const saveSoon = later(save);

  const sevPick = (k, cur, only) => `<div class="sevpick" data-sevbox="${esc(k)}">${(only || SEVS).map(s => `<label class="sev-${s}"><input type="radio" name="sev-${esc(k)}" value="${s}" data-sevr="${esc(k)}" ${cur === s ? 'checked' : ''}><span>${esc(T('sev.' + s))}</span></label>`).join('')}</div>`;
  const pickBtn = k => `<div class="pickwrap"><button type="button" class="btn pick" data-pickmenu="1">+ ${esc(T('new.add_media'))}</button>
    <div class="pickmenu" hidden>
      <label><input type="file" hidden data-pick="${esc(k)}" accept="image/*" capture="environment">${esc(T('new.take_photo'))}</label>
      <label><input type="file" hidden data-pick="${esc(k)}" accept="video/*" capture="environment">${esc(T('new.take_video'))}</label>
      <label><input type="file" hidden data-pick="${esc(k)}" accept="image/*,video/*" multiple>${esc(T('new.from_gallery'))}</label></div></div>`;
  const itemHtml = (c, n) => {
    const it = slot(c.key), hint = lbl(c, 'hint'), rl = lbl(c, 'reading_label');
    return `<section class="item" data-key="${esc(c.key)}">
      <header><h3><span class="num">${n}</span>${esc(lbl(c, 'label'))}</h3></header>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
      ${sevPick(c.key, it.sev)}
      <div class="thumbs" data-th="${esc(c.key)}"></div>
      ${pickBtn(c.key)}
      <input class="note" data-note="${esc(c.key)}" maxlength="500" placeholder="${esc(T('new.note'))}" value="${esc(it.note)}">
      ${rl ? `<label class="reading"><span>${esc(rl)}</span><input data-reading="${esc(c.key)}" maxlength="20" inputmode="decimal" value="${esc(it.reading)}"> ${esc(c.reading_unit || '')}</label>` : ''}
    </section>`;
  };
  const otherHtml = (o, i) => `<section class="item other" data-key="o_${esc(o.id)}">
      <header><h3><span class="num">+</span>${esc(T('new.obs', { n: i + 1 }))}</h3><button type="button" class="btn ghost sm" data-rmother="${esc(o.id)}">${esc(T('common.remove'))}</button></header>
      ${sevPick('o_' + o.id, o.sev, ['minor', 'major', 'critical'])}
      <textarea class="note" rows="2" data-note="o_${esc(o.id)}" maxlength="500" placeholder="${esc(T('new.obs_ph'))}">${esc(o.note)}</textarea>
      <div class="thumbs" data-th="o_${esc(o.id)}"></div>
      ${pickBtn('o_' + o.id)}
    </section>`;

  function drawForm() {
    const list = listFor();
    const secs = [];
    list.forEach((c, i) => { const nm = lbl(c, 'section'); let g = secs[secs.length - 1]; if (!g || g.name !== nm) { g = { name: nm, items: [] }; secs.push(g); } g.items.push({ c, n: i + 1 }); });
    const f = (id, label, val, extra = '') => `<label class="field"><span>${esc(label)}</span><input id="${id}" value="${esc(val)}" maxlength="120" ${extra}></label>`;
    $('#n-form').innerHTML = `
      ${dr.restored ? `<div class="alert ok">${esc(T('draft.restored'))}</div>` : ''}
      <section class="panel"><h3>${esc(T('new.details'))}</h3>
        <div class="seg" role="radiogroup" aria-label="${esc(T('new.type'))}">${['crane', 'forklift'].map(t => `<label><input type="radio" name="n-type" value="${t}" ${dr.type === t ? 'checked' : ''}><span>${esc(T('type.' + t))}</span></label>`).join('')}</div>
        <div class="fgrid">
          ${f('d-brand', T('new.brand'), dr.d.brand, 'required')}${f('d-model', T('new.model'), dr.d.model)}
          ${f('d-capacity', T('new.capacity'), dr.d.capacity)}${f('d-location', T('new.location'), dr.d.location)}
          <label class="field"><span>${esc(T('new.date'))}</span><input id="d-date" type="date" value="${esc(dr.d.date)}"></label>
          <label class="field"><span>${esc(T('new.cert'))}</span><input id="d-cert" type="date" value="${esc(dr.d.cert)}"></label>
          ${f('d-inspector', T('new.inspector'), dr.d.inspector)}
        </div>
      </section>
      <nav class="secnav" aria-label="${esc(T('new.sections'))}">${secs.map((g, i) => `<button type="button" data-jump="${i}">${esc(g.name)} <b data-secprog="${i}"></b></button>`).join('')}<button type="button" data-jump="others">${esc(T('new.others'))}</button><button type="button" data-jump="result">${esc(T('new.comment'))}</button></nav>
      ${secs.map((g, i) => `<h2 class="sechead" id="sec-${i}"><span>${esc(g.name)}</span><button type="button" class="btn sm" data-allok="${i}">${esc(T('new.all_ok'))}</button></h2>${g.items.map(x => itemHtml(x.c, x.n)).join('')}`).join('')}
      <h2 class="sechead" id="sec-others"><span>${esc(T('new.others'))}</span></h2>
      <p class="hint">${esc(T('new.others_help'))}</p>
      <div id="n-others">${dr.others.map(otherHtml).join('')}</div>
      <button type="button" class="btn addother" id="n-addother">+ ${esc(T('new.add_obs'))}</button>
      <h2 class="sechead" id="sec-result"><span>${esc(T('new.comment'))}</span></h2>
      <section class="panel" id="n-result"></section>
      <div class="submitbar"><div><span id="n-count"></span><small id="n-miss"></small><small id="n-saved"></small></div><button class="btn primary" id="n-go">${esc(T('new.finish'))}</button></div>
      <p class="discard"><button type="button" class="link" id="n-discard">${esc(T('new.discard'))}</button></p>`;
    list.forEach(c => thumbs(c.key));
    dr.others.forEach(o => thumbs('o_' + o.id));
    drawResult(); bar();
    $$('[data-jump]').forEach(b => b.onclick = () => {
      const el = document.getElementById(b.dataset.jump === 'others' ? 'sec-others' : b.dataset.jump === 'result' ? 'sec-result' : 'sec-' + b.dataset.jump);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $$('[data-allok]').forEach(b => b.onclick = () => {
      secs[Number(b.dataset.allok)].items.forEach(x => { const it = slot(x.c.key); if (!it.sev) { it.sev = 'ok'; const r = $(`input[name="sev-${x.c.key}"][value="ok"]`); if (r) r.checked = true; } });
      bar(); drawResult(); save();
    });
    $('#n-addother').onclick = () => {
      const o = { id: uuid().slice(0, 8), sev: 'minor', note: '', files: [] };
      dr.others.push(o);
      $('#n-others').insertAdjacentHTML('beforeend', otherHtml(o, dr.others.length - 1));
      thumbs('o_' + o.id); bar(); save();
      const el = $(`[data-note="o_${o.id}"]`); if (el) el.focus();
    };
    $('#n-discard').onclick = async () => {
      if (!confirm(T('new.discard_ask'))) return;
      await draftDel(key); S.draft = null; location.hash = '#/'; route();
    };
    $('#n-go').onclick = finish;
  }

  const thumbs = k => {
    const box = $(`[data-th="${k}"]`); if (!box) return;
    const it = slot(k); if (!it) return;
    box.innerHTML = it.files.map(f => `<div class="th">${f.kind === 'video' ? `<video src="${esc(f.url)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(f.url)}" alt="">`}<button type="button" data-rm="${esc(f.id)}" aria-label="${esc(T('common.remove'))}">×</button></div>`).join('');
    $$('[data-rm]', box).forEach(b => b.onclick = () => { const i = it.files.findIndex(x => x.id === b.dataset.rm); if (i >= 0) { URL.revokeObjectURL(it.files[i].url); it.files.splice(i, 1); } thumbs(k); bar(); save(); });
  };
  const critical = () => listFor().some(c => slot(c.key).sev === 'critical') || dr.others.some(o => o.note.trim() && o.sev === 'critical');
  const missing = () => {
    const m = [], list = listFor();
    if (!dr.d.brand.trim()) m.push(T('new.need_brand'));
    const un = list.filter(c => !slot(c.key).sev).length;
    if (un) m.push(T('new.need_rating', { n: un }));
    if (dr.others.some(o => o.files.length && !o.note.trim())) m.push(T('new.need_obs_note'));
    return m;
  };
  const bar = () => {
    const list = listFor(); if (!$('#n-count')) return;
    const rated = list.filter(c => slot(c.key).sev).length;
    $('#n-count').textContent = T('new.rated', { a: rated, b: list.length });
    $$('[data-secprog]').forEach(el => {
      const i = Number(el.dataset.secprog);
      const items = []; let idx = -1, last = null;
      list.forEach(c => { const nm = lbl(c, 'section'); if (nm !== last) { idx++; last = nm; } if (idx === i) items.push(c); });
      const n = items.filter(c => slot(c.key).sev).length;
      el.textContent = `${n}/${items.length}`; el.parentElement.classList.toggle('done', n === items.length);
    });
    const m = missing();
    $('#n-miss').textContent = m[0] || ''; $('#n-miss').hidden = !m.length;
    $('#n-go').disabled = m.length > 0;
  };
  function drawResult() {
    if (!$('#n-result')) return;
    const expired = dr.d.cert && dr.d.cert < todayISO();
    $('#n-result').innerHTML = `
      ${critical() ? `<div class="alert bad">${esc(T('new.critical_note'))}</div>` : ''}
      ${expired ? `<div class="alert warn">${esc(T('new.cert_expired'))}</div>` : ''}
      <p class="hint">${esc(T('new.decision_note'))}</p>
      <label class="field"><span>${esc(T('new.comment'))}</span><textarea id="n-comment" rows="3" maxlength="2000">${esc(dr.comment)}</textarea></label>`;
  }

  async function finish() {
    const btn = $('#n-go'); btn.disabled = true;
    const list = listFor();
    const keep = [...list.map(c => ({ k: c.key })), ...dr.others.filter(o => o.note.trim()).map(o => ({ k: 'o_' + o.id }))];
    const jobs = [];
    keep.forEach(({ k }) => slot(k).files.forEach(f => jobs.push({ f, path: `${dr.id}/${k}-${f.id}.${extFor(f)}` })));
    let done = jobs.filter(j => dr.uploaded[j.f.id]).length;
    const prog = () => { btn.textContent = T('new.uploading', { a: done, b: jobs.length }); };
    prog();
    try {
      await pool(jobs.filter(j => !dr.uploaded[j.f.id]), 3, async j => {
        const { blob, type } = await prepareUpload(j.f); await uploadFile(j.path, blob, type);
        dr.uploaded[j.f.id] = j.path; done++; prog(); await draftPut(key, snapshot());
      });
      const paths = k => slot(k).files.map(f => dr.uploaded[f.id]);
      const payload = { id: dr.id, type: dr.type, brand: dr.d.brand.trim(), model: dr.d.model.trim(), capacity: dr.d.capacity.trim(), location: dr.d.location.trim(), inspected_on: dr.d.date || todayISO(), cert_expiry: dr.d.cert || null,
        inspector: dr.d.inspector.trim(), comment: dr.comment.trim(),
        items: list.map(c => { const it = slot(c.key); return { key: c.key, sev: it.sev, note: it.note.trim(), reading: (it.reading || '').trim(), files: paths(c.key) }; }),
        others: dr.others.filter(o => o.note.trim()).map(o => ({ sev: o.sev, note: o.note.trim(), files: paths('o_' + o.id) })) };
      await q(sb.rpc('save_inspection', { p_data: payload }));
      await draftDel(key); S.draft = null; toast(T('new.saved'));
      location.hash = '#/inspection/' + dr.id;
    } catch (e) { fail(e); btn.textContent = T('new.finish'); bar(); }
  }

  if (!paint(tok, T('nav.new'), '<div id="n-form"></div>')) return;
  drawForm();
  const form = $('#n-form');
  form.addEventListener('input', e => {
    const t = e.target;
    if (t.id && t.id.startsWith('d-')) { dr.d[{ 'd-brand': 'brand', 'd-model': 'model', 'd-capacity': 'capacity', 'd-location': 'location', 'd-date': 'date', 'd-cert': 'cert', 'd-inspector': 'inspector' }[t.id]] = t.value; if (t.id === 'd-cert') drawResult(); bar(); saveSoon(); }
    else if (t.dataset.note) { slot(t.dataset.note).note = t.value; bar(); saveSoon(); }
    else if (t.dataset.reading) { slot(t.dataset.reading).reading = t.value; saveSoon(); }
    else if (t.id === 'n-comment') { dr.comment = t.value; saveSoon(); }
  });
  form.addEventListener('change', async e => {
    const t = e.target;
    if (t.name === 'n-type') { dr.type = t.value; drawForm(); save(); }
    else if (t.dataset.sevr) { slot(t.dataset.sevr).sev = t.value; drawResultIfNeeded(); bar(); save(); }
    else if (t.dataset.pick) {
      const k = t.dataset.pick, it = slot(k), picked = [...t.files]; t.value = '';
      for (const f of picked) {
        const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'photo' : null;
        if (!kind) { toast(T('err.not_media'), 1); continue; }
        if (kind === 'video' && f.size > 40 * 1024 * 1024) { toast(T('err.video_big'), 1); continue; }
        if (it.files.length >= 8) { toast(T('err.too_many'), 1); break; }
        try { const r = await readyFile(f, kind); it.files.push(withUrl({ id: uid8(), kind, type: r.type, blob: r.blob })); }
        catch (er) { toast(T('err.photo_read'), 1); }
      }
      thumbs(k); bar(); save();
    }
  });
  form.addEventListener('click', e => {
    const pm = e.target.closest('[data-pickmenu]');
    $$('.pickmenu').forEach(m => { if (!pm || m !== pm.nextElementSibling) m.hidden = true; });
    if (pm) { pm.nextElementSibling.hidden = !pm.nextElementSibling.hidden; return; }
    if (e.target.closest('.pickmenu')) setTimeout(() => $$('.pickmenu').forEach(m => m.hidden = true), 300);
    const b = e.target.closest('[data-rmother]'); if (!b) return;
    const o = dr.others.find(x => x.id === b.dataset.rmother); if (o) o.files.forEach(f => URL.revokeObjectURL(f.url));
    dr.others = dr.others.filter(x => x.id !== b.dataset.rmother);
    b.closest('.item').remove(); $$('#n-others .item.other h3').forEach((h, i) => { h.lastChild.textContent = T('new.obs', { n: i + 1 }); });
    drawResultIfNeeded(); bar(); save();
  });
  function drawResultIfNeeded() { drawResult(); }
  if (dr.restored) { dr.restored = false; save(); }
};

/* ---------- the Word report ---------- */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function reportPhoto(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const out = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('photo'))), 'image/jpeg', 0.72));
  return { data: new Uint8Array(await out.arrayBuffer()), w, h };
}
async function buildReport(ins, urls, rl, onProgress) {
  const cacheKey = ins.id + ':' + rl;
  if (S.reports[cacheKey]) return S.reports[cacheKey];
  const paths = [...new Set([...(ins.items || []).flatMap(i => i.files || []), ...(ins.others || []).flatMap(o => o.files || [])].filter(p => !isVideo(p) && urls[p]))];
  const photos = {}; let n = 0;
  await pool(paths, 4, async p => { try { photos[p] = await reportPhoto(urls[p]); } catch (e) { /* the report notes the missing photo */ } n++; if (onProgress) onProgress(n, paths.length); });
  const doc = HSEReport.makeDoc(ins, { lang: rl, photos });
  const blob = await docx.Packer.toBlob(doc);
  const safe = String(machineName(ins)).replace(/[^\w\-]+/g, '_').slice(0, 40);
  const res = { blob, name: `Inspection-${safe}-${ins.inspected_on}.docx` };
  S.reports[cacheKey] = res;
  return res;
}
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- one inspection ---------- */
VIEWS.inspection = async (id, tok) => {
  const ins = await q(sb.from('inspections').select('*').eq('id', id).single());
  const items = ins.items || [], others = ins.others || [];
  const urls = await signed([...items.flatMap(i => i.files || []), ...others.flatMap(o => o.files || [])]);
  const c = countSev(ins);
  const certDays = ins.cert_expiry ? Math.round((new Date(ins.cert_expiry + 'T00:00:00') - new Date(ins.inspected_on + 'T00:00:00')) / 86400000) : null;
  const certTxt = ins.cert_expiry ? `${fmtDate(ins.cert_expiry)}${certDays < 0 ? ` <b class="bad">${esc(T('cert.expired', { n: -certDays }))}</b>` : ` <span class="muted">${esc(T('cert.left', { n: certDays }))}</span>`}` : `<span class="muted">${esc(T('cert.none'))}</span>`;
  const facts = [[T('new.type'), T('type.' + ins.equipment_type)], [T('new.brand'), ins.brand], [T('new.model'), ins.model], [T('new.capacity'), ins.capacity], [T('new.location'), ins.location], [T('new.date'), fmtDate(ins.inspected_on)], [T('new.inspector'), ins.inspector_name], [T('new.cert'), null]];
  const factsHtml = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v === null ? certTxt : esc(v || '—')}</dd></div>`).join('');
  let last = null;
  const itemsHtml = items.map((i, n) => {
    const sn = lbl(i, 'section'); const head = sn && sn !== last ? (last = sn, `<h4 class="sechead">${esc(sn)}</h4>`) : '';
    const rl = lbl(i, 'reading_label');
    return `${head}<article class="item"><header><h3><span class="num">${n + 1}</span>${esc(lbl(i, 'label'))}</h3>${sevChip(i.sev)}</header>
      ${i.note ? `<p class="pre">${esc(i.note)}</p>` : ''}${i.reading ? `<p class="muted">${esc(rl || T('new.reading'))}: <b>${esc(i.reading)}</b> ${esc(i.reading_unit || '')}</p>` : ''}
      ${(i.files || []).length ? `<div class="thumbs">${media(i.files, urls)}</div>` : ''}</article>`;
  }).join('');
  const othersHtml = others.length ? `<h4 class="sechead">${esc(T('new.others'))}</h4>${others.map((o, n) => `<article class="item other"><header><h3><span class="num">+</span>${esc(T('new.obs', { n: n + 1 }))}</h3>${sevChip(o.sev)}</header><p class="pre">${esc(o.note)}</p>${(o.files || []).length ? `<div class="thumbs">${media(o.files, urls)}</div>` : ''}</article>`).join('')}` : '';
  if (!paint(tok, `${machineName(ins)} — ${T('type.' + ins.equipment_type)}`, `
    <section class="panel head s-${worstSev(ins)}"><dl class="facts">${factsHtml}</dl>
      <div class="sevcounts">${SEVS.map(s => `<span class="sevchip sev-${s}"><b>${c[s]}</b> ${esc(T('sev.' + s))}</span>`).join('')}</div></section>
    <section class="panel reportbox" id="rbox"><h3>${esc(T('rep.title'))}</h3>
      <p class="muted" id="rstatus">${esc(T('rep.preparing'))}</p>
      <div class="actionrow"><button class="btn primary" id="r-dl" disabled>${esc(T('rep.download'))}</button> <button class="btn" id="r-share" disabled>${esc(T('rep.share'))}</button></div></section>
    ${ins.comment ? `<section class="panel"><h3>${esc(T('new.comment'))}</h3><p class="pre">${esc(ins.comment)}</p></section>` : ''}
    <section class="panel"><h3>${esc(T('rep.checklist'))}</h3><div class="items">${itemsHtml}${othersHtml}</div></section>
    <p class="discard"><button type="button" class="link bad" id="r-del">${esc(T('rep.delete'))}</button></p>`)) return;
  $('#actions').innerHTML = `<a class="btn" href="#/">${esc(T('rep.back'))}</a>`;

  let current = null, seq = 0;
  const status = $('#rstatus'), dl = $('#r-dl'), sh = $('#r-share');
  const make = async () => {
    const my = ++seq, rl = 'en';
    dl.disabled = sh.disabled = true; current = null;
    status.textContent = T('rep.preparing'); status.className = 'muted';
    try {
      const r = await buildReport(ins, urls, rl, (a, b) => { if (my === seq) status.textContent = T('rep.photos', { a, b }); });
      if (my !== seq) return;
      current = r; status.textContent = T('rep.ready', { name: r.name, kb: Math.round(r.blob.size / 1024) }); dl.disabled = sh.disabled = false;
    } catch (e) { if (my === seq) { status.textContent = T('rep.failed') + ' ' + (e.message || ''); status.className = 'bad'; } }
  };
  dl.onclick = () => current && downloadBlob(current.blob, current.name);
  sh.onclick = async () => {
    if (!current) return;
    const file = new File([current.blob], current.name, { type: DOCX_MIME });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: `${T('rep.title')} ${machineName(ins)}`, text: `${T('rep.title')}: ${machineName(ins)}` });
      else { downloadBlob(current.blob, current.name); toast(T('rep.share_fallback')); }
    } catch (e) { if (e && e.name !== 'AbortError') fail(e); }
  };
  $('#r-del').onclick = async () => {
    if (!confirm(T('rep.delete_ask', { tag: machineName(ins) }))) return;
    try {
      const all = [...items.flatMap(i => i.files || []), ...others.flatMap(o => o.files || [])];
      await q(sb.rpc('delete_inspection', { p_id: ins.id }));
      if (all.length) await sb.storage.from(BUCKET).remove(all).catch(() => {});
      toast(T('rep.deleted')); location.hash = '#/';
    } catch (e) { fail(e); }
  };
  make();
};


/* ---------- admin: edit the checklist form ---------- */
VIEWS.admin = async (_, tok) => {
  const rows = await q(sb.from('checklist_items').select('*').order('sort'));
  const models = {}; let dirty = false;
  const build = type => {
    const secs = [];
    rows.filter(r => r.equipment_type === type).forEach(r => {
      let g = secs[secs.length - 1];
      if (!g || g.en !== (r.section_en || '')) { g = { en: r.section_en || '', zh: r.section_zh || '', items: [] }; secs.push(g); }
      g.items.push({ key: r.key, label_en: r.label_en, label_zh: r.label_zh, hint_en: r.hint_en || '', hint_zh: r.hint_zh || '', reading_label_en: r.reading_label_en || '', reading_label_zh: r.reading_label_zh || '', reading_unit: r.reading_unit || '', active: r.active });
    });
    return secs;
  };
  let type = S.adminType || 'crane';
  models[type] = build(type);
  const M = () => models[type];
  const inp = (cls, f, v, ph, extra = '') => `<input class="${cls}" data-f="${f}" value="${esc(v)}" placeholder="${esc(ph)}" maxlength="120" ${extra}>`;
  const draw = () => {
    const total = M().reduce((n, g) => n + g.items.length, 0);
    let num = 0;
    $('#a-body').innerHTML = `
      <div class="seg" role="tablist">${['crane', 'forklift'].map(t => `<label><input type="radio" name="a-type" value="${t}" ${type === t ? 'checked' : ''}><span>${esc(T('type.' + t))}</span></label>`).join('')}</div>
      <p class="hint">${esc(T('admin.help', { n: total }))}</p>
      ${M().map((g, si) => `<section class="asec" data-s="${si}">
        <header class="ahead">
          ${inp('a-secname', 'sec_en', g.en, T('admin.sec_en'), 'aria-label="' + esc(T('admin.sec_en')) + '"')}${inp('a-secname', 'sec_zh', g.zh, T('admin.sec_zh'))}
          <div class="amove"><button type="button" class="btn sm" data-act="sec-up" ${si === 0 ? 'disabled' : ''} aria-label="${esc(T('admin.up'))}">▲</button><button type="button" class="btn sm" data-act="sec-down" ${si === M().length - 1 ? 'disabled' : ''} aria-label="${esc(T('admin.down'))}">▼</button><button type="button" class="btn ghost sm bad" data-act="sec-del">${esc(T('common.remove'))}</button></div>
        </header>
        ${g.items.map((it, ii) => { num++; return `<div class="arow ${it.active ? '' : 'off'}" data-s="${si}" data-i="${ii}">
          <span class="num">${num}</span>
          <div class="afields">${inp('a-name', 'label_en', it.label_en, T('admin.name_en'))}${inp('a-name', 'label_zh', it.label_zh, T('admin.name_zh'))}
            <details><summary>${esc(T('admin.more'))}</summary>
              <div class="amore">${inp('a-hint', 'hint_en', it.hint_en, T('admin.hint_en'))}${inp('a-hint', 'hint_zh', it.hint_zh, T('admin.hint_zh'))}
              ${inp('a-hint', 'reading_label_en', it.reading_label_en, T('admin.read_en'))}${inp('a-hint', 'reading_label_zh', it.reading_label_zh, T('admin.read_zh'))}${inp('a-unit', 'reading_unit', it.reading_unit, T('admin.unit'))}</div></details></div>
          <div class="acon"><label class="chk"><input type="checkbox" data-f="active" ${it.active ? 'checked' : ''}><span>${esc(T('admin.show'))}</span></label>
            <div class="amove"><button type="button" class="btn sm" data-act="up" aria-label="${esc(T('admin.up'))}">▲</button><button type="button" class="btn sm" data-act="down" aria-label="${esc(T('admin.down'))}">▼</button><button type="button" class="btn ghost sm bad" data-act="del" aria-label="${esc(T('common.remove'))}">×</button></div></div>
        </div>`; }).join('')}
        <button type="button" class="btn sm addrow" data-act="add" data-s="${si}">+ ${esc(T('admin.add_item'))}</button>
      </section>`).join('')}
      <button type="button" class="btn" id="a-addsec">+ ${esc(T('admin.add_sec'))}</button>
      <div class="submitbar"><div><span>${esc(T('admin.note'))}</span><small id="a-state"></small></div><button class="btn primary" id="a-save">${esc(T('admin.save'))}</button></div>`;
    $('#a-state').textContent = dirty ? T('admin.unsaved') : '';
  };
  if (!paint(tok, T('nav.admin'), '<div id="a-body"></div>')) return;
  draw();
  const body = $('#a-body');
  const mark = () => { dirty = true; const el = $('#a-state'); if (el) el.textContent = T('admin.unsaved'); };
  body.addEventListener('input', e => {
    const t = e.target, f = t.dataset.f; if (!f) return;
    const sec = t.closest('[data-s]'); if (!sec) return;
    const g = M()[Number(sec.dataset.s)], row = t.closest('.arow');
    if (row) { const it = g.items[Number(row.dataset.i)]; it[f] = t.type === 'checkbox' ? t.checked : t.value; if (f === 'active') row.classList.toggle('off', !t.checked); }
    else g[f === 'sec_en' ? 'en' : 'zh'] = t.value;
    mark();
  });
  body.addEventListener('change', async e => {
    if (e.target.name === 'a-type') {
      if (dirty && !confirm(T('admin.discard_ask'))) { draw(); return; }
      type = e.target.value; S.adminType = type; models[type] = build(type); dirty = false; draw();
    }
  });
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, sec = b.closest('[data-s]'), si = sec ? Number(sec.dataset.s) : -1, row = b.closest('.arow'), ii = row ? Number(row.dataset.i) : -1, m = M();
    if (act === 'add') { m[si].items.push({ key: null, label_en: '', label_zh: '', hint_en: '', hint_zh: '', reading_label_en: '', reading_label_zh: '', reading_unit: '', active: true }); mark(); draw(); const els = $$(`.asec[data-s="${si}"] .arow .a-name[data-f="label_en"]`); if (els.length) els[els.length - 1].focus(); return; }
    if (act === 'del') { m[si].items.splice(ii, 1); }
    else if (act === 'up') { if (ii > 0) [m[si].items[ii - 1], m[si].items[ii]] = [m[si].items[ii], m[si].items[ii - 1]]; else if (si > 0) m[si - 1].items.push(m[si].items.splice(ii, 1)[0]); }
    else if (act === 'down') { const L = m[si].items.length; if (ii < L - 1) [m[si].items[ii + 1], m[si].items[ii]] = [m[si].items[ii], m[si].items[ii + 1]]; else if (si < m.length - 1) m[si + 1].items.unshift(m[si].items.splice(ii, 1)[0]); }
    else if (act === 'sec-up') { if (si > 0) [m[si - 1], m[si]] = [m[si], m[si - 1]]; }
    else if (act === 'sec-down') { if (si < m.length - 1) [m[si + 1], m[si]] = [m[si], m[si + 1]]; }
    else if (act === 'sec-del') { if (m[si].items.length && !confirm(T('admin.sec_del_ask', { n: m[si].items.length }))) return; m.splice(si, 1); }
    mark(); draw();
  });
  body.addEventListener('click', e => {
    if (e.target.id === 'a-addsec') { M().push({ en: '', zh: '', items: [{ key: null, label_en: '', label_zh: '', hint_en: '', hint_zh: '', reading_label_en: '', reading_label_zh: '', reading_unit: '', active: true }] }); mark(); draw(); const els = $$('.a-secname[data-f="sec_en"]'); if (els.length) els[els.length - 1].focus(); }
    if (e.target.id === 'a-save') saveAll();
  });
  async function saveAll() {
    const items = [];
    M().forEach(g => g.items.forEach(it => items.push({ ...it, section_en: g.en, section_zh: g.zh })));
    if (!items.length) return toast(T('admin.empty'), 1);
    if (items.some(i => !i.label_en.trim())) return toast(T('admin.need_name'), 1);
    const btn = $('#a-save'); btn.disabled = true;
    try {
      await q(sb.rpc('admin_save_checklist', { p_type: type, p_items: items }));
      S.checklist = null;
      const fresh = await q(sb.from('checklist_items').select('*').order('sort'));
      rows.length = 0; fresh.forEach(r => rows.push(r));
      models[type] = build(type); dirty = false; draw(); toast(T('admin.saved'));
    } catch (e) { fail(e); btn.disabled = false; }
  }
};

/* ---------- boot ---------- */
async function testSignIn(i) {
  const u = testUsers()[i]; if (!u) return false;
  const { error } = await sb.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) return error.message;
  try { localStorage.setItem('hse.testUser', String(i)); } catch (e) {}
  return true;
}
async function start() {
  if (!S.session && testUsers().length && !S.testFailed) {
    let i = 0; try { i = Number(localStorage.getItem('hse.testUser')) || 0; } catch (e) {}
    $('#root').innerHTML = '<div class="authwrap single"><section class="authcard"><p>…</p></section></div>';
    const r = await testSignIn(i < testUsers().length ? i : 0);
    if (r === true) return;               // onAuthStateChange will call start() again
    S.testFailed = true;
    renderAuth('signin', String(r));
    return;
  }
  if (!S.session) { renderAuth(); return; }
  try { S.profile = await q(sb.from('profiles').select('*').eq('id', S.session.user.id).single()); }
  catch (e) { $('#root').innerHTML = `<div class="authwrap single"><section class="authcard"><div class="alert bad">${esc(e.message || e)}</div><button class="btn" onclick="location.reload()">${esc(T('common.refresh'))}</button></section></div>`; return; }
  if (!canWork()) { renderPending(); return; }
  renderShell();
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
