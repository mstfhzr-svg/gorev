// Veri katmanı: bellekte tutar, cihazda önbelleğe alır, Supabase ile senkronlar.
import { uid, nowIso } from './util.js';

export const TABLES = ['lists', 'tasks', 'task_log', 'habits', 'habit_logs', 'settings'];

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = (src) => listeners.forEach(fn => fn(src));

export const state = {
  user: null,          // {id, email}
  mode: 'cloud',       // 'cloud' | 'local'
  online: navigator.onLine,
  syncing: false,
  lastSync: null,
};
const data = Object.fromEntries(TABLES.map(t => [t, new Map()]));
export const all = (t) => [...data[t].values()];
export const get = (t, id) => data[t].get(id);

let sb = null;
let outbox = [];          // [{op:'upsert'|'delete', table, id, row?}]
let cacheKey = 'gorev:local';

// ── Önbellek ─────────────────────────────────────────────
function saveCache() {
  try {
    const dump = Object.fromEntries(TABLES.map(t => [t, all(t)]));
    localStorage.setItem(cacheKey, JSON.stringify({ dump, outbox, lastSync: state.lastSync }));
  } catch (e) { /* depolama dolu ya da kapalı */ }
}
function loadCache() {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return false;
    const { dump, outbox: ob, lastSync } = JSON.parse(raw);
    TABLES.forEach(t => { data[t].clear(); (dump[t] || []).forEach(r => data[t].set(r.id, r)); });
    outbox = ob || []; state.lastSync = lastSync || null;
    return true;
  } catch (e) { return false; }
}
const saveCacheSoon = (() => { let h; return () => { clearTimeout(h); h = setTimeout(saveCache, 250); }; })();

// ── Başlat ───────────────────────────────────────────────
export async function initCloud(client, user) {
  sb = client; state.mode = 'cloud'; state.user = user;
  cacheKey = `gorev:${user.id}`;
  loadCache();
  emit('cache');
  await pullAll();
  subscribeRealtime();
  flush();
}
export function initLocal() {
  sb = null; state.mode = 'local'; state.user = { id: 'local', email: 'Bu cihaz' };
  cacheKey = 'gorev:local';
  loadCache();
  emit('cache');
}
export function clearSession() {
  TABLES.forEach(t => data[t].clear()); outbox = []; state.user = null;
  if (channel && sb) sb.removeChannel(channel); channel = null;
}

// ── Sunucudan tümünü çek ─────────────────────────────────
export async function pullAll() {
  if (!sb || !state.online) return;
  state.syncing = true; emit('sync');
  try {
    const pending = new Set(outbox.map(o => o.table + ':' + o.id));
    for (const t of TABLES) {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await sb.from(t).select('*').range(from, from + 999);
        if (error) throw error;
        rows.push(...page);
        if (page.length < 1000) break;
      }
      const seen = new Set();
      rows.forEach(r => {
        seen.add(r.id);
        if (!pending.has(t + ':' + r.id)) data[t].set(r.id, r);
      });
      // sunucuda olmayan (başka cihazda kalıcı silinen) kayıtları kaldır
      [...data[t].keys()].forEach(id => { if (!seen.has(id) && !pending.has(t + ':' + id)) data[t].delete(id); });
    }
    state.lastSync = nowIso();
    saveCache();
  } catch (e) {
    console.warn('Senkron hatası', e);
  } finally {
    state.syncing = false; emit('pull');
  }
}

// ── Canlı senkron ────────────────────────────────────────
let channel = null;
function subscribeRealtime() {
  if (!sb) return;
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('gorev-' + state.user.id);
  TABLES.forEach(t => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `user_id=eq.${state.user.id}` }, (p) => {
      const pending = outbox.some(o => o.table === t && o.id === (p.new?.id || p.old?.id));
      if (pending) return;
      if (p.eventType === 'DELETE') data[t].delete(p.old.id);
      else {
        const cur = data[t].get(p.new.id);
        if (!cur || (cur.updated_at || '') <= (p.new.updated_at || '')) data[t].set(p.new.id, p.new);
      }
      saveCacheSoon(); emit('remote');
    });
  });
  channel.subscribe();
}

