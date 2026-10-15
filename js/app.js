// Görev · arayüz
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import * as S from './store.js';
import * as M from './model.js';
import { icon, HABIT_ICONS } from './icons.js';
import {
  esc, lower, uid, today, addDays, diffDays, isoDow, parseYmd, ymd, prettyDate, longToday, MONTHS, DAYS_SHORT,
  repeatLabel, occurrencesBetween, parseQuick, setDayStart, debounce,
} from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const sb = (window.supabase && SUPABASE_URL) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

const ui = {
  view: 'home', listId: null, tab: 'time', openTask: null,
  calMonth: today().slice(0, 7), calSel: today(), habitDay: today(),
  collapsed: new Set(['done']), authMode: 'login', authMsg: null, recovery: false, booted: false,
};
try { const saved = JSON.parse(localStorage.getItem('gorev:ui') || '{}'); Object.assign(ui, { view: saved.view || 'home', listId: saved.listId || null, tab: saved.tab || 'time' }); } catch (e) { /* yok */ }
const saveUi = () => { try { localStorage.setItem('gorev:ui', JSON.stringify({ view: ui.view, listId: ui.listId, tab: ui.tab })); } catch (e) { /* yok */ } };

const root = document.getElementById('root');

// ═════════════════════════════════════════════════════════
// Başlangıç ve giriş
// ═════════════════════════════════════════════════════════
async function boot() {
  if (!sb || new URLSearchParams(location.search).has('yerel')) { S.initLocal(); afterData(); return; }
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') { ui.recovery = true; renderAuth(); return; }
    if (ev === 'SIGNED_OUT') { S.clearSession(); renderAuth(); return; }
    if ((ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') && session && !S.state.user && !ui.recovery) startCloud(session.user);
    if (ev === 'INITIAL_SESSION' && !session) renderAuth();
  });
}
async function startCloud(user) {
  shell();
  await S.initCloud(sb, { id: user.id, email: user.email });
  afterData();
}
function afterData() {
  if (!$('.app')) shell();
  applySettings();
  M.autoPurge();
  ui.booted = true;
  renderAll();
}

function renderAuth() {
  const m = ui.authMode;
  const title = ui.recovery ? 'Yeni şifre' : m === 'signup' ? 'Hesap oluştur' : m === 'reset' ? 'Şifremi unuttum' : 'Giriş yap';
  root.innerHTML = `
  <div class="auth"><form class="card" id="authForm" novalidate>
    <h1>${title}</h1>
    <p>${ui.recovery ? 'Hesabın için yeni bir şifre belirle.' : 'Görevlerin ve alışkanlıkların her cihazda seninle.'}</p>
    ${ui.authMsg ? `<div class="msg ${ui.authMsg.ok ? 'ok' : ''}" role="status">${esc(ui.authMsg.text)}</div>` : ''}
    ${ui.recovery ? '' : `<label class="field-l"><span>E-posta</span><input class="input" type="email" name="email" autocomplete="email" required></label>`}
    ${m !== 'reset' || ui.recovery ? `<label class="field-l"><span>Şifre</span><input class="input" type="password" name="password" autocomplete="${m === 'login' && !ui.recovery ? 'current-password' : 'new-password'}" minlength="6" required></label>` : ''}
    <button class="btn-accent" style="width:100%" type="submit">${ui.recovery ? 'Şifreyi kaydet' : m === 'signup' ? 'Hesap oluştur' : m === 'reset' ? 'Bağlantı gönder' : 'Giriş yap'}</button>
    ${ui.recovery ? '' : `<div style="display:flex;justify-content:space-between;margin-top:14px;gap:10px;flex-wrap:wrap">
      ${m === 'login' ? `<button type="button" class="linkbtn" data-auth="signup">Hesap oluştur</button><button type="button" class="linkbtn" data-auth="reset">Şifremi unuttum</button>`
        : `<button type="button" class="linkbtn" data-auth="login">Girişe dön</button>`}
    </div>`}
  </form></div>`;
  root.querySelectorAll('[data-auth]').forEach(b => b.onclick = () => { ui.authMode = b.dataset.auth; ui.authMsg = null; renderAuth(); });
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = String(f.get('email') || '').trim(); const password = String(f.get('password') || '');
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    const redirect = location.origin + location.pathname;
    let res;
    try {
      if (ui.recovery) {
        res = await sb.auth.updateUser({ password });
        if (!res.error) { ui.recovery = false; ui.authMsg = null; const { data } = await sb.auth.getSession(); if (data.session) return startCloud(data.session.user); }
      } else if (m === 'signup') {
        res = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (!res.error && !res.data.session) { ui.authMsg = { ok: true, text: 'Hesap oluşturuldu. E-postana gelen bağlantıya tıklayıp onayla, sonra giriş yap.' }; ui.authMode = 'login'; return renderAuth(); }
      } else if (m === 'reset') {
        res = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
        if (!res.error) { ui.authMsg = { ok: true, text: 'Şifre yenileme bağlantısı e-postana gönderildi.' }; ui.authMode = 'login'; return renderAuth(); }
      } else {
        res = await sb.auth.signInWithPassword({ email, password });
      }
      if (res.error) { ui.authMsg = { text: trError(res.error.message) }; renderAuth(); }
    } catch (err) { ui.authMsg = { text: 'Bağlantı kurulamadı. İnternetini kontrol et.' }; renderAuth(); }
  };
}
function trError(m) {
  const s = String(m || '');
  if (/Invalid login/i.test(s)) return 'E-posta ya da şifre hatalı.';
  if (/not confirmed/i.test(s)) return 'E-postanı henüz onaylamadın. Gelen kutundaki bağlantıya tıkla.';
  if (/already registered|already been registered/i.test(s)) return 'Bu e-postayla zaten bir hesap var. Giriş yapmayı dene.';
  if (/at least 6|Password should/i.test(s)) return 'Şifre en az 6 karakter olmalı.';
  if (/valid email|invalid format/i.test(s)) return 'Geçerli bir e-posta adresi yaz.';
  if (/rate limit|too many/i.test(s)) return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
  return s;
}

// ═════════════════════════════════════════════════════════
// İskelet ve çizim
// ═════════════════════════════════════════════════════════
function shell() {
  root.innerHTML = `
  <div class="app">
    <aside class="sidebar" id="side" aria-label="Menü"></aside>
    <div class="main" id="main"></div>
    <section class="detail" id="detail" aria-label="Görev detayı"></section>
  </div>`;
}

function applySettings() {
  const s = M.settings();
  setDayStart(s.dayStart);
  const r = document.documentElement;
  if (s.theme === 'light' || s.theme === 'dark') r.dataset.theme = s.theme; else delete r.dataset.theme;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(r).getPropertyValue('--bg').trim() || '#EFECE7';
}

function renderAll() {
  if (!S.state.user || !$('.app')) return;
  const a = document.activeElement;
  const fk = a?.dataset?.fk; let ss = null, se = null;
  try { ss = a?.selectionStart; se = a?.selectionEnd; } catch (e) { /* yok */ }
  const sc1 = $('#main .scroll')?.scrollTop; const sc2 = $('#detail .dscroll')?.scrollTop;
  renderSide(); renderMain(); renderDetail();
  if (sc1 != null && $('#main .scroll')) $('#main .scroll').scrollTop = sc1;
  if (sc2 != null && $('#detail .dscroll')) $('#detail .dscroll').scrollTop = sc2;
  if (fk) { const el = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* yok */ } } }
  updateBadge();
}
const renderSoon = debounce(() => { renderSide(); renderMain(); updateBadge(); }, 120);

