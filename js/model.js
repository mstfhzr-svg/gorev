// İş kuralları: görev ağacı, gruplar, tamamlama, tekrar, alışkanlıklar
import { all, get, put, patch, remove } from './store.js';
import { today, addDays, diffDays, isoDow, parseYmd, nextOccurrence, endOfWeek, nowIso, ymd } from './util.js';

// ── Ayarlar ──────────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  theme: 'auto',            // auto | light | dark
  accent: '#DF5830',
  dayStart: 0,
  autoCompleteParent: true, // tüm alt görevler bitince üst görev biter
  completeChildren: true,   // üst görev bitince alt görevler de biter
  showHabitsHome: true,
  showCompleted: true,
  habitOrder: [],
};
export function settings() {
  const row = all('settings')[0];
  return { ...DEFAULT_SETTINGS, ...(row?.data || {}) };
}
export function saveSettings(changes) {
  const row = all('settings')[0];
  const data = { ...settings(), ...changes };
  if (row) patch('settings', row.id, { data }); else put('settings', { data });
}

// ── Listeler ─────────────────────────────────────────────
export const PALETTE = ['#5B7FD1', '#8B7BD8', '#C2457A', '#C99A2E', '#3E9A86', '#6C9B3C', '#C9471F',
  '#D9822B', '#4D6CB0', '#8A6A50', '#B5559C', '#5C9DB5', '#7A8B3E', '#9B4FB0',
  '#A33A2E', '#B06A63', '#3F3D6B', '#B0805A', '#9C962E', '#8C8C8C', '#2F6F5E'];
export const lists = () => all('lists').filter(l => !l.deleted_at).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
export const listById = (id) => id ? get('lists', id) : null;

// ── Görev ağacı ──────────────────────────────────────────
export const liveTasks = () => all('tasks').filter(t => !t.deleted_at);
export function childrenOf(id, { includeDeleted = false } = {}) {
  return all('tasks').filter(t => t.parent_id === id && (includeDeleted || !t.deleted_at))
    .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
}
export function descendants(id) {
  const out = []; const walk = (pid) => childrenOf(pid).forEach(c => { out.push(c); walk(c.id); });
  walk(id); return out;
}
export function ancestors(task) {
  const out = []; let p = task?.parent_id; let g = 0;
  while (p && g++ < 100) { const t = get('tasks', p); if (!t) break; out.unshift(t); p = t.parent_id; }
  return out;
}
export const rootOf = (task) => ancestors(task)[0] || task;
export const taskList = (task) => listById(rootOf(task).list_id);
export function progress(id) {
  const d = descendants(id);
  return { done: d.filter(t => t.done).length, total: d.length };
}
export function childProgress(id) {
  const c = childrenOf(id);
  return { done: c.filter(t => t.done).length, total: c.length };
}
export function nextSort(parentId, listId) {
  const sibs = all('tasks').filter(t => (t.parent_id || null) === (parentId || null) && (parentId || t.list_id === listId) && !t.deleted_at);
  return sibs.length ? Math.max(...sibs.map(s => s.sort || 0)) + 1 : 1;
}

export function createTask(fields) {
  const parent = fields.parent_id ? get('tasks', fields.parent_id) : null;
  const row = {
    title: '', notes: '', due_date: null, due_time: null, priority: 0, tags: [], repeat: null, remind: null,
    photos: [], done: false, done_at: null, collapsed: false, deleted_at: null,
    list_id: parent ? null : (fields.list_id ?? null), parent_id: null,
    ...fields,
  };
  if (row.sort == null) row.sort = nextSort(row.parent_id, row.list_id);
  if (parent && parent.done) patch('tasks', parent.id, { done: false, done_at: null });
  return put('tasks', row);
}

// Kardeşin hemen altına ekle
export function insertAfter(sibling, fields = {}) {
  const sibs = childrenOf(sibling.parent_id || null).filter(s => (sibling.parent_id || s.list_id === sibling.list_id));
  const idx = sibs.findIndex(s => s.id === sibling.id);
  const next = sibs[idx + 1];
  const sort = next ? (sibling.sort + next.sort) / 2 : sibling.sort + 1;
  return createTask({ parent_id: sibling.parent_id, list_id: sibling.parent_id ? null : sibling.list_id, sort, ...fields });
}