// ── Yazma ────────────────────────────────────────────────
export function put(table, row) {
  const r = { ...row };
  if (!r.id) r.id = uid();
  if (!r.created_at) r.created_at = nowIso();
  r.updated_at = nowIso();
  if (state.user && state.user.id !== 'local') r.user_id = state.user.id;
  data[table].set(r.id, r);
  queue({ op: 'upsert', table, id: r.id });
  return r;
}
export function patch(table, id, changes) {
  const cur = data[table].get(id); if (!cur) return null;
  return put(table, { ...cur, ...changes });
}
export function putMany(table, rows) { return rows.map(r => put(table, r)); }
export function remove(table, id) {
  data[table].delete(id);
  outbox = outbox.filter(o => !(o.table === table && o.id === id && o.op === 'upsert'));
  queue({ op: 'delete', table, id });
}
function queue(entry) {
  if (state.mode === 'local') { saveCacheSoon(); emit('local'); return; }
  outbox = outbox.filter(o => !(o.table === entry.table && o.id === entry.id && o.op === entry.op));
  outbox.push(entry);
  saveCacheSoon(); emit('local');
  flushSoon();
}

const flushSoon = (() => { let h; return () => { clearTimeout(h); h = setTimeout(flush, 400); }; })();
let flushing = false;
export async function flush() {
  if (!sb || flushing || !outbox.length || !state.online) return;
  flushing = true;
  try {
    // tabloya göre grupla; görevlerde üst görevler önce gitmeli
    const order = ['lists', 'habits', 'tasks', 'habit_logs', 'task_log', 'settings'];
    const batch = outbox.slice();
    for (const t of order) {
      const ups = batch.filter(o => o.table === t && o.op === 'upsert').map(o => data[t].get(o.id)).filter(Boolean);
      if (ups.length) {
        const rows = t === 'tasks' ? sortParentsFirst(ups) : ups;
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await sb.from(t).upsert(rows.slice(i, i + 500));
          if (error) throw error;
        }
      }
    }
    for (const t of [...order].reverse()) {
      const dels = batch.filter(o => o.table === t && o.op === 'delete').map(o => o.id);
      if (dels.length) {
        const { error } = await sb.from(t).delete().in('id', dels);
        if (error) throw error;
      }
    }
    const sent = new Set(batch);
    outbox = outbox.filter(o => !sent.has(o));
    state.lastSync = nowIso();
    saveCache(); emit('flushed');
  } catch (e) {
    console.warn('Gönderilemedi, sonra tekrar denenecek', e);
    state.lastError = e.message || String(e);
    emit('error');
    setTimeout(flush, 15000);
  } finally {
    flushing = false;
    if (outbox.length) flushSoon();
  }
}
function sortParentsFirst(rows) {
  const ids = new Set(rows.map(r => r.id));
  const depth = (r) => { let d = 0, p = r.parent_id; while (p && ids.has(p) && d < 100) { d++; p = data.tasks.get(p)?.parent_id; } return d; };
  return rows.slice().sort((a, b) => depth(a) - depth(b));
}
export const pendingCount = () => outbox.length;

window.addEventListener('online', () => { state.online = true; emit('net'); flush(); pullAll(); });
window.addEventListener('offline', () => { state.online = false; emit('net'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && sb) { pullAll(); flush(); } });

// ── Dışa / içe aktarma ───────────────────────────────────
export function exportAll() {
  return { app: 'gorev', version: 1, exported_at: nowIso(), ...Object.fromEntries(TABLES.map(t => [t, all(t)])) };
}
// Kimlikleri yenileyerek ekler (mevcut verinin üstüne yazmaz)
export function importAll(obj) {
  const map = new Map();
  const nid = (old) => { if (!old) return old; if (!map.has(old)) map.set(old, uid()); return map.get(old); };
  const strip = (r) => { const c = { ...r }; delete c.user_id; return c; };
  (obj.lists || []).forEach(r => put('lists', { ...strip(r), id: nid(r.id) }));
  (obj.habits || []).forEach(r => put('habits', { ...strip(r), id: nid(r.id) }));
  const tasks = (obj.tasks || []).map(r => ({ ...strip(r), id: nid(r.id), parent_id: nid(r.parent_id), list_id: r.list_id ? nid(r.list_id) : null }));
  sortParentsFirst(tasks).forEach(r => put('tasks', r));
  (obj.habit_logs || []).forEach(r => put('habit_logs', { ...strip(r), id: uid(), habit_id: nid(r.habit_id) }));
  (obj.task_log || []).forEach(r => put('task_log', { ...strip(r), id: uid(), task_id: r.task_id ? nid(r.task_id) : null, list_id: r.list_id ? nid(r.list_id) : null }));
  return { lists: (obj.lists || []).length, tasks: tasks.length, habits: (obj.habits || []).length };
}
