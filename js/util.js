// Yardımcılar: tarih, metin, ayrıştırma
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  }));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const lower = (s) => String(s ?? '').toLocaleLowerCase('tr');

export const nowIso = () => new Date().toISOString();

// ── Tarih (yerel, 'YYYY-MM-DD') ─────────────────────────
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const diffDays = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
// Pazartesi=1 … Pazar=7
export const isoDow = (s) => { const g = parseYmd(s).getDay(); return g === 0 ? 7 : g; };

let dayStartHour = 0;
export const setDayStart = (h) => { dayStartHour = Number(h) || 0; };
export const today = () => {
  const d = new Date();
  if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
  return ymd(d);
};

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
export const DAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export function prettyDate(s, withYear = false) {
  if (!s) return '';
  const t = today();
  const dd = diffDays(t, s);
  if (dd === 0) return 'Bugün';
  if (dd === 1) return 'Yarın';
  if (dd === -1) return 'Dün';
  const d = parseYmd(s);
  let out = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (withYear || d.getFullYear() !== parseYmd(t).getFullYear()) out += ` ${d.getFullYear()}`;
  if (dd > 1 && dd < 7) out = `${DAYS[isoDow(s) - 1]}`;
  return out;
}
export function longToday() {
  const t = today(); const d = parseYmd(t);
  return `${DAYS[isoDow(t) - 1]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export const endOfWeek = (s) => addDays(s, 7 - isoDow(s));

// ── Tekrar: bir sonraki tarih ────────────────────────────
// repeat: {type:'daily'|'weekly'|'monthly'|'yearly'|'interval', every:n, days:[...]}
export function nextOccurrence(repeat, from) {
  if (!repeat || !repeat.type) return null;
  const every = Math.max(1, Number(repeat.every) || 1);
  const days = (repeat.days || []).map(Number).filter(Boolean).sort((a, b) => a - b);
  switch (repeat.type) {
    case 'daily': return addDays(from, every);
    case 'interval': return addDays(from, every);
    case 'weekly': {
      if (!days.length) return addDays(from, 7 * every);
      for (let i = 1; i <= 7 * every + 7; i++) {
        const c = addDays(from, i);
        const weeksApart = Math.floor((diffDays(mondayOf(from), mondayOf(c))) / 7);
        if (days.includes(isoDow(c)) && (weeksApart === 0 || weeksApart % every === 0)) return c;
      }
      return addDays(from, 7);
    }
    case 'monthly': {
      const d = parseYmd(from);
      const wanted = days.length ? days : [d.getDate()];
      // aynı ay içinde sonraki gün
      for (const w of wanted) {
        if (w > d.getDate()) {
          const c = clampDay(d.getFullYear(), d.getMonth(), w);
          if (c > from) return c;
        }
      }
      const nm = new Date(d.getFullYear(), d.getMonth() + every, 1);
      return clampDay(nm.getFullYear(), nm.getMonth(), wanted[0]);
    }
    case 'yearly': {
      const d = parseYmd(from);
      return clampDay(d.getFullYear() + every, d.getMonth(), d.getDate());
    }
  }
  return null;
}
const mondayOf = (s) => addDays(s, 1 - isoDow(s));
function clampDay(y, m, day) {
  const last = new Date(y, m + 1, 0).getDate();
  return ymd(new Date(y, m, Math.min(day, last)));
}
export function repeatLabel(r) {
  if (!r || !r.type) return 'Tekrar yok';
  const e = Number(r.every) || 1;
  const days = r.days || [];
  switch (r.type) {
    case 'daily': return e === 1 ? 'Her gün' : `${e} günde bir`;
    case 'interval': return `${e} günde bir`;
    case 'weekly': {
      const names = days.map(d => DAYS_SHORT[d - 1]).join(', ');
      return (e === 1 ? 'Her hafta' : `${e} haftada bir`) + (names ? ` · ${names}` : '');
    }
    case 'monthly': return (e === 1 ? 'Her ay' : `${e} ayda bir`) + (days.length ? ` · ${days.join(', ')}. gün` : '');
    case 'yearly': return 'Her yıl';
  }
  return 'Tekrar';
}

// Tekrarlayan bir görevin [from, to] aralığındaki tarihleri (takvim için)
export function occurrencesBetween(task, from, to, max = 62) {
  const out = [];
  if (!task.due_date) return out;
  let d = task.due_date;
  let guard = 0;
  while (d && d <= to && guard++ < 400 && out.length < max) {
    if (d >= from) out.push(d);
    if (!task.repeat) break;
    d = nextOccurrence(task.repeat, d);
  }
  return out;
}

// ── Hızlı yazım ayrıştırıcı ──────────────────────────────
// "yarın 10:00 kasa kontrolü #İş !!" → {title, due_date, due_time, list, tags, priority, repeat}
const TR_MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
const TR_DAYS = ['pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar'];

export function parseQuick(text, lists) {
  let s = ' ' + text.trim() + ' ';
  const out = { title: '', due_date: null, due_time: null, list_id: null, tags: [], priority: 0, repeat: null };
  const t = today();
  const take = (re, fn) => { s = s.replace(re, (...m) => { fn(...m); return ' '; }); };

  take(/\s!(yüksek|orta|düşük)(?=\s)/i, (_, p) => { out.priority = { 'yüksek': 3, 'orta': 2, 'düşük': 1 }[lower(p)]; });
  take(/\s(!{1,3})(?=\s)/, (_, p) => { out.priority = p.length; });
  take(/\sher\s+(gün|hafta|ay|yıl)(?=\s)/i, (_, p) => {
    out.repeat = { type: { 'gün': 'daily', 'hafta': 'weekly', 'ay': 'monthly', 'yıl': 'yearly' }[lower(p)], every: 1, days: [] };
  });
  take(/\s(?:saat\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s)/i, (_, h, m) => { out.due_time = `${pad(h)}:${m}`; });
  take(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s)/, (_, d, m, y) => {
    let yy = y ? Number(y) : parseYmd(t).getFullYear(); if (yy < 100) yy += 2000;
    let c = ymd(new Date(yy, Number(m) - 1, Number(d)));
    if (!y && c < t) c = ymd(new Date(yy + 1, Number(m) - 1, Number(d)));
    out.due_date = c;
  });
  take(new RegExp(`\\s(\\d{1,2})\\s+(${TR_MONTHS.join('|')})(?=\\s)`, 'i'), (_, d, mn) => {
    const m = TR_MONTHS.indexOf(lower(mn)); let yy = parseYmd(t).getFullYear();
    let c = ymd(new Date(yy, m, Number(d))); if (c < t) c = ymd(new Date(yy + 1, m, Number(d)));
    out.due_date = c;
  });
  take(/\s(bugün|yarın|öbür\s?gün|ertesi\s?gün|haftaya)(?=\s)/i, (_, w) => {
    const k = lower(w).replace(/\s/g, '');
    out.due_date = addDays(t, { 'bugün': 0, 'yarın': 1, 'öbürgün': 2, 'ertesigün': 2, 'haftaya': 7 }[k]);
  });
  take(new RegExp(`\\s(${TR_DAYS.join('|')})(?=\\s)`, 'i'), (_, w) => {
    const want = TR_DAYS.indexOf(lower(w)) + 1; const cur = isoDow(t);
    out.due_date = addDays(t, (want - cur + 7) % 7);
  });
  take(/\s#([^\s#]+)/g, (_, tag) => {
    const l = (lists || []).find(x => lower(x.name).replace(/\s/g, '') === lower(tag));
    if (l && !out.list_id) out.list_id = l.id; else out.tags.push(tag);
  });
  if (out.due_time && !out.due_date) out.due_date = t;
  if (out.repeat && !out.due_date) out.due_date = t;
  out.title = s.replace(/\s+/g, ' ').trim();
  return out;
}

export function debounce(fn, ms) {
  let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
}