export function indent(task) {
  const sibs = siblings(task);
  const idx = sibs.findIndex(s => s.id === task.id);
  if (idx <= 0) return false;
  const newParent = sibs[idx - 1];
  patch('tasks', task.id, { parent_id: newParent.id, list_id: null, sort: nextSort(newParent.id) });
  if (newParent.collapsed) patch('tasks', newParent.id, { collapsed: false });
  if (newParent.done && !task.done) patch('tasks', newParent.id, { done: false, done_at: null });
  return true;
}
export function outdent(task) {
  const parent = task.parent_id ? get('tasks', task.parent_id) : null;
  if (!parent) return false;
  const grand = parent.parent_id || null;
  const sibs = childrenOf(grand).filter(s => grand || s.list_id === parent.list_id);
  const idx = sibs.findIndex(s => s.id === parent.id);
  const next = sibs[idx + 1];
  const sort = next ? (parent.sort + next.sort) / 2 : parent.sort + 1;
  patch('tasks', task.id, { parent_id: grand, list_id: grand ? null : parent.list_id, sort });
  return true;
}
export function siblings(task) {
  return childrenOf(task.parent_id || null).filter(s => task.parent_id || s.list_id === task.list_id);
}
export function move(task, dir) {
  const sibs = siblings(task);
  const idx = sibs.findIndex(s => s.id === task.id);
  const j = idx + dir;
  if (j < 0 || j >= sibs.length) return false;
  const other = sibs[j];
  patch('tasks', task.id, { sort: other.sort });
  patch('tasks', other.id, { sort: task.sort === other.sort ? task.sort - dir : task.sort });
  return true;
}
export function moveTo(task, newParentId, listId) {
  if (newParentId === task.id || descendants(task.id).some(d => d.id === newParentId)) return false;
  patch('tasks', task.id, { parent_id: newParentId || null, list_id: newParentId ? null : (listId ?? null), sort: nextSort(newParentId, listId) });
  return true;
}

// ── Tamamlama ────────────────────────────────────────────
export function logDone(task) {
  const path = ancestors(task).map(a => a.title).join(' › ');
  put('task_log', { task_id: task.id, title: task.title, path, list_id: rootOf(task).list_id || null, done_at: nowIso() });
}
export function setDone(task, done) {
  const s = settings();
  if (done) {
    logDone(task);
    if (task.repeat && task.repeat.type) {
      // tekrarlayan: bir sonraki tarihe taşı, ağacı sıfırla
      const base = task.due_date || today();
      let next = nextOccurrence(task.repeat, base);
      const t = today();
      let guard = 0;
      while (next && next <= t && guard++ < 1000) next = nextOccurrence(task.repeat, next);
      patch('tasks', task.id, { due_date: next, done: false, done_at: null });
      descendants(task.id).forEach(d => { if (d.done) patch('tasks', d.id, { done: false, done_at: null }); });
      return 'repeat';
    }
    patch('tasks', task.id, { done: true, done_at: nowIso() });
    if (s.completeChildren) descendants(task.id).forEach(d => { if (!d.done) patch('tasks', d.id, { done: true, done_at: nowIso() }); });
    // üst görevi otomatik bitir
    if (s.autoCompleteParent && task.parent_id) {
      const p = get('tasks', task.parent_id);
      if (p && !p.done && childrenOf(p.id).every(c => c.done)) setDone(p, true);
    }
    return 'done';
  } else {
    patch('tasks', task.id, { done: false, done_at: null });
    ancestors(task).forEach(a => { if (a.done) patch('tasks', a.id, { done: false, done_at: null }); });
    return 'undone';
  }
}

// ── Çöp kutusu ───────────────────────────────────────────
export function trash(task) {
  const stamp = nowIso();
  [task, ...descendants(task.id)].forEach(t => patch('tasks', t.id, { deleted_at: stamp }));
}
export function restore(task) {
  const stamp = task.deleted_at;
  const all_ = [task];
  const walk = (pid) => childrenOfAny(pid).forEach(c => { if (c.deleted_at === stamp) { all_.push(c); walk(c.id); } });
  walk(task.id);
  all_.forEach(t => patch('tasks', t.id, { deleted_at: null }));
  // üst görev silindiyse ana seviyeye taşı
  if (task.parent_id) { const p = get('tasks', task.parent_id); if (!p || p.deleted_at) patch('tasks', task.id, { parent_id: null, list_id: p ? rootOf(p).list_id : null }); }
}
const childrenOfAny = (id) => all('tasks').filter(t => t.parent_id === id);
export function trashedRoots() {
  return all('tasks').filter(t => t.deleted_at && !(t.parent_id && get('tasks', t.parent_id)?.deleted_at === t.deleted_at))
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}
export function purge(task) {
  const ids = [task.id]; const walk = (pid) => childrenOfAny(pid).forEach(c => { ids.push(c.id); walk(c.id); });
  walk(task.id);
  ids.reverse().forEach(id => remove('tasks', id));
}
export function autoPurge(days = 30) {
  const lim = new Date(Date.now() - days * 86400000).toISOString();
  trashedRoots().filter(t => t.deleted_at < lim).forEach(purge);
}