S.onChange((src) => {
  if (!ui.booted) return;
  if (src === 'local') return; // yerel değişiklikleri eylemler kendisi çiziyor
  if (src === 'sync' || src === 'flushed' || src === 'error' || src === 'net') { document.querySelectorAll('#syncState').forEach(el => { el.outerHTML = syncHtml(); }); return; }
  applySettings();
  // yazarken detayı bozma
  const a = document.activeElement;
  if (a && $('#detail')?.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { renderSide(); renderMain(); }
  else renderAll();
});

// ── Kenar çubuğu (masaüstü) ──────────────────────────────
function renderSide() {
  const side = $('#side'); if (!side) return;
  const c = M.dueCounts();
  const item = (v, ic, label, extra = '', count = '') =>
    `<button class="side-item ${ui.view === v && (v !== 'list') ? 'active' : ''}" data-act="nav" data-view="${v}">${icon(ic, 18)}<span>${label}</span>${count !== '' ? `<span class="count">${count}</span>` : ''}${extra}</button>`;
  side.innerHTML = `
    <div class="side-brand"><b>Görev</b><button class="icon-btn sm ghost" data-act="search" aria-label="Ara">${icon('search', 18)}</button></div>
    ${item('home', 'home', 'Görevler', '', c.overdue + c.today || '')}
    ${item('calendar', 'cal', 'Takvim')}
    ${item('habits', 'target', 'Alışkanlıklar')}
    ${item('log', 'log', 'Görev günlüğü')}
    <div class="side-head"><span>Listeler</span><button class="icon-btn sm ghost" style="width:28px;height:28px" data-act="newList" aria-label="Yeni liste">${icon('plus', 16)}</button></div>
    ${M.lists().map(l => `<button class="side-item ${ui.view === 'list' && ui.listId === l.id ? 'active' : ''}" data-act="openList" data-id="${l.id}">
      <span class="dot" style="background:${esc(l.color)}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.name) || 'Adsız liste'}</span>
      ${l.hidden_home ? `<span style="margin-left:auto;color:var(--faint)" title="Ana ekranda gizli">${icon('eyeoff', 15)}</span>` : `<span class="count">${listCount(l.id) || ''}</span>`}
    </button>`).join('')}
    <div class="side-sep"></div>
    ${item('trash', 'trash', 'Çöp kutusu')}
    ${item('settings', 'gear', 'Ayarlar')}
    <div style="margin-top:auto">${syncHtml()}</div>`;
}
const listCount = (id) => M.liveTasks().filter(t => !t.parent_id && !t.done && t.list_id === id).length;
function syncHtml() {
  const st = S.state; const p = S.pendingCount();
  if (st.mode === 'local') return `<div class="sync" id="syncState"><i class="busy"></i>Sadece bu cihaz</div>`;
  const cls = !st.online ? 'off' : (st.syncing || p) ? 'busy' : '';
  const txt = !st.online ? `Çevrimdışı${p ? ` · ${p} değişiklik bekliyor` : ''}` : (st.syncing || p) ? 'Eşitleniyor…' : 'Eşitlendi';
  return `<div class="sync" id="syncState"><i class="${cls}"></i>${txt}</div>`;
}

// ── Ana bölüm ────────────────────────────────────────────
function renderMain() {
  const main = $('#main'); if (!main) return;
  let body = '';
  switch (ui.view) {
    case 'list': body = viewTasks(M.listById(ui.listId)); break;
    case 'calendar': body = viewCalendar(); break;
    case 'habits': body = viewHabits(); break;
    case 'log': body = viewLog(); break;
    case 'trash': body = viewTrash(); break;
    case 'settings': body = viewSettings(); break;
    case 'lists': body = viewLists(); break;
    default: ui.view = 'home'; body = viewTasks(null);
  }
  const showQuick = ['home', 'list', 'calendar'].includes(ui.view);
  const nav = (v, ic, label, active) => `<button class="${active ? 'active' : ''}" data-act="nav" data-view="${v}">${icon(ic, 22)}${label}</button>`;
  const inMenu = ['lists', 'log', 'trash', 'settings', 'list'].includes(ui.view);
  main.innerHTML = `${body}
    ${showQuick ? quickAddHtml() : ''}
    <nav class="bottomnav" aria-label="Ana menü">
      ${nav('home', 'home', 'Görevler', ui.view === 'home')}
      ${nav('calendar', 'cal', 'Takvim', ui.view === 'calendar')}
      ${nav('habits', 'target', 'Alışkanlık', ui.view === 'habits')}
      ${nav('lists', 'menu', 'Listeler', inMenu)}
    </nav>`;
}

function topbar(eyebrow, title, actions = '') {
  return `<header class="topbar"><div style="min-width:0"><div class="eyebrow">${eyebrow}</div><h1 class="title">${title}</h1></div><div class="row-actions">${actions}</div></header>`;
}
const searchBtn = () => `<button class="icon-btn" data-act="search" aria-label="Ara">${icon('search')}</button>`;

// ── Görev görünümleri ────────────────────────────────────
function viewTasks(list) {
  const s = M.settings();
  if (ui.view === 'list' && !list) { ui.view = 'home'; return viewTasks(null); }
  const tasks = M.visibleForGroups({ listId: list?.id || null });
  const c = M.dueCounts();
  const title = list ? `<span class="dot" style="width:14px;height:14px;background:${esc(list.color)}"></span>${esc(list.name) || 'Adsız liste'}` : 'Görevler';
  const eyebrow = list ? `${tasks.filter(t => !t.done && !t.parent_id).length} açık görev${list.hidden_home ? ' · ana ekranda gizli' : ''}` : longToday();
  const actions = list ? `${searchBtn()}<button class="icon-btn" data-act="editList" data-id="${list.id}" aria-label="Listeyi düzenle">${icon('more')}</button>` : searchBtn();
  let out = topbar(eyebrow, title, actions);
  out += `<div class="scroll"><div class="main-inner">`;
  if (!list && s.showHabitsHome && M.habits().length) out += habitStrip();
  out += `<div class="tabs" role="tablist">
    ${[['time', 'Zaman'], ['lists', list ? 'Etiketler' : 'Listeler'], ['prio', 'Öncelik']].map(([k, l]) => `<button class="tab ${ui.tab === k ? 'active' : ''}" role="tab" aria-selected="${ui.tab === k}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}
  </div>`;
  if (!tasks.length) {
    out += `<div class="card flat empty"><b>Burada henüz görev yok</b>Alttaki kutuya yazıp ekleyebilirsin. Örn: <i>yarın 10:00 kasa kontrolü</i></div>`;
  } else if (ui.tab === 'lists') {
    const open = tasks.filter(t => !t.done);
    if (list) {
      const tags = [...new Set(open.flatMap(t => t.tags || []))].sort();
      tags.forEach(tg => { out += section('tag:' + tg, '#' + esc(tg), open.filter(t => (t.tags || []).includes(tg))); });
      out += section('notag', 'Etiketsiz', open.filter(t => !(t.tags || []).length));
    } else {
      M.lists().filter(l => !l.hidden_home).forEach(l => {
        out += section('l:' + l.id, `<span class="dot" style="background:${esc(l.color)}"></span>${esc(l.name)}`, open.filter(t => M.rootOf(t).list_id === l.id));
      });
      out += section('nolist', 'Listesiz', open.filter(t => !M.rootOf(t).list_id));
    }
  } else if (ui.tab === 'prio') {
    const open = tasks.filter(t => !t.done);
    [[3, 'Yüksek'], [2, 'Orta'], [1, 'Düşük'], [0, 'Önceliksiz']].forEach(([p, l]) => { out += section('p' + p, l, open.filter(t => (t.priority || 0) === p)); });
  } else {
    const g = M.timeGroups(tasks);
    if (g.overdue.length) out += section('overdue', `${icon('alert', 15, 2.2)} Gecikmiş`, g.overdue, { warn: true });
    out += section('today', 'Bugün', g.today, { always: true, count: `${g.done.filter(t => t.done_at.slice(0, 10) === today()).length} / ${g.today.length + g.done.filter(t => t.done_at.slice(0, 10) === today()).length}` });
    out += section('tomorrow', 'Yarın', g.tomorrow);
    out += section('week', 'Bu hafta', g.week);
    out += section('later', 'Daha sonra', g.later);
    if (s.showCompleted && g.done.length) out += section('done', 'Tamamlandı', g.done, { collapsible: true });
  }
  out += `</div></div>`;
  return out;
}

function section(key, label, items, opt = {}) {
  if (!items.length && !opt.always) return '';
  const col = ui.collapsed.has(key);
  const head = `<div class="section-head"><h2 style="${opt.warn ? 'color:var(--accent-text)' : ''}">${label}</h2>
    ${opt.collapsible ? `<button data-act="collapseSec" data-key="${key}" aria-expanded="${!col}">${col ? `Göster (${items.length})` : 'Gizle'}</button>` : `<span class="n">${opt.count ?? items.length}</span>`}</div>`;
  if (col) return `<div class="section">${head}</div>`;
  const body = items.length ? `<div class="card">${items.map(taskRow).join('')}</div>`
    : `<div class="card flat empty" style="padding:16px">Bugün için görev yok.</div>`;
  return `<div class="section">${head}${body}</div>`;
}

const PRIO_COLOR = { 3: 'var(--accent-strong)', 2: '#C99A2E', 1: '#5B7FD1' };
function taskRow(t) {
  const list = M.taskList(t);
  const pr = M.progress(t.id);
  const anc = M.ancestors(t);
  const late = t.due_date && t.due_date < today() && !t.done;
  const meta = [];
  if (anc.length) meta.push(`<span>${icon('sub', 12)} ${esc(anc.map(a => a.title || 'Adsız').join(' › '))}</span>`);
  if (t.due_date && !(ui.view === 'home' && ui.tab === 'time' && t.due_date === today() && !t.due_time)) meta.push(`<span class="${late ? 'late' : ''}">${esc(prettyDate(t.due_date))}${t.due_time ? ' · ' + esc(t.due_time) : ''}</span>`);
  else if (t.due_time) meta.push(`<span>${esc(t.due_time)}</span>`);
  if (t.notes) meta.push(icon('note', 12));
  (t.tags || []).forEach(tg => meta.push(`<span>#${esc(tg)}</span>`));
  const listChip = list && ui.view !== 'list' ? `<span class="chip">${esc(list.name)}</span>` : '';
  const ccolor = list?.color || 'var(--check)';
  return `<div class="trow ${t.done ? 'done' : ''} ${ui.openTask === t.id ? 'selected' : ''}" data-act="open" data-id="${t.id}">
    ${t.priority ? `<span class="prio" style="background:${PRIO_COLOR[t.priority]}"></span>` : ''}
    <button class="check ${t.done ? 'on' : ''}" style="${t.done ? '' : `border-color:${ccolor}`}" data-act="toggle" data-id="${t.id}" aria-label="${t.done ? 'Tamamlanmadı yap' : 'Tamamla'}: ${esc(t.title)}">${t.done ? icon('check', 14, 3) : ''}</button>
    <div class="tbody"><span class="ttitle">${esc(t.title) || '<span style="color:var(--faint)">Adsız görev</span>'}</span>${meta.length ? `<span class="tmeta">${meta.join('')}</span>` : ''}</div>
    <div class="tright">
      ${pr.total ? `<span class="mini">${pr.done}/${pr.total}</span>` : ''}
      ${t.repeat?.type ? `<span style="color:var(--muted)" title="${esc(repeatLabel(t.repeat))}">${icon('repeat', 15, 2)}</span>` : ''}
      ${listChip}
    </div>
  </div>`;
}

// ── Hızlı ekleme ─────────────────────────────────────────
function quickAddHtml() {
  const ph = ui.view === 'calendar' ? `${prettyDate(ui.calSel)} için görev ekle` : 'Görev ekle… örn. yarın 10:00 kasa kontrolü #İş';
  return `<form class="quickadd" id="quickForm" autocomplete="off">
    <div class="preview" id="qPreview" aria-live="polite"></div>
    <label class="field"><span class="sr">Yeni görev</span><input id="quickInput" data-fk="quick" placeholder="${esc(ph)}" enterkeyhint="done"></label>
    <button class="btn-accent" type="submit" aria-label="Ekle">${icon('plus', 22, 2.2)}</button>
  </form>`;
}
function quickPreview() {
  const v = $('#quickInput')?.value || ''; const el = $('#qPreview'); if (!el) return;
  if (!v.trim()) { el.innerHTML = ''; return; }
  const p = parseQuick(v, M.lists());
  const chips = [];
  if (p.due_date) chips.push(`${icon('cal', 13)} ${esc(prettyDate(p.due_date))}`);
  if (p.due_time) chips.push(esc(p.due_time));
  if (p.list_id) chips.push(`<span class="dot" style="background:${esc(M.listById(p.list_id).color)}"></span>${esc(M.listById(p.list_id).name)}`);
  p.tags.forEach(t => chips.push('#' + esc(t)));
  if (p.priority) chips.push(['', 'Düşük', 'Orta', 'Yüksek'][p.priority] + ' öncelik');
  if (p.repeat) chips.push(`${icon('repeat', 13)} ${esc(repeatLabel(p.repeat))}`);
  el.innerHTML = chips.map(c => `<span class="chip out">${c}</span>`).join('');
}
function quickSubmit() {
  const inp = $('#quickInput'); const v = inp.value.trim(); if (!v) return;
  const p = parseQuick(v, M.lists());
  const fields = { title: p.title || v, due_date: p.due_date, due_time: p.due_time, tags: p.tags, priority: p.priority, repeat: p.repeat };
  if (ui.view === 'list') fields.list_id = p.list_id || ui.listId;
  else fields.list_id = p.list_id || null;
  if (ui.view === 'calendar' && !fields.due_date) fields.due_date = ui.calSel;
  const t = M.createTask(fields);
  inp.value = ''; $('#qPreview').innerHTML = '';
  renderSide(); renderMain(); $('#quickInput')?.focus();
  toast(`“${t.title}” eklendi`, null, () => openTask(t.id), 'Aç');
}

// ── Alışkanlık şeridi ────────────────────────────────────
function ringSvg(count, per, size = 32, sw = 3) {
  const r = (size - sw) / 2; const c = 2 * Math.PI * r; const f = Math.min(1, count / Math.max(1, per));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/></svg>`;
}
function habitStrip() {
  const t = today();
  const hs = M.habits().filter(h => M.scheduledOn(h, t));
  if (!hs.length) return '';
  return `<section class="habit-strip" aria-label="Bugünkü alışkanlıklar">${hs.map(h => {
    const n = M.habitCount(h, t); const per = h.per_day || 1;
    return `<button class="habit-pill ${n >= per ? 'done' : ''}" data-act="habitTap" data-id="${h.id}" data-day="${t}" aria-label="${esc(h.name)}: ${n}/${per}">
      <span class="ring">${ringSvg(n, per)}<span>${n >= per ? `<span style="color:var(--accent-text)">${icon('check', 14, 3)}</span>` : `${n}/${per}`}</span></span>${esc(h.name)}</button>`;
  }).join('')}<button class="habit-pill" data-act="nav" data-view="habits" style="padding-right:14px;color:var(--muted)">${icon('target', 18)}Tümü</button></section>`;
}

// ── Takvim ───────────────────────────────────────────────
function viewCalendar() {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = ymd(new Date(y, m - 1, 1)); const last = ymd(new Date(y, m, 0));
  const start = addDays(first, 1 - isoDow(first));
  const t = today();
  const live = M.liveTasks();
  const actual = new Map(); const rep = new Map();
  live.forEach(x => {
    if (x.done || !x.due_date) return;
    if (x.due_date >= start && x.due_date <= addDays(last, 7)) actual.set(x.due_date, (actual.get(x.due_date) || 0) + 1);
    if (x.repeat?.type) occurrencesBetween(x, start, addDays(last, 7)).slice(1).forEach(d => rep.set(d, (rep.get(d) || 0) + 1));
  });
  let cells = DAYS_SHORT.map(d => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d > last) break;
    const inMonth = d.slice(0, 7) === ui.calMonth;
    const dotCls = actual.get(d) ? '' : rep.get(d) ? 'rep' : 'none';
    cells += `<button class="${d < t ? 'past' : ''} ${d === t ? 'today' : ''} ${d === ui.calSel ? 'sel' : ''}" style="${inMonth ? '' : 'opacity:.35'}" data-act="calPick" data-day="${d}" aria-label="${esc(prettyDate(d, true))}${actual.get(d) ? `, ${actual.get(d)} görev` : ''}">${parseYmd(d).getDate()}<i class="${dotCls}"></i></button>`;
  }
  const sel = ui.calSel;
  const dayTasks = live.filter(x => !x.done && x.due_date === sel);
  const repTasks = live.filter(x => !x.done && x.repeat?.type && x.due_date && x.due_date < sel && occurrencesBetween(x, sel, sel).includes(sel));
  const doneThatDay = S.all('task_log').filter(l => l.done_at.slice(0, 10) === sel);
  const hs = M.habits().filter(h => M.scheduledOn(h, sel));
  let out = topbar(`${MONTHS[m - 1]} ${y}`, 'Takvim', `<button class="icon-btn" data-act="calNav" data-d="-1" aria-label="Önceki ay">${icon('back')}</button><button class="icon-btn" data-act="calNav" data-d="0" aria-label="Bugüne dön" style="width:auto;padding:0 12px;font-weight:600;font-size:14px">Bugün</button><button class="icon-btn" data-act="calNav" data-d="1" aria-label="Sonraki ay">${icon('fwd')}</button>`);
  out += `<div class="scroll"><div class="main-inner">
    <div class="card cal"><div class="cal-grid">${cells}</div></div>
    <div class="section" style="margin-top:18px"><div class="section-head"><h2>${esc(prettyDate(sel, true))}</h2><span class="n">${dayTasks.length + repTasks.length}</span></div>
      ${dayTasks.length || repTasks.length ? `<div class="card">${dayTasks.map(taskRow).join('')}${repTasks.map(x => taskRow(x).replace('class="tbody">', 'class="tbody"><span class="tmeta" style="order:2">' + icon('repeat', 12) + ' tekrar eden</span>')).join('')}</div>` : `<div class="card flat empty" style="padding:16px">Bu gün için görev yok.</div>`}
    </div>
    ${hs.length ? `<div class="section"><div class="section-head"><h2>Alışkanlıklar</h2><span class="n">${hs.filter(h => M.habitDone(h, sel)).length}/${hs.length}</span></div>
      <div class="chips">${hs.map(h => `<span class="chip lg ${M.habitDone(h, sel) ? 'warn' : 'out'}">${icon(h.icon, 14)} ${esc(h.name)}</span>`).join('')}</div></div>` : ''}
    ${doneThatDay.length ? `<div class="section"><div class="section-head"><h2>Tamamlananlar</h2><span class="n">${doneThatDay.length}</span></div>
      <div class="card flat">${doneThatDay.map(l => `<div class="trow done" style="cursor:default"><span class="check on sm">${icon('check', 12, 3)}</span><div class="tbody"><span class="ttitle">${esc(l.title)}</span>${l.path ? `<span class="tmeta">${esc(l.path)}</span>` : ''}</div></div>`).join('')}</div></div>` : ''}
  </div></div>`;
  return out;
}

// ── Alışkanlıklar ────────────────────────────────────────
function viewHabits() {
  const t = today(); const mon = addDays(t, 1 - isoDow(t)); const day = ui.habitDay;
  const wr = M.weekRate();
  const hs = M.habits();
  let out = topbar(wr == null ? 'Bu hafta' : `Bu hafta · %${wr} başarı`, 'Alışkanlıklar',
    `<button class="icon-btn" data-act="habitOrder" aria-label="Sırala">${icon('list')}</button><button class="btn-accent sm" style="width:44px;height:44px;border-radius:14px;padding:0" data-act="newHabit" aria-label="Yeni alışkanlık">${icon('plus', 20, 2.2)}</button>`);
  out += `<div class="scroll"><div class="main-inner"><div class="week">${[0, 1, 2, 3, 4, 5, 6].map(i => {
    const d = addDays(mon, i);
    return `<button class="${d === day ? 'sel' : ''} ${d > t ? 'future' : ''}" ${d > t ? 'disabled' : ''} data-act="habitDay" data-day="${d}" aria-label="${esc(prettyDate(d, true))}"><span>${DAYS_SHORT[i]}</span><b>${parseYmd(d).getDate()}</b></button>`;
  }).join('')}</div>`;
  if (!hs.length) {
    out += `<div class="card flat empty"><b>Henüz alışkanlık yok</b>Sağ üstteki + ile ya da aşağıdaki şablonlardan ekleyebilirsin.</div>`;
  }
  const sched = hs.filter(h => M.scheduledOn(h, day)); const other = hs.filter(h => !M.scheduledOn(h, day));
  sched.forEach(h => { out += habitCard(h, day); });
  if (other.length) out += `<div class="section"><div class="section-head"><h2>Bu gün planlı değil</h2></div>${other.map(h => habitCard(h, day, true)).join('')}</div>`;
  out += `<div class="section" style="margin-top:6px"><div class="section-head"><h2>Şablondan ekle</h2></div><div class="chips">
    ${TEMPLATES[0].items.slice(0, 6).map(x => `<button class="chip lg out" data-act="tplPick" data-name="${esc(x[0])}">${icon(x[1], 14)} ${esc(x[0])}</button>`).join('')}
    <button class="chip lg" data-act="newHabit">Tüm şablonlar…</button></div></div>`;
  out += `</div></div>`;
  return out;
}
function habitCard(h, day, faded = false) {
  const n = M.habitCount(h, day); const per = h.per_day || 1; const st = M.streak(h); const mr = M.monthRate(h);
  const bars = [6, 5, 4, 3, 2, 1, 0].map(i => {
    const d = addDays(day, -i);
    if (!M.scheduledOn(h, d)) return '<i class="off"></i>';
    const c = M.habitCount(h, d);
    return `<i class="${c >= per ? 'on' : c > 0 ? 'part' : ''}"></i>`;
  }).join('');
  const rt = (h.remind_times || []).length ? ` · ${h.remind_times.join(', ')} hatırlat` : '';
  return `<article class="card hcard" style="${faded ? 'opacity:.6' : ''}">
    <div class="top">
      <span class="hicon" style="background:color-mix(in srgb, ${esc(h.color)} 22%, var(--surface));color:color-mix(in srgb, ${esc(h.color)} 80%, var(--text))">${icon(h.icon, 20)}</span>
      <button style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;background:none;border:0;padding:0;text-align:left" data-act="editHabit" data-id="${h.id}">
        <h3>${esc(h.name)}</h3><span class="sub">${esc(M.periodLabel(h))}${per > 1 ? ` · günde ${per}` : ''}${esc(rt)}</span></button>
      <div class="ctrls">
        ${n > 0 && !faded ? `<button class="icon-btn sm ghost" data-act="habitMinus" data-id="${h.id}" data-day="${day}" aria-label="Bir azalt">−</button>` : ''}
        ${faded ? '' : `<button class="ring-btn" data-act="habitTap" data-id="${h.id}" data-day="${day}" aria-label="${esc(h.name)} işaretle, ${n}/${per}"><span class="ring lg">${ringSvg(n, per, 50, 4)}<span>${n >= per ? `<span style="color:var(--accent-text)">${icon('check', 20, 3)}</span>` : `${n}/${per}`}</span></span></button>`}
      </div>
    </div>
    <div class="bars">${bars}
      <span class="chip ${st ? 'warn' : ''}" style="margin-left:auto">${st ? `${st} gün seri` : 'Seri yok'}</span>
      ${mr != null ? `<span class="chip">%${mr} bu ay</span>` : ''}</div>
  </article>`;
}

const TEMPLATES = [
  { cat: 'Popüler', items: [['Su iç', 'drop', 8, '#5C9DB5'], ['Spor yap', 'dumbbell', 1, '#6C9B3C'], ['Vitamin al', 'pill', 1, '#C2457A'], ['Kitap oku', 'book', 1, '#C99A2E'], ['Yabancı dil çalış', 'cap', 1, '#4D6CB0'], ['Erken kalk', 'sun', 1, '#D9822B'], ['Meditasyon', 'medit', 1, '#8B7BD8'], ['Yürüyüş', 'walk', 1, '#3E9A86']] },
  { cat: 'Sağlık', items: [['8 saat uyu', 'moon', 1, '#4D6CB0'], ['Kambur durma!', 'posture', 3, '#C9471F'], ['Meyve ye', 'apple', 2, '#6C9B3C'], ['Şekersiz gün', 'heart', 1, '#C2457A'], ['Ekransız 1 saat', 'phone', 1, '#8C8C8C'], ['Tempolu koşu', 'run', 1, '#D9822B']] },
  { cat: 'Kişisel', items: [['Günlük yaz', 'pen', 1, '#8A6A50'], ['Harcamaları yaz', 'money', 1, '#2F6F5E'], ['Müzik çalış', 'music', 1, '#9B4FB0'], ['Atık ayır', 'leaf', 1, '#6C9B3C']] },
  { cat: 'Ev', items: [['Ev temizliği', 'broom', 1, '#B5559C'], ['Bitkileri sula', 'leaf', 1, '#3E9A86'], ['Bulaşıkları yıka', 'drop', 1, '#5C9DB5']] },
  { cat: 'İş', items: [['Kasa kontrolü', 'money', 1, '#C9471F'], ['Gün sonu raporu', 'note', 1, '#4D6CB0'], ['Makine temizliği', 'coffee', 1, '#8A6A50'], ['Stok kontrolü', 'list', 1, '#C99A2E']] },
];

// ── Görev günlüğü ────────────────────────────────────────
function viewLog() {
  const rows = S.all('task_log').sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 400);
  let out = topbar(`${rows.length} kayıt`, 'Görev günlüğü', searchBtn());
  out += `<div class="scroll"><div class="main-inner">`;
  if (!rows.length) out += `<div class="card flat empty"><b>Henüz tamamlanan görev yok</b>Bir görevi bitirdiğinde burada görünür.</div>`;
  const byDay = new Map();
  rows.forEach(r => { const d = ymd(new Date(r.done_at)); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); });
  byDay.forEach((items, d) => {
    out += `<div class="section"><div class="section-head"><h2>${esc(prettyDate(d, true))}</h2><span class="n">${items.length}</span></div><div class="card flat">
      ${items.map(r => { const l = M.listById(r.list_id); const tm = new Date(r.done_at); return `<div class="trow done" ${r.task_id && S.get('tasks', r.task_id) && !S.get('tasks', r.task_id).deleted_at ? `data-act="open" data-id="${r.task_id}"` : 'style="cursor:default"'}>
        <span class="check on sm">${icon('check', 12, 3)}</span>
        <div class="tbody"><span class="ttitle" style="text-decoration:none;color:var(--text)">${esc(r.title) || 'Adsız'}</span>${r.path ? `<span class="tmeta">${esc(r.path)}</span>` : ''}</div>
        <div class="tright"><span class="mini">${String(tm.getHours()).padStart(2, '0')}:${String(tm.getMinutes()).padStart(2, '0')}</span>${l ? `<span class="chip">${esc(l.name)}</span>` : ''}</div></div>`; }).join('')}
    </div></div>`;
  });
  return out + `</div></div>`;
}

// ── Çöp kutusu ───────────────────────────────────────────
function viewTrash() {
  const rows = M.trashedRoots();
  let out = topbar('30 günden eski olanlar otomatik silinir', 'Çöp kutusu', rows.length ? `<button class="btn danger sm" data-act="emptyTrash">Çöpü boşalt</button>` : '');
  out += `<div class="scroll"><div class="main-inner">`;
  if (!rows.length) out += `<div class="card flat empty"><b>Çöp kutusu boş</b>Sildiğin görevler 30 gün burada kalır.</div>`;
  else out += `<div class="card">${rows.map(t => {
    const sub = S.all('tasks').filter(x => x.deleted_at === t.deleted_at && x.id !== t.id).length;
    return `<div class="trow" style="cursor:default"><div class="tbody"><span class="ttitle">${esc(t.title) || 'Adsız görev'}</span>
      <span class="tmeta">${esc(prettyDate(t.deleted_at.slice(0, 10)))} silindi${sub ? ` · ${sub} alt görev` : ''}${t.repeat?.type ? ' · tekrar eden' : ''}</span></div>
      <div class="tright"><button class="btn sm" data-act="restore" data-id="${t.id}">Geri yükle</button><button class="icon-btn sm ghost" data-act="purge" data-id="${t.id}" aria-label="Kalıcı sil">${icon('trash', 17)}</button></div></div>`;
  }).join('')}</div>`;
  return out + `</div></div>`;
}

// ── Listeler menüsü (telefon) ────────────────────────────
function viewLists() {
  let out = topbar(`${M.lists().length} liste`, 'Listeler', `${searchBtn()}<button class="btn-accent sm" style="width:44px;height:44px;border-radius:14px;padding:0" data-act="newList" aria-label="Yeni liste">${icon('plus', 20, 2.2)}</button>`);
  out += `<div class="scroll"><div class="main-inner"><div class="card list-group">${M.lists().map(l => `
    <div class="trow" data-act="openList" data-id="${l.id}"><span class="dot" style="width:12px;height:12px;background:${esc(l.color)}"></span>
      <div class="tbody"><span class="ttitle">${esc(l.name) || 'Adsız liste'}</span></div>
      <div class="tright">${l.hidden_home ? `<span style="color:var(--faint)">${icon('eyeoff', 16)}</span>` : ''}<span class="mini">${listCount(l.id) || ''}</span><span style="color:var(--faint)">${icon('fwd', 16)}</span></div></div>`).join('') || `<div class="empty">Henüz liste yok</div>`}
  </div>
  <div class="card list-group">
    <div class="trow" data-act="nav" data-view="log">${icon('log', 20)}<div class="tbody"><span class="ttitle">Görev günlüğü</span></div><span style="color:var(--faint)">${icon('fwd', 16)}</span></div>
    <div class="trow" data-act="nav" data-view="trash">${icon('trash', 20)}<div class="tbody"><span class="ttitle">Çöp kutusu</span></div><span class="mini">${M.trashedRoots().length || ''}</span><span style="color:var(--faint)">${icon('fwd', 16)}</span></div>
    <div class="trow" data-act="nav" data-view="settings">${icon('gear', 20)}<div class="tbody"><span class="ttitle">Ayarlar</span></div><span style="color:var(--faint)">${icon('fwd', 16)}</span></div>
  </div>${syncHtml()}</div></div>`;
  return out;
}

// ── Ayarlar ──────────────────────────────────────────────
function viewSettings() {
  const s = M.settings();
  const tg = (key, label, sub = '') => `<label class="switch"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="tgl"><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}><span></span></span></label>`;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  let out = topbar(esc(S.state.user?.email || ''), 'Ayarlar');
  out += `<div class="scroll"><div class="main-inner">
  <div class="section"><div class="section-head"><h2>Görünüm</h2></div><div class="card flat" style="padding:12px 14px;display:flex;flex-direction:column;gap:12px">
    <div class="seg" role="group" aria-label="Tema">${[['auto', 'Otomatik'], ['light', 'Açık'], ['dark', 'Koyu']].map(([k, l]) => `<button class="${s.theme === k ? 'on' : ''}" data-act="setTheme" data-v="${k}">${l}</button>`).join('')}</div>
  </div></div>
  <div class="section"><div class="section-head"><h2>Görevler</h2></div><div class="card flat">
    ${tg('autoCompleteParent', 'Alt görevler bitince üst görevi tamamla')}
    ${tg('completeChildren', 'Üst görev bitince alt görevleri de tamamla')}
    ${tg('showCompleted', 'Son tamamlananları göster', 'Görevler ekranının altında')}
    <label class="switch"><span>Gün başlangıcı<small>Bu saatten önce önceki gün sayılır</small></span>
      <select data-set="dayStart" class="input" style="width:auto;height:40px">${[0, 1, 2, 3, 4, 5, 6].map(h => `<option value="${h}" ${Number(s.dayStart) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
  </div></div>
  <div class="section"><div class="section-head"><h2>Alışkanlıklar</h2></div><div class="card flat">${tg('showHabitsHome', 'Görevler ekranında göster')}</div></div>
  <div class="section"><div class="section-head"><h2>Hatırlatmalar</h2></div><div class="card flat">
    <div class="switch"><span>Bildirim izni<small>${perm === 'granted' ? 'Açık. Uygulama açıkken ya da arka plandayken hatırlatır.' : perm === 'denied' ? 'Kapalı. Telefon ayarlarından açabilirsin.' : perm === 'unsupported' ? 'Bu tarayıcı desteklemiyor. iPhone’da önce ana ekrana ekle.' : 'Henüz izin verilmedi'}</small></span>
      ${perm === 'default' ? `<button class="btn sm" data-act="askNotif">İzin ver</button>` : ''}</div>
  </div></div>
  <div class="section"><div class="section-head"><h2>Veriler</h2></div><div class="card flat">
    <button class="switch" style="width:100%;background:none;border:0;border-bottom:1px solid var(--divider);text-align:left" data-act="export"><span>Dışa aktar (yedek)<small>Tüm verilerini bir dosya olarak indir</small></span>${icon('download')}</button>
    <label class="switch" style="cursor:pointer"><span>İçe aktar<small>Yedek ya da Tappsk aktarım dosyası</small></span>${icon('upload')}<input type="file" accept=".json,application/json" data-act="importFile" class="sr"></label>
  </div></div>
  <div class="section"><div class="section-head"><h2>Hesap</h2></div><div class="card flat">
    <div class="switch"><span>Eşitleme<small>${S.state.lastSync ? 'Son: ' + new Date(S.state.lastSync).toLocaleString('tr-TR') : '—'}${S.pendingCount() ? ` · ${S.pendingCount()} bekleyen` : ''}</small></span><button class="btn sm" data-act="syncNow">${icon('sync', 16)} Şimdi</button></div>
    ${S.state.mode === 'cloud' ? `<button class="switch" style="width:100%;background:none;border:0;text-align:left;color:#B3261E" data-act="logout"><span>Çıkış yap</span>${icon('logout')}</button>` : ''}
  </div></div>
  <p class="dfoot">Görev · sürüm 1.0</p>
  </div></div>`;
  return out;
}

// ═════════════════════════════════════════════════════════
// Görev detayı
// ═════════════════════════════════════════════════════════
function openTask(id) {
  ui.openTask = id; renderDetail(); renderMain();
  if (window.innerWidth < 900) history.pushState({ task: id }, '');
}
function closeTask() { ui.openTask = null; renderDetail(); renderMain(); }
window.addEventListener('popstate', () => { if (ui.openTask) { ui.openTask = null; renderDetail(); renderMain(); } if ($('.overlay')) closeSheet(); });

function renderDetail() {
  const el = $('#detail'); if (!el) return;
  const t = ui.openTask && S.get('tasks', ui.openTask);
  if (!t || t.deleted_at) { ui.openTask = null; el.className = 'detail'; el.innerHTML = ''; return; }
  el.className = 'detail open';
  const anc = M.ancestors(t); const list = M.taskList(t);
  const pr = M.progress(t.id);
  const late = t.due_date && t.due_date < today() && !t.done;
  const isRoot = !t.parent_id;
  el.innerHTML = `
  <div class="dhead">
    <button class="icon-btn back-btn" data-act="closeTask" aria-label="Geri">${icon('back')}</button>
    <nav class="crumbs" aria-label="Konum">
      ${list ? `<button data-act="openList" data-id="${list.id}"><span class="dot" style="display:inline-block;background:${esc(list.color)};margin-right:5px"></span>${esc(list.name)}</button>` : '<span>Listesiz</span>'}
      ${anc.map(a => `<span aria-hidden="true">›</span><button data-act="open" data-id="${a.id}">${esc(a.title) || 'Adsız'}</button>`).join('')}
    </nav>
    <button class="icon-btn" data-act="taskMenu" data-id="${t.id}" aria-label="Diğer seçenekler">${icon('more')}</button>
    <button class="icon-btn ghost" data-act="closeTask" aria-label="Kapat" style="display:${window.innerWidth >= 900 ? 'inline-flex' : 'none'}">${icon('close')}</button>
  </div>
  <div class="dscroll">
    <div class="dtitle">
      <button class="check ${t.done ? 'on' : ''}" style="${t.done ? '' : `border-color:${list?.color || 'var(--check)'}`}" data-act="toggle" data-id="${t.id}" aria-label="${t.done ? 'Tamamlanmadı yap' : 'Tamamla'}">${t.done ? icon('check', 16, 3) : ''}</button>
      <label style="flex:1;display:flex"><span class="sr">Görev adı</span><textarea rows="1" data-in="title" data-id="${t.id}" data-fk="title:${t.id}" placeholder="Görev adı">${esc(t.title)}</textarea></label>
    </div>
    <div class="chips">
      ${isRoot ? `<label><span class="sr">Liste</span><select data-in="list" data-id="${t.id}" style="${list ? `background:${esc(list.color)};color:#fff` : 'background:var(--sunken)'}">
        <option value="">Listesiz</option>${M.lists().map(l => `<option value="${l.id}" ${l.id === t.list_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>`
        : (list ? `<span class="chip lg" style="background:${esc(list.color)};color:#fff">${esc(list.name)}</span>` : '')}
      <label><span class="sr">Öncelik</span><select data-in="priority" data-id="${t.id}" style="background:${t.priority ? 'var(--accent-soft)' : 'var(--surface)'};color:${t.priority ? 'var(--accent-text)' : 'var(--text-2)'};border:1px solid ${t.priority ? 'var(--accent-line)' : 'var(--border-strong)'}">
        ${[[0, 'Öncelik yok'], [1, 'Öncelik: Düşük'], [2, 'Öncelik: Orta'], [3, 'Öncelik: Yüksek']].map(([v, l]) => `<option value="${v}" ${Number(t.priority) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${(t.tags || []).map(tg => `<button class="chip lg out" data-act="rmTag" data-id="${t.id}" data-tag="${esc(tg)}" aria-label="#${esc(tg)} etiketini kaldır">#${esc(tg)} ${icon('close', 12, 2.4)}</button>`).join('')}
      <label><span class="sr">Etiket ekle</span><input class="tag-input" data-in="tag" data-id="${t.id}" data-fk="tag:${t.id}" placeholder="+ Etiket" enterkeyhint="done"></label>
    </div>
    ${pr.total ? `<div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:var(--text-2)"><span>Alt görevler</span><span>${pr.done} / ${pr.total} · %${Math.round(pr.done / pr.total * 100)}</span></div>
      <div class="pbar"><div style="width:${pr.done / pr.total * 100}%"></div></div></div>` : ''}
    <div class="card tree" id="tree">${treeHtml(t.id, 0)}
      <button class="add-sub" data-act="addSub" data-id="${t.id}">${icon('plus', 16, 2.2)}Alt görev ekle</button>
    </div>
    <div class="card flat">
      <div class="prop">${icon('cal', 18)}<span class="lbl">Tarih</span>
        <label><span class="sr">Tarih</span><input type="date" data-in="due_date" data-id="${t.id}" value="${t.due_date || ''}" style="${late ? 'color:var(--accent-text)' : ''}"></label></div>
      <div class="prop-sub">
        ${[['Bugün', 0], ['Yarın', 1], ['Haftaya', 7]].map(([l, n]) => `<button class="chip" data-act="setDue" data-id="${t.id}" data-d="${addDays(today(), n)}">${l}</button>`).join('')}
        ${t.due_date ? `<button class="chip" data-act="setDue" data-id="${t.id}" data-d="">Tarihi kaldır</button>` : ''}
        ${late ? `<span class="chip warn">Gecikti · ${esc(prettyDate(t.due_date))}</span>` : ''}
      </div>
      <div class="prop">${icon('bell', 18)}<span class="lbl">Saat</span><label><span class="sr">Saat</span><input type="time" data-in="due_time" data-id="${t.id}" value="${t.due_time || ''}"></label></div>
      <div class="prop">${icon('bell', 18)}<span class="lbl">Hatırlatma</span>
        <label><span class="sr">Hatırlatma</span><select data-in="remind" data-id="${t.id}">
          ${[['', 'Yok'], ['0', 'Zamanında'], ['15', '15 dk önce'], ['60', '1 saat önce'], ['1440', '1 gün önce']].map(([v, l]) => `<option value="${v}" ${String(t.remind?.offset_min ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="prop">${icon('repeat', 18)}<span class="lbl">Tekrar</span>
        <label><span class="sr">Tekrar</span><select data-in="repeatType" data-id="${t.id}">
          ${[['', 'Yok'], ['daily', 'Günlük'], ['weekly', 'Haftalık'], ['monthly', 'Aylık'], ['yearly', 'Yıllık'], ['interval', 'Her X günde']].map(([v, l]) => `<option value="${v}" ${(t.repeat?.type || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      ${t.repeat?.type ? repeatEditor(t) : ''}
    </div>
    <div class="card flat">
      <div class="prop" style="border-bottom:0;padding-bottom:0">${icon('note', 18)}<span class="lbl">Not</span></div>
      <label><span class="sr">Not</span><textarea class="notes" data-in="notes" data-id="${t.id}" data-fk="notes:${t.id}" placeholder="Not ekle…">${esc(t.notes)}</textarea></label>
    </div>
    <div class="card flat">
      <div class="prop" style="border-bottom:0">${icon('camera', 18)}<span class="lbl">Fotoğraflar</span>
        ${S.state.mode === 'cloud' ? `<label class="btn sm" style="cursor:pointer">${icon('plus', 15)} Ekle<input type="file" accept="image/*" multiple class="sr" data-act="photoUp" data-id="${t.id}"></label>` : '<span class="mini">Bulut hesabı gerekli</span>'}</div>
      ${(t.photos || []).length ? `<div class="photos">${t.photos.map(p => `<a class="ph" href="#" data-act="photoView" data-path="${esc(p)}" data-ph="${esc(p)}" aria-label="Fotoğrafı aç"><button data-act="photoDel" data-id="${t.id}" data-path="${esc(p)}" aria-label="Fotoğrafı sil">×</button></a>`).join('')}</div>` : ''}
    </div>
    <p class="dfoot">${new Date(t.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} tarihinde oluşturuldu</p>
  </div>`;
  autoGrow(el.querySelector('textarea[data-in=title]'));
  loadPhotos(el);
}

function repeatEditor(t) {
  const r = t.repeat;
  let x = `<div class="prop-sub" style="flex-direction:column;align-items:stretch;gap:10px;padding-left:14px">`;
  if (r.type !== 'yearly') {
    const unit = { daily: 'günde', interval: 'günde', weekly: 'haftada', monthly: 'ayda' }[r.type];
    x += `<label style="display:flex;align-items:center;gap:8px;font-size:14px">Her <input type="number" min="1" max="99" class="input" style="width:70px;height:38px" data-in="repeatEvery" data-id="${t.id}" value="${r.every || 1}"> ${unit} bir</label>`;
  }
  if (r.type === 'weekly') x += `<div class="daypick" role="group" aria-label="Günler">${DAYS_SHORT.map((d, i) => `<button class="${(r.days || []).includes(i + 1) ? 'on' : ''}" data-act="repDay" data-id="${t.id}" data-v="${i + 1}">${d}</button>`).join('')}</div>`;
  if (r.type === 'monthly') x += `<div class="mdays" role="group" aria-label="Ayın günleri">${Array.from({ length: 31 }, (_, i) => `<button class="${(r.days || []).includes(i + 1) ? 'on' : ''}" data-act="repDay" data-id="${t.id}" data-v="${i + 1}">${i + 1}</button>`).join('')}</div>`;
  x += `<span class="mini">${esc(repeatLabel(r))}${t.due_date ? ` · sonraki: ${esc(prettyDate(t.due_date))}` : ''}. Tamamlayınca alt görevleriyle birlikte yenilenir.</span></div>`;
  return x;
}

function treeHtml(pid, depth) {
  return M.childrenOf(pid).map(c => {
    const kids = M.childrenOf(c.id); const cp = M.childProgress(c.id);
    const ind = Math.min(depth, 5) * 22;
    const late = c.due_date && c.due_date < today() && !c.done;
    return `<div class="node ${kids.length ? 'parent' : ''} ${c.done ? 'done' : ''}" data-node="${c.id}" style="padding-left:${6 + ind}px">
      ${depth ? Array.from({ length: Math.min(depth, 5) }, (_, i) => `<span class="guide" style="left:${18 + i * 22}px"></span>`).join('') : ''}
      <button class="tw ${kids.length ? '' : 'none'}" data-act="collapse" data-id="${c.id}" aria-label="${c.collapsed ? 'Genişlet' : 'Daralt'}" aria-expanded="${!c.collapsed}" ${kids.length ? '' : 'tabindex="-1"'}>${icon(c.collapsed ? 'fwd' : 'down', 14, 2.4)}</button>
      <button class="check sm ${c.done ? 'on' : ''}" data-act="toggle" data-id="${c.id}" aria-label="${c.done ? 'Tamamlanmadı yap' : 'Tamamla'}: ${esc(c.title)}">${c.done ? icon('check', 12, 3) : ''}</button>
      <label style="flex:1;min-width:0;display:flex"><span class="sr">Alt görev</span><input class="ntitle" data-in="node" data-id="${c.id}" data-fk="node:${c.id}" value="${esc(c.title)}" placeholder="Alt görev" enterkeyhint="next"></label>
      ${c.due_date ? `<span class="chip ${late ? 'warn' : ''}" style="font-size:11px">${esc(prettyDate(c.due_date))}</span>` : ''}
      ${c.repeat?.type ? `<span style="color:var(--muted)">${icon('repeat', 13, 2)}</span>` : ''}
      ${kids.length ? `<span class="mini">${cp.done}/${cp.total}</span>` : ''}
      <span class="nact">
        <button class="desk" data-act="outdent" data-id="${c.id}" aria-label="Dışarı çıkar" title="Dışarı çıkar (Shift+Tab)">${icon('outdent', 16)}</button>
        <button class="desk" data-act="indent" data-id="${c.id}" aria-label="İçeri al" title="İçeri al (Tab)">${icon('indent', 16)}</button>
        <button data-act="open" data-id="${c.id}" aria-label="Ayrıntıları aç" title="Ayrıntılar">${icon('open', 16)}</button>
        <button data-act="nodeMenu" data-id="${c.id}" aria-label="Seçenekler">${icon('more', 16)}</button>
      </span>
    </div>${kids.length && !c.collapsed ? treeHtml(c.id, depth + 1) : ''}`;
  }).join('');
}
function focusNode(id, atEnd = true) {
  const el = document.querySelector(`[data-fk="node:${id}"]`);
  if (el) { el.focus(); if (atEnd) { const n = el.value.length; el.setSelectionRange(n, n); } }
}
function autoGrow(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

// Fotoğraflar
const photoUrls = new Map();
async function loadPhotos(scope) {
  if (!sb) return;
  const els = [...scope.querySelectorAll('[data-ph]')];
  const need = els.map(e => e.dataset.ph).filter(p => !photoUrls.has(p));
  if (need.length) {
    const { data } = await sb.storage.from('ekler').createSignedUrls(need, 3600);
    (data || []).forEach(d => { if (d.signedUrl) photoUrls.set(d.path, d.signedUrl); });
  }
  els.forEach(e => { const u = photoUrls.get(e.dataset.ph); if (u) e.style.backgroundImage = `url("${u}")`; });
}
async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}

// ═════════════════════════════════════════════════════════
// Sayfalar (sheet)
// ═════════════════════════════════════════════════════════
function openSheet(html, onMount) {
  closeSheet();
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeSheet(); });
  document.body.appendChild(ov);
  onMount && onMount(ov.firstElementChild);
  const f = ov.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
}
function closeSheet() { document.querySelectorAll('.overlay').forEach(o => o.remove()); }

function actionSheet(title, acts) {
  openSheet(`<h2>${esc(title)}</h2><div class="card flat actions">${acts.map((a, i) => `<button class="act ${a.danger ? 'danger' : ''}" data-i="${i}">${a.icon ? icon(a.icon, 19) : ''}${esc(a.label)}</button>`).join('')}</div>`, (sh) => {
    sh.querySelectorAll('.act').forEach(b => b.onclick = () => { closeSheet(); acts[Number(b.dataset.i)].run(); });
  });
}

function taskMenu(t) {
  const acts = [
    { label: 'Kopyasını oluştur', icon: 'copy', run: () => { const c = duplicate(t, t.parent_id); openTask(c.id); toast('Kopyalandı'); } },
    { label: 'Başka yere taşı', icon: 'sub', run: () => moveSheet(t) },
  ];
  if (t.parent_id) acts.push({ label: 'Ayrı görev yap (en üste çıkar)', icon: 'outdent', run: () => { const root = M.rootOf(t); M.moveTo(t, null, root.list_id); renderAll(); } });
  acts.push({ label: 'Sil', icon: 'trash', danger: true, run: () => deleteTask(t) });
  actionSheet(t.title || 'Görev', acts);
}
function nodeMenu(t) {
  actionSheet(t.title || 'Alt görev', [
    { label: 'Ayrıntıları aç', icon: 'open', run: () => openTask(t.id) },
    { label: 'Altına görev ekle', icon: 'plus', run: () => { if (t.collapsed) S.patch('tasks', t.id, { collapsed: false }); const n = M.createTask({ parent_id: t.id }); renderAll(); focusNode(n.id); } },
    { label: 'İçeri al', icon: 'indent', run: () => { M.indent(t) ? renderAll() : toast('Üstünde bir kardeş görev olmalı'); } },
    { label: 'Dışarı çıkar', icon: 'outdent', run: () => { M.outdent(t) ? renderAll() : toast('Zaten en üst seviyede'); } },
    { label: 'Yukarı taşı', icon: 'up', run: () => { M.move(t, -1); renderAll(); } },
    { label: 'Aşağı taşı', icon: 'down', run: () => { M.move(t, 1); renderAll(); } },
    { label: 'Sil', icon: 'trash', danger: true, run: () => deleteTask(t) },
  ]);
}
function duplicate(t, parentId) {
  const c = M.createTask({ ...t, id: undefined, created_at: undefined, parent_id: parentId, list_id: parentId ? null : t.list_id, title: parentId === t.parent_id ? t.title + ' (kopya)' : t.title, photos: [], sort: undefined, done: false, done_at: null });
  M.childrenOf(t.id).forEach(k => duplicate(k, c.id));
  return c;
}
function deleteTask(t) {
  const n = M.descendants(t.id).length;
  M.trash(t);
  if (ui.openTask === t.id || (ui.openTask && M.ancestors(S.get('tasks', ui.openTask) || {}).some(a => a.id === t.id))) ui.openTask = t.parent_id || null;
  renderAll();
  toast(`Çöp kutusuna taşındı${n ? ` (${n} alt görevle)` : ''}`, () => { M.restore(S.get('tasks', t.id)); renderAll(); });
}
function moveSheet(t) {
  const opts = [];
  M.lists().forEach(l => {
    opts.push({ label: l.name, sub: 'Liste', run: () => { M.moveTo(t, null, l.id); renderAll(); } });
  });
  opts.push({ label: 'Listesiz', run: () => { M.moveTo(t, null, null); renderAll(); } });
  const roots = M.liveTasks().filter(x => !x.parent_id && !x.done && x.id !== t.id).slice(0, 40);
  openSheet(`<h2>Nereye taşınsın?</h2>
    <div class="field-l"><span>Listeye</span><div class="chips">${M.lists().map(l => `<button class="chip lg out" data-l="${l.id}"><span class="dot" style="background:${esc(l.color)}"></span>${esc(l.name)}</button>`).join('')}<button class="chip lg out" data-l="">Listesiz</button></div></div>
    <div class="field-l"><span>Bir görevin altına</span><input class="input" placeholder="Görev ara…" id="mvq" autofocus>
    <div class="card flat actions" id="mvres" style="margin-top:8px;max-height:300px;overflow:auto"></div></div>`, (sh) => {
    sh.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { M.moveTo(t, null, b.dataset.l || null); closeSheet(); renderAll(); toast('Taşındı'); });
    const draw = () => {
      const q = lower($('#mvq').value);
      const res = M.liveTasks().filter(x => !x.done && x.id !== t.id && !M.descendants(t.id).some(d => d.id === x.id) && (!q || lower(x.title).includes(q))).slice(0, 30);
      $('#mvres').innerHTML = res.map(x => `<button class="act" data-p="${x.id}"><div style="display:flex;flex-direction:column"><span>${esc(x.title) || 'Adsız'}</span><span class="mini">${esc([M.taskList(x)?.name, ...M.ancestors(x).map(a => a.title)].filter(Boolean).join(' › '))}</span></div></button>`).join('') || '<div class="empty">Sonuç yok</div>';
      $('#mvres').querySelectorAll('[data-p]').forEach(b => b.onclick = () => { M.moveTo(t, b.dataset.p); closeSheet(); renderAll(); toast('Taşındı'); });
    };
    $('#mvq').oninput = draw; draw();
  });
  void roots; void opts;
}

// Liste düzenleme
function listSheet(l) {
  const isNew = !l; const cur = l || { name: '', color: M.PALETTE[Math.floor(Math.random() * M.PALETTE.length)], hidden_home: false };
  let color = cur.color;
  openSheet(`<h2>${isNew ? 'Yeni liste' : 'Listeyi düzenle'}</h2>
    <label class="field-l"><span>Ad</span><input class="input" id="lname" value="${esc(cur.name)}" placeholder="Örn. İş, Ev, 5M Migros" autofocus></label>
    <div class="field-l"><span>Renk</span><div class="swatches">${M.PALETTE.map(c => `<button style="background:${c}" class="${c === color ? 'on' : ''}" data-c="${c}" aria-label="Renk ${c}"></button>`).join('')}</div></div>
    <div class="card flat" style="margin-bottom:16px"><label class="switch"><span>Ana ekranda gösterme<small>Bu listenin görevleri sadece kendi sayfasında görünür</small></span><span class="tgl"><input type="checkbox" id="lhide" ${cur.hidden_home ? 'checked' : ''}><span></span></span></label></div>
    <div style="display:flex;gap:10px">${isNew ? '' : `<button class="btn danger" id="ldel">${icon('trash', 17)} Sil</button>`}<button class="btn-accent" style="flex:1" id="lsave">${isNew ? 'Oluştur' : 'Kaydet'}</button></div>`, (sh) => {
    sh.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { color = b.dataset.c; sh.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); });
    const save = () => {
      const name = $('#lname').value.trim() || 'Yeni liste';
      if (isNew) { const nl = S.put('lists', { name, color, hidden_home: $('#lhide').checked, sort: (Math.max(0, ...M.lists().map(x => x.sort || 0)) + 1) }); ui.view = 'list'; ui.listId = nl.id; saveUi(); }
      else S.patch('lists', l.id, { name, color, hidden_home: $('#lhide').checked });
      closeSheet(); renderAll();
    };
    $('#lsave').onclick = save; $('#lname').onkeydown = (e) => { if (e.key === 'Enter') save(); };
    if (!isNew) $('#ldel').onclick = () => {
      const n = M.liveTasks().filter(t => !t.parent_id && t.list_id === l.id).length;
      openSheet(`<h2>“${esc(l.name)}” silinsin mi?</h2><p style="color:var(--muted);margin:0 0 16px">${n ? `İçindeki ${n} görev çöp kutusuna taşınır, 30 gün içinde geri alabilirsin.` : 'Liste boş.'}</p>
        <div style="display:flex;gap:10px"><button class="btn" style="flex:1" id="no">Vazgeç</button><button class="btn danger" style="flex:1" id="yes">Sil</button></div>`, (s2) => {
        s2.querySelector('#no').onclick = closeSheet;
        s2.querySelector('#yes').onclick = () => {
          M.liveTasks().filter(t => !t.parent_id && t.list_id === l.id).forEach(t => M.trash(t));
          S.patch('lists', l.id, { deleted_at: new Date().toISOString() });
          if (ui.listId === l.id) { ui.view = 'home'; ui.listId = null; saveUi(); }
          closeSheet(); renderAll(); toast('Liste silindi');
        };
      });
    };
  });
}

// Alışkanlık düzenleme
function habitSheet(h, preset) {
  const isNew = !h;
  const cur = h ? JSON.parse(JSON.stringify(h)) : { name: preset?.[0] || '', icon: preset?.[1] || 'star', per_day: preset?.[2] || 1, color: preset?.[3] || '#DF5830', period: { type: 'daily' }, remind_times: [], start_date: today() };
  const draw = (sh) => {
    const p = cur.period;
    sh.innerHTML = `<div class="grab"></div><h2>${isNew ? 'Yeni alışkanlık' : 'Alışkanlığı düzenle'}<button class="icon-btn sm ghost" data-x aria-label="Kapat">${icon('close')}</button></h2>
    <label class="field-l"><span>Ad</span><input class="input" id="hname" value="${esc(cur.name)}" placeholder="Örn. Su iç" ${isNew ? 'autofocus' : ''}></label>
    <div class="field-l"><span>Simge</span><div class="icons">${HABIT_ICONS.map(i => `<button class="${i === cur.icon ? 'on' : ''}" data-ic="${i}" aria-label="${i}">${icon(i, 18)}</button>`).join('')}</div></div>
    <div class="field-l"><span>Renk</span><div class="swatches">${M.PALETTE.slice(0, 14).map(c => `<button style="background:${c}" class="${c === cur.color ? 'on' : ''}" data-c="${c}" aria-label="Renk"></button>`).join('')}</div></div>
    <div class="field-l"><span>Dönem</span><div class="seg">${[['daily', 'Her gün'], ['weekly', 'Haftalık'], ['monthly', 'Aylık'], ['interval', 'Aralıklı']].map(([k, l]) => `<button class="${p.type === k ? 'on' : ''}" data-pt="${k}">${l}</button>`).join('')}</div>
      ${p.type === 'weekly' ? `<div class="daypick" style="margin-top:8px">${DAYS_SHORT.map((d, i) => `<button class="${(p.days || []).includes(i + 1) ? 'on' : ''}" data-wd="${i + 1}">${d}</button>`).join('')}</div>` : ''}
      ${p.type === 'monthly' ? `<div class="mdays" style="margin-top:8px">${Array.from({ length: 31 }, (_, i) => `<button class="${(p.days || []).includes(i + 1) ? 'on' : ''}" data-md="${i + 1}">${i + 1}</button>`).join('')}</div>` : ''}
      ${p.type === 'interval' ? `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:14px">Her <input type="number" min="2" max="60" class="input" style="width:72px" id="hevery" value="${p.every || 2}"> günde bir</label>` : ''}
    </div>
    <div class="field-l"><span>Günlük tekrar</span><div style="display:flex;align-items:center;gap:12px">
      <button class="icon-btn" data-per="-1" aria-label="Azalt">−</button><b style="font-size:20px;min-width:30px;text-align:center" id="hper">${cur.per_day}</b><button class="icon-btn" data-per="1" aria-label="Artır">${icon('plus')}</button>
      <span class="mini">kez</span></div></div>
    <div class="field-l"><span>Hatırlatıcı</span><div class="chips">
      ${(cur.remind_times || []).map((rt, i) => `<span class="chip lg out"><input type="time" value="${esc(rt)}" data-rt="${i}" style="border:0;background:transparent;font-weight:600"><button style="border:0;background:none;padding:0;display:flex" data-rtx="${i}" aria-label="Kaldır">${icon('close', 13, 2.4)}</button></span>`).join('')}
      <button class="chip lg" data-rtadd>${icon('plus', 13)} Saat ekle</button></div></div>
    <div style="display:flex;gap:10px;margin-top:6px">${isNew ? '' : `<button class="btn danger" data-hdel>${icon('trash', 17)} Sil</button>`}<button class="btn-accent" style="flex:1" data-hsave>${isNew ? 'Ekle' : 'Kaydet'}</button></div>`;
    const keep = () => { cur.name = sh.querySelector('#hname').value; const ev = sh.querySelector('#hevery'); if (ev) cur.period.every = Number(ev.value) || 2; sh.querySelectorAll('[data-rt]').forEach(i => { cur.remind_times[Number(i.dataset.rt)] = i.value; }); };
    sh.querySelector('[data-x]').onclick = closeSheet;
    sh.querySelectorAll('[data-ic]').forEach(b => b.onclick = () => { keep(); cur.icon = b.dataset.ic; draw(sh); });
    sh.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { keep(); cur.color = b.dataset.c; draw(sh); });
    sh.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => { keep(); cur.period = { type: b.dataset.pt, days: b.dataset.pt === 'weekly' ? [1, 2, 3, 4, 5] : b.dataset.pt === 'monthly' ? [1] : [], every: 2 }; draw(sh); });
    sh.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => { keep(); const v = Number(b.dataset.wd); const d = new Set(cur.period.days || []); d.has(v) ? d.delete(v) : d.add(v); cur.period.days = [...d].sort((a, b) => a - b); draw(sh); });
    sh.querySelectorAll('[data-md]').forEach(b => b.onclick = () => { keep(); const v = Number(b.dataset.md); const d = new Set(cur.period.days || []); d.has(v) ? d.delete(v) : d.add(v); cur.period.days = [...d].sort((a, b) => a - b); draw(sh); });
    sh.querySelectorAll('[data-per]').forEach(b => b.onclick = () => { keep(); cur.per_day = Math.max(1, Math.min(50, cur.per_day + Number(b.dataset.per))); draw(sh); });
    sh.querySelector('[data-rtadd]').onclick = () => { keep(); cur.remind_times = [...(cur.remind_times || []), '09:00']; draw(sh); };
    sh.querySelectorAll('[data-rtx]').forEach(b => b.onclick = () => { keep(); cur.remind_times.splice(Number(b.dataset.rtx), 1); draw(sh); });
    sh.querySelector('[data-hsave]').onclick = () => {
      keep(); if (!cur.name.trim()) { sh.querySelector('#hname').focus(); return; }
      const row = { name: cur.name.trim(), icon: cur.icon, color: cur.color, period: cur.period, per_day: cur.per_day, remind_times: (cur.remind_times || []).filter(Boolean) };
      if (isNew) S.put('habits', { ...row, start_date: today(), sort: Math.max(0, ...M.habits().map(x => x.sort || 0)) + 1, archived: false });
      else S.patch('habits', h.id, row);
      closeSheet(); renderAll();
    };
    const del = sh.querySelector('[data-hdel]');
    if (del) del.onclick = () => { S.patch('habits', h.id, { deleted_at: new Date().toISOString() }); closeSheet(); renderAll(); toast('Alışkanlık silindi', () => { S.patch('habits', h.id, { deleted_at: null }); renderAll(); }); };
  };
  openSheet('', (sh) => { draw(sh); setTimeout(() => sh.querySelector('[autofocus]')?.focus(), 30); });
}
function templateSheet() {
  let cat = 0;
  const draw = (sh) => {
    sh.innerHTML = `<div class="grab"></div><h2>Yeni alışkanlık<button class="icon-btn sm ghost" data-x aria-label="Kapat">${icon('close')}</button></h2>
      <button class="btn" style="width:100%;margin-bottom:14px;justify-content:flex-start" data-own>${icon('pen', 18)} Kendin oluştur</button>
      <div class="tpl-cats">${TEMPLATES.map((c, i) => `<button class="chip lg ${i === cat ? 'solid' : 'out'}" data-cat="${i}">${c.cat}</button>`).join('')}</div>
      <div class="card flat actions">${TEMPLATES[cat].items.map((x, i) => `<button class="act" data-t="${i}"><span class="hicon" style="width:34px;height:34px;border-radius:10px;background:color-mix(in srgb, ${x[3]} 22%, var(--surface));color:color-mix(in srgb, ${x[3]} 80%, var(--text))">${icon(x[1], 17)}</span>${esc(x[0])}${x[2] > 1 ? `<span class="mini" style="margin-left:auto">günde ${x[2]}</span>` : ''}</button>`).join('')}</div>`;
    sh.querySelector('[data-x]').onclick = closeSheet;
    sh.querySelector('[data-own]').onclick = () => habitSheet(null);
    sh.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = Number(b.dataset.cat); draw(sh); });
    sh.querySelectorAll('[data-t]').forEach(b => b.onclick = () => habitSheet(null, TEMPLATES[cat].items[Number(b.dataset.t)]));
  };
  openSheet('', draw);
}
function habitOrderSheet() {
  const draw = (sh) => {
    const hs = M.habits();
    sh.innerHTML = `<div class="grab"></div><h2>Sırala<button class="icon-btn sm ghost" data-x aria-label="Kapat">${icon('close')}</button></h2>
      <div class="card flat actions">${hs.map((h, i) => `<div class="act" style="cursor:default">${icon(h.icon, 18)}<span style="flex:1">${esc(h.name)}</span>
        <button class="icon-btn sm ghost" data-mv="${i}" data-d="-1" aria-label="Yukarı" ${i === 0 ? 'disabled' : ''}>${icon('up', 16)}</button>
        <button class="icon-btn sm ghost" data-mv="${i}" data-d="1" aria-label="Aşağı" ${i === hs.length - 1 ? 'disabled' : ''}>${icon('down', 16)}</button></div>`).join('') || '<div class="empty">Alışkanlık yok</div>'}</div>`;
    sh.querySelector('[data-x]').onclick = closeSheet;
    sh.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.mv); const j = i + Number(b.dataset.d); const arr = M.habits();
      [arr[i], arr[j]] = [arr[j], arr[i]]; arr.forEach((h, k) => { if (h.sort !== k + 1) S.patch('habits', h.id, { sort: k + 1 }); });
      draw(sh); renderMain();
    });
  };
  openSheet('', draw);
}

// Arama
function searchSheet() {
  openSheet(`<h2>Ara<button class="icon-btn sm ghost" data-x aria-label="Kapat">${icon('close')}</button></h2>
    <label class="field-l"><span class="sr">Arama</span><input class="input" id="sq" placeholder="Görev, not ya da #etiket" autofocus enterkeyhint="search"></label>
    <div id="sres" class="search-res"></div>`, (sh) => {
    sh.querySelector('[data-x]').onclick = closeSheet;
    const draw = () => {
      const q = lower(sh.querySelector('#sq').value.trim());
      const box = sh.querySelector('#sres');
      if (!q) { box.innerHTML = '<p class="mini" style="text-align:center">Yazmaya başla…</p>'; return; }
      const hits = M.liveTasks().filter(t => lower(t.title).includes(q) || lower(t.notes).includes(q) || (t.tags || []).some(tg => ('#' + lower(tg)).includes(q.replace(/^#?/, '#'))))
        .sort((a, b) => Number(a.done) - Number(b.done)).slice(0, 60);
      const mark = (s) => { const i = lower(s).indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length)); };
      box.innerHTML = hits.length ? `<div class="card flat">${hits.map(t => `<div class="trow ${t.done ? 'done' : ''}" data-sopen="${t.id}">
        <span class="check sm ${t.done ? 'on' : ''}">${t.done ? icon('check', 12, 3) : ''}</span>
        <div class="tbody"><span class="ttitle">${mark(t.title || 'Adsız')}</span><span class="tmeta">${esc([M.taskList(t)?.name, ...M.ancestors(t).map(a => a.title)].filter(Boolean).join(' › '))}${t.due_date ? ' · ' + esc(prettyDate(t.due_date)) : ''}</span></div></div>`).join('')}</div>`
        : '<div class="empty">Sonuç bulunamadı</div>';
      box.querySelectorAll('[data-sopen]').forEach(r => r.onclick = () => { closeSheet(); openTask(r.dataset.sopen); });
    };
    sh.querySelector('#sq').oninput = draw; draw();
  });
}

// ═════════════════════════════════════════════════════════
// Eylemler
// ═════════════════════════════════════════════════════════
const A = {
  nav: (el) => { ui.view = el.dataset.view; ui.openTask = window.innerWidth >= 900 ? ui.openTask : null; if (ui.view === 'habits') ui.habitDay = today(); saveUi(); renderAll(); $('#main .scroll')?.scrollTo(0, 0); },
  openList: (el) => { ui.view = 'list'; ui.listId = el.dataset.id; if (window.innerWidth < 900) ui.openTask = null; saveUi(); renderAll(); },
  tab: (el) => { ui.tab = el.dataset.tab; saveUi(); renderMain(); },
  collapseSec: (el) => { const k = el.dataset.key; ui.collapsed.has(k) ? ui.collapsed.delete(k) : ui.collapsed.add(k); renderMain(); },
  open: (el) => openTask(el.dataset.id),
  closeTask: () => { if (window.innerWidth < 900 && history.state?.task) history.back(); else closeTask(); },
  toggle: (el) => {
    const t = S.get('tasks', el.dataset.id); if (!t) return;
    const r = M.setDone(t, !t.done);
    renderAll();
    if (r === 'repeat') toast(`Tamamlandı · sonraki: ${prettyDate(S.get('tasks', t.id).due_date)}`);
    else if (r === 'done' && !t.parent_id) toast('Tamamlandı', () => { M.setDone(S.get('tasks', t.id), false); const lg = S.all('task_log').filter(l => l.task_id === t.id).sort((a, b) => b.done_at.localeCompare(a.done_at))[0]; if (lg) S.remove('task_log', lg.id); renderAll(); });
  },
  collapse: (el) => { const t = S.get('tasks', el.dataset.id); S.patch('tasks', t.id, { collapsed: !t.collapsed }); renderDetail(); },
  addSub: (el) => { const n = M.createTask({ parent_id: el.dataset.id }); renderAll(); focusNode(n.id); },
  indent: (el) => { const t = S.get('tasks', el.dataset.id); if (M.indent(t)) { renderAll(); focusNode(t.id); } else toast('Üstünde bir kardeş görev olmalı'); },
  outdent: (el) => { const t = S.get('tasks', el.dataset.id); if (t.parent_id === ui.openTask) { toast('Bu görevin en üst seviyesi'); return; } if (M.outdent(t)) { renderAll(); focusNode(t.id); } },
  nodeMenu: (el) => nodeMenu(S.get('tasks', el.dataset.id)),
  taskMenu: (el) => taskMenu(S.get('tasks', el.dataset.id)),
  setDue: (el) => { S.patch('tasks', el.dataset.id, { due_date: el.dataset.d || null }); renderAll(); },
  rmTag: (el) => { const t = S.get('tasks', el.dataset.id); S.patch('tasks', t.id, { tags: (t.tags || []).filter(x => x !== el.dataset.tag) }); renderAll(); },
  repDay: (el) => { const t = S.get('tasks', el.dataset.id); const v = Number(el.dataset.v); const d = new Set(t.repeat.days || []); d.has(v) ? d.delete(v) : d.add(v); S.patch('tasks', t.id, { repeat: { ...t.repeat, days: [...d].sort((a, b) => a - b) } }); renderDetail(); },
  photoDel: async (el, ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const t = S.get('tasks', el.dataset.id); const p = el.dataset.path;
    S.patch('tasks', t.id, { photos: (t.photos || []).filter(x => x !== p) }); renderDetail();
    if (sb) sb.storage.from('ekler').remove([p]);
  },
  photoView: (el, ev) => { ev.preventDefault(); const u = photoUrls.get(el.dataset.path); if (u) openSheet(`<img src="${esc(u)}" alt="Görev fotoğrafı" style="width:100%;border-radius:14px;display:block">`); },
  search: () => searchSheet(),
  newList: () => listSheet(null),
  editList: (el) => listSheet(S.get('lists', el.dataset.id)),
  calNav: (el) => {
    const d = Number(el.dataset.d);
    if (d === 0) { ui.calMonth = today().slice(0, 7); ui.calSel = today(); }
    else { const [y, m] = ui.calMonth.split('-').map(Number); const nd = new Date(y, m - 1 + d, 1); ui.calMonth = ymd(nd).slice(0, 7); }
    renderMain();
  },
  calPick: (el) => { ui.calSel = el.dataset.day; if (ui.calSel.slice(0, 7) !== ui.calMonth) ui.calMonth = ui.calSel.slice(0, 7); renderMain(); },
  habitDay: (el) => { ui.habitDay = el.dataset.day; renderMain(); },
  habitTap: (el) => {
    const h = S.get('habits', el.dataset.id); const day = el.dataset.day; const n = M.habitCount(h, day); const per = h.per_day || 1;
    if (n >= per) { M.setHabitCount(h, day, 0); renderMain(); toast(`${h.name} sıfırlandı`, () => { M.setHabitCount(h, day, n); renderMain(); }); return; }
    M.setHabitCount(h, day, n + 1); renderMain();
    if (n + 1 === per) { const st = M.streak(h); toast(st > 1 ? `Harika! ${st} gün seri` : `${h.name} tamamlandı`); }
  },
  habitMinus: (el) => { const h = S.get('habits', el.dataset.id); M.setHabitCount(h, el.dataset.day, M.habitCount(h, el.dataset.day) - 1); renderMain(); },
  newHabit: () => templateSheet(),
  editHabit: (el) => habitSheet(S.get('habits', el.dataset.id)),
  habitOrder: () => habitOrderSheet(),
  tplPick: (el) => { const x = TEMPLATES.flatMap(c => c.items).find(i => i[0] === el.dataset.name); habitSheet(null, x); },
  restore: (el) => { M.restore(S.get('tasks', el.dataset.id)); renderAll(); toast('Geri yüklendi'); },
  purge: (el) => { M.purge(S.get('tasks', el.dataset.id)); renderAll(); },
  emptyTrash: () => openSheet(`<h2>Çöp kutusu boşaltılsın mı?</h2><p style="color:var(--muted);margin:0 0 16px">${M.trashedRoots().length} görev kalıcı olarak silinecek. Bu geri alınamaz.</p>
    <div style="display:flex;gap:10px"><button class="btn" style="flex:1" id="no">Vazgeç</button><button class="btn danger" style="flex:1" id="yes">Kalıcı sil</button></div>`, (sh) => {
    sh.querySelector('#no').onclick = closeSheet; sh.querySelector('#yes').onclick = () => { M.trashedRoots().forEach(M.purge); closeSheet(); renderAll(); };
  }),
  setTheme: (el) => { M.saveSettings({ theme: el.dataset.v }); applySettings(); renderMain(); },
  askNotif: async () => { try { await Notification.requestPermission(); } catch (e) { /* yok */ } renderMain(); },
  export: () => {
    const blob = new Blob([JSON.stringify(S.exportAll(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gorev-yedek-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  syncNow: async () => { await S.flush(); await S.pullAll(); renderAll(); toast('Eşitlendi'); },
  logout: async () => { await sb.auth.signOut(); },
};

// Tıklama
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') return;
  const fn = A[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') ev.preventDefault();
  fn(el, ev);
});

// Form ve girişler
document.addEventListener('submit', (ev) => { if (ev.target.id === 'quickForm') { ev.preventDefault(); quickSubmit(); } });
const patchSoon = new Map();
function patchTaskDebounced(id, ch) {
  S.patch('tasks', id, ch);
  clearTimeout(patchSoon.get(id)); patchSoon.set(id, setTimeout(() => renderSoon(), 200));
}
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'quickInput') { quickPreview(); return; }
  const k = el.dataset.in; if (!k) return;
  const id = el.dataset.id;
  if (k === 'title') { autoGrow(el); patchTaskDebounced(id, { title: el.value.replace(/\n/g, ' ') }); }
  else if (k === 'node') patchTaskDebounced(id, { title: el.value });
  else if (k === 'notes') patchTaskDebounced(id, { notes: el.value });
});
document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.dataset.set) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    M.saveSettings({ [el.dataset.set]: el.dataset.set === 'dayStart' ? Number(v) : v }); applySettings(); renderAll(); return;
  }
  if (el.dataset.act === 'importFile') { importFile(el.files[0]); el.value = ''; return; }
  if (el.dataset.act === 'photoUp') { uploadPhotos(el.dataset.id, [...el.files]); el.value = ''; return; }
  const k = el.dataset.in; if (!k) return;
  const id = el.dataset.id; const t = S.get('tasks', id); if (!t) return;
  switch (k) {
    case 'list': S.patch('tasks', id, { list_id: el.value || null }); break;
    case 'priority': S.patch('tasks', id, { priority: Number(el.value) }); break;
    case 'due_date': S.patch('tasks', id, { due_date: el.value || null }); break;
    case 'due_time': S.patch('tasks', id, { due_time: el.value || null, due_date: t.due_date || (el.value ? today() : null) }); break;
    case 'remind': S.patch('tasks', id, { remind: el.value === '' ? null : { offset_min: Number(el.value) }, due_date: t.due_date || (el.value !== '' ? today() : null) }); break;
    case 'repeatType': S.patch('tasks', id, { repeat: el.value ? { type: el.value, every: 1, days: el.value === 'weekly' ? [isoDow(t.due_date || today())] : el.value === 'monthly' ? [parseYmd(t.due_date || today()).getDate()] : [] } : null, due_date: t.due_date || (el.value ? today() : null) }); break;
    case 'repeatEvery': S.patch('tasks', id, { repeat: { ...t.repeat, every: Math.max(1, Number(el.value) || 1) } }); break;
    default: return;
  }
  renderAll();
});
document.addEventListener('keydown', (ev) => {
  const el = ev.target;
  if (ev.key === 'Escape') { if ($('.overlay')) { closeSheet(); return; } if (ui.openTask && !/INPUT|TEXTAREA/.test(el.tagName)) { A.closeTask(); return; } }
  if (el.dataset?.in === 'tag' && ev.key === 'Enter') {
    ev.preventDefault(); const v = el.value.trim().replace(/^#/, ''); if (!v) return;
    const t = S.get('tasks', el.dataset.id); if (!(t.tags || []).includes(v)) S.patch('tasks', t.id, { tags: [...(t.tags || []), v] });
    renderAll(); $(`[data-fk="tag:${t.id}"]`)?.focus(); return;
  }
  if (el.dataset?.in === 'title' && ev.key === 'Enter') { ev.preventDefault(); const first = M.childrenOf(el.dataset.id)[0]; if (first) focusNode(first.id); else A.addSub({ dataset: { id: el.dataset.id } }); return; }
  if (el.dataset?.in === 'node') {
    const t = S.get('tasks', el.dataset.id); if (!t) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const kids = M.childrenOf(t.id);
      const n = (kids.length && !t.collapsed) ? M.createTask({ parent_id: t.id, sort: (kids[0].sort || 1) - 1 }) : M.insertAfter(t);
      renderAll(); focusNode(n.id);
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      if (ev.shiftKey) { if (t.parent_id !== ui.openTask && M.outdent(t)) { renderAll(); focusNode(t.id); } }
      else if (M.indent(t)) { renderAll(); focusNode(t.id); }
    } else if (ev.key === 'Backspace' && el.value === '' && !M.childrenOf(t.id).length) {
      ev.preventDefault();
      const nodes = [...document.querySelectorAll('[data-in=node]')]; const i = nodes.indexOf(el);
      const prev = nodes[i - 1]?.dataset.id;
      S.remove('tasks', t.id); renderAll(); if (prev) focusNode(prev); else $('textarea[data-in=title]')?.focus();
    } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      const nodes = [...document.querySelectorAll('[data-in=node]')]; const i = nodes.indexOf(el);
      const nx = nodes[i + (ev.key === 'ArrowUp' ? -1 : 1)];
      if (nx) { ev.preventDefault(); nx.focus(); }
    }
    return;
  }
  // kısayollar (masaüstü)
  if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || ev.metaKey && ev.key !== 'k' || ev.ctrlKey && ev.key !== 'k') return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key === 'k' || ev.key === '/') { ev.preventDefault(); searchSheet(); }
  else if (ev.key === 'n' && !$('.overlay')) { const q = $('#quickInput'); if (q) { ev.preventDefault(); q.focus(); } }
});

async function importFile(file) {
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!obj || (!obj.tasks && !obj.lists)) throw new Error('biçim');
    const r = S.importAll(obj);
    renderAll();
    toast(`${r.lists} liste, ${r.tasks} görev, ${r.subs} alt görev, ${r.habits} alışkanlık aktarıldı`);
  } catch (e) { toast('Dosya okunamadı. Doğru dosyayı seçtiğinden emin ol.'); }
}
async function uploadPhotos(id, files) {
  if (!sb || !files.length) return;
  toast('Fotoğraf yükleniyor…');
  const added = [];
  for (const f of files) {
    try {
      const blob = await resizeImage(f);
      const path = `${S.state.user.id}/${id}/${uid()}.jpg`;
      const { error } = await sb.storage.from('ekler').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error; added.push(path);
    } catch (e) { toast('Fotoğraf yüklenemedi: ' + (e.message || '')); }
  }
  const t = S.get('tasks', id);
  if (added.length && t) { S.patch('tasks', id, { photos: [...(t.photos || []), ...added] }); renderDetail(); toast('Fotoğraf eklendi'); }
}

// ── Bildirim balonu ──────────────────────────────────────
let toastTimer;
function toast(msg, undo, action, actionLabel) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-u>Geri al</button>' : ''}${action ? `<button data-a>${esc(actionLabel || 'Aç')}</button>` : ''}`;
  document.body.appendChild(el);
  if (undo) el.querySelector('[data-u]').onclick = () => { undo(); el.remove(); };
  if (action) el.querySelector('[data-a]').onclick = () => { action(); el.remove(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), undo ? 5000 : 2600);
}

// ── Hatırlatmalar & rozet ────────────────────────────────
function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const c = M.dueCounts(); const n = c.overdue + c.today;
  try { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) { /* yok */ }
}
function fired(key) { try { const s = JSON.parse(localStorage.getItem('gorev:fired') || '{}'); if (s[key]) return true; s[key] = Date.now(); const lim = Date.now() - 3 * 86400000; Object.keys(s).forEach(k => { if (s[k] < lim) delete s[k]; }); localStorage.setItem('gorev:fired', JSON.stringify(s)); return false; } catch (e) { return true; } }
async function notify(title, body, tag) {
  if (('Notification' in window) && Notification.permission === 'granted') {
    try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) { reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }); return; } } catch (e) { /* yok */ }
    try { new Notification(title, { body, tag }); return; } catch (e) { /* yok */ }
  }
  toast(`${title}${body ? ' · ' + body : ''}`);
}
function checkReminders() {
  if (!S.state.user) return;
  const now = new Date(); const t = today(); const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  M.liveTasks().forEach(x => {
    if (x.done || !x.remind || x.remind.offset_min == null || !x.due_date) return;
    const [hh, mm] = (x.due_time || '09:00').split(':').map(Number);
    const due = parseYmd(x.due_date); due.setHours(hh, mm, 0, 0);
    const at = due.getTime() - x.remind.offset_min * 60000;
    if (now.getTime() >= at && now.getTime() - at < 6 * 3600000 && !fired(`t:${x.id}:${x.due_date}:${x.remind.offset_min}`)) {
      notify(x.title || 'Görev', `${prettyDate(x.due_date)}${x.due_time ? ' ' + x.due_time : ''}`, x.id);
    }
  });
  M.habits().forEach(h => {
    if (!M.scheduledOn(h, t) || M.habitDone(h, t)) return;
    (h.remind_times || []).forEach(rt => {
      if (rt <= hm && !fired(`h:${h.id}:${t}:${rt}`)) notify(h.name, `Bugün ${M.habitCount(h, t)}/${h.per_day || 1}`, 'h' + h.id);
    });
  });
}
setInterval(checkReminders, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); if (ui.booted) renderAll(); } });
setInterval(() => { if (ui.booted && !document.hidden && !document.activeElement?.matches('input,textarea')) { const d = today(); if (d !== ui._day) { ui._day = d; renderAll(); } } }, 60000);
ui._day = today();

// ── Servis çalışanı ──────────────────────────────────────
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* yok */ });
}

boot();
if (!sb) { /* yerel mod */ }
setTimeout(checkReminders, 3000);