// ── Ana ekran grupları ───────────────────────────────────
export function visibleForGroups({ listId = null } = {}) {
  const hidden = new Set(lists().filter(l => l.hidden_home).map(l => l.id));
  return liveTasks().filter(t => {
    if (t.parent_id) {
      // alt görev: sadece kendi tarihi varsa gösterilir
      if (!t.due_date || t.done) return false;
      const root = rootOf(t);
      if (listId) return root.list_id === listId;
      return !hidden.has(root.list_id);
    }
    if (listId) return t.list_id === listId;
    return !hidden.has(t.list_id);
  });
}
export function timeGroups(tasks) {
  const t = today(); const tm = addDays(t, 1); const eow = endOfWeek(t);
  const weekEnd = eow <= tm ? addDays(t, 7) : eow;
  const g = { overdue: [], today: [], tomorrow: [], week: [], later: [], done: [] };
  tasks.forEach(x => {
    if (x.done) { if (!x.parent_id && x.done_at && x.done_at.slice(0, 10) >= addDays(t, -1)) g.done.push(x); return; }
    if (!x.due_date) g.later.push(x);
    else if (x.due_date < t) g.overdue.push(x);
    else if (x.due_date === t) g.today.push(x);
    else if (x.due_date === tm) g.tomorrow.push(x);
    else if (x.due_date <= weekEnd) g.week.push(x);
    else g.later.push(x);
  });
  const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.due_time || '99').localeCompare(b.due_time || '99') || b.priority - a.priority || a.sort - b.sort;
  Object.values(g).forEach(arr => arr.sort(byDue));
  return g;
}
export function dueCounts() {
  const t = today();
  const v = visibleForGroups().filter(x => !x.done && x.due_date && x.due_date <= t);
  return { overdue: v.filter(x => x.due_date < t).length, today: v.filter(x => x.due_date === t).length };
}

// ── Alışkanlıklar ────────────────────────────────────────
export const habits = () => all('habits').filter(h => !h.deleted_at && !h.archived).sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
export function scheduledOn(h, day) {
  if (day < (h.start_date || '0000')) return false;
  const p = h.period || { type: 'daily' };
  switch (p.type) {
    case 'weekly': return !(p.days?.length) || p.days.includes(isoDow(day));
    case 'monthly': return !(p.days?.length) || p.days.includes(parseYmd(day).getDate());
    case 'interval': return diffDays(h.start_date || day, day) % Math.max(1, p.every || 1) === 0;
    default: return true;
  }
}
const logKey = (hid, day) => all('habit_logs').find(l => l.habit_id === hid && l.day === day);
export const habitCount = (h, day) => logKey(h.id, day)?.count || 0;
export function setHabitCount(h, day, count) {
  const c = Math.max(0, Math.min(count, (h.per_day || 1) * 3));
  const cur = logKey(h.id, day);
  if (cur) patch('habit_logs', cur.id, { count: c });
  else put('habit_logs', { habit_id: h.id, day, count: c });
}
export function habitDone(h, day) { return habitCount(h, day) >= (h.per_day || 1); }
export function streak(h) {
  let d = today(); let n = 0; let guard = 0;
  if (scheduledOn(h, d) && !habitDone(h, d)) d = addDays(d, -1);
  while (guard++ < 2000) {
    if (d < (h.start_date || '0000')) break;
    if (scheduledOn(h, d)) { if (habitDone(h, d)) n++; else break; }
    d = addDays(d, -1);
  }
  return n;
}
export function monthRate(h) {
  const t = today(); const first = t.slice(0, 8) + '01';
  let sched = 0, ok = 0;
  for (let d = first; d <= t; d = addDays(d, 1)) {
    if (!scheduledOn(h, d)) continue;
    if (d === t && !habitDone(h, d)) continue;
    sched++; if (habitDone(h, d)) ok++;
  }
  return sched ? Math.round(ok / sched * 100) : null;
}
export function weekRate() {
  const t = today(); const mon = addDays(t, 1 - isoDow(t));
  let sched = 0, ok = 0;
  habits().forEach(h => { for (let d = mon; d <= t; d = addDays(d, 1)) { if (!scheduledOn(h, d)) continue; sched++; if (habitDone(h, d)) ok++; } });
  return sched ? Math.round(ok / sched * 100) : null;
}
export function periodLabel(h) {
  const p = h.period || { type: 'daily' };
  const D = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  switch (p.type) {
    case 'weekly': return p.days?.length === 5 && [1, 2, 3, 4, 5].every(x => p.days.includes(x)) ? 'Hafta içi' : (p.days?.length ? p.days.map(d => D[d - 1]).join(', ') : 'Her hafta');
    case 'monthly': return p.days?.length ? `Ayın ${p.days.join(', ')}. günü` : 'Her ay';
    case 'interval': return `${p.every || 1} günde bir`;
    default: return 'Her gün';
  }
}

export { ymd };
