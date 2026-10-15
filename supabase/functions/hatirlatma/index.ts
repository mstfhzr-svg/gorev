// Görev · hatırlatma fonksiyonu (Supabase Edge Function)
// Her dakika zamanlayıcı tarafından çağrılır; zamanı gelen görev ve alışkanlık
// hatırlatmalarını telefona/bilgisayara bildirim olarak gönderir.
import postgres from 'npm:postgres@3.4.5';
import webpush from 'npm:web-push@3.6.7';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Zaman yardımcıları ──────────────────────────────────
function localNow(tz: string) {
  let parts: Record<string, string>;
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    parts = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  } catch { return localNow('Europe/Istanbul'); }
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}
const toMin = (date: string, hm: string) => {
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = hm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) / 60000;
};
const isoDow = (date: string) => { const [y, m, d] = date.split('-').map(Number); const g = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return g === 0 ? 7 : g; };
const dayDiff = (a: string, b: string) => Math.round((toMin(b, '00:00') - toMin(a, '00:00')) / 1440);

type Habit = { id: string; user_id: string; name: string; period: { type?: string; days?: number[]; every?: number }; per_day: number; remind_times: string[]; start_date: string };
function scheduledOn(h: Habit, day: string) {
  if (h.start_date && day < h.start_date) return false;
  const p = h.period || { type: 'daily' };
  switch (p.type) {
    case 'weekly': return !p.days?.length || p.days.includes(isoDow(day));
    case 'monthly': return !p.days?.length || p.days.includes(Number(day.slice(8, 10)));
    case 'interval': return dayDiff(h.start_date || day, day) % Math.max(1, p.every || 1) === 0;
    default: return true;
  }
}
function remindLabel(offset: number, dueTime: string | null) {
  if (offset === 0) return dueTime ? `Saat ${dueTime}` : 'Şimdi';
  if (offset === 15) return '15 dakika sonra';
  if (offset === 60) return '1 saat sonra';
  if (offset === 1440) return dueTime ? `Yarın ${dueTime}` : 'Yarın';
  return `${offset} dakika sonra`;
}

const WINDOW = 15; // dakika: geciken çalışmalarda da kaçırmamak için

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // Anahtarlar yoksa üret (bir kez)
    let [cfg] = await sql`select vapid_public, vapid_private from public.push_config where id = 1`;
    if (!cfg) {
      const k = webpush.generateVAPIDKeys();
      await sql`insert into public.push_config (id, vapid_public, vapid_private) values (1, ${k.publicKey}, ${k.privateKey}) on conflict (id) do nothing`;
      [cfg] = await sql`select vapid_public, vapid_private from public.push_config where id = 1`;
    }
    webpush.setVapidDetails('https://mstfhzr-svg.github.io/gorev/', cfg.vapid_public, cfg.vapid_private);

    const subs = await sql`select id, user_id, endpoint, p256dh, auth from public.push_subs`;
    if (!subs.length) return json({ ok: true, subs: 0 });
    const users = [...new Set(subs.map((s) => s.user_id as string))];

    const tz = new Map<string, string>();
    (await sql`select user_id, data->>'tz' as tz from public.settings where user_id in ${sql(users)}`).forEach((r) => tz.set(r.user_id, r.tz || 'Europe/Istanbul'));
    const nowOf = (u: string) => localNow(tz.get(u) || 'Europe/Istanbul');

    const items: { user_id: string; key: string | null; title: string; body: string; tag: string }[] = [];

    // Deneme bildirimleri
    (await sql`delete from public.push_test where user_id in ${sql(users)} returning user_id`).forEach((t) =>
      items.push({ user_id: t.user_id, key: null, title: 'Görev', body: 'Bildirimler çalışıyor ✓', tag: 'test' }));

    // Görev hatırlatmaları
    const tasks = await sql`
      select id, user_id, title, due_date::text as due_date, due_time, (remind->>'offset_min')::int as off
      from public.tasks
      where remind is not null and remind ? 'offset_min' and done = false and deleted_at is null
        and due_date between current_date - 2 and current_date + 3 and user_id in ${sql(users)}`;
    for (const t of tasks) {
      const n = nowOf(t.user_id); const now = toMin(n.date, n.hm);
      const at = toMin(t.due_date, t.due_time || '09:00') - (t.off || 0);
      if (now >= at && now - at < WINDOW) {
        items.push({ user_id: t.user_id, key: `t:${t.id}:${t.due_date}:${t.off}`, title: t.title || 'Görev', body: remindLabel(t.off || 0, t.due_time), tag: t.id });
      }
    }

    // Alışkanlık hatırlatmaları
    const habits = await sql<Habit[]>`
      select id, user_id, name, period, per_day, remind_times, start_date::text as start_date
      from public.habits
      where deleted_at is null and archived = false and cardinality(remind_times) > 0 and user_id in ${sql(users)}`;
    if (habits.length) {
      const logs = await sql`select habit_id, day::text as day, count from public.habit_logs
        where day between current_date - 1 and current_date + 1 and habit_id in ${sql(habits.map((h) => h.id))}`;
      const cnt = new Map(logs.map((l) => [`${l.habit_id}:${l.day}`, l.count as number]));
      for (const h of habits) {
        const n = nowOf(h.user_id); const now = toMin(n.date, n.hm);
        if (!scheduledOn(h, n.date)) continue;
        const c = cnt.get(`${h.id}:${n.date}`) || 0; const per = h.per_day || 1;
        if (c >= per) continue;
        for (const rt of h.remind_times) {
          if (!/^\d{2}:\d{2}$/.test(rt)) continue;
          const at = toMin(n.date, rt);
          if (now >= at && now - at < WINDOW) {
            items.push({ user_id: h.user_id, key: `h:${h.id}:${n.date}:${rt}`, title: h.name, body: per > 1 ? `Bugün ${c}/${per}` : 'Bugün henüz yapılmadı', tag: 'h' + h.id });
          }
        }
      }
    }

    // Daha önce gönderilenleri ele
    const keyed = items.filter((i) => i.key);
    let fresh = new Set<string>();
    if (keyed.length) {
      const rows = await sql`insert into public.push_sent ${sql(keyed.map((i) => ({ key: i.key })))} on conflict (key) do nothing returning key`;
      fresh = new Set(rows.map((r) => r.key as string));
    }
    const toSend = items.filter((i) => !i.key || fresh.has(i.key));

    let sent = 0; const dead: string[] = [];
    for (const it of toSend) {
      for (const s of subs.filter((x) => x.user_id === it.user_id)) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: it.title, body: it.body, tag: it.tag, url: './' }),
            { TTL: 3600, urgency: 'high' },
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dead.push(s.id);
          else console.error('gönderilemedi', code, (e as Error).message);
        }
      }
    }
    if (dead.length) await sql`delete from public.push_subs where id in ${sql(dead)}`;
    await sql`delete from public.push_sent where created_at < now() - interval '7 days'`;
    return json({ ok: true, candidates: items.length, sent, removed: dead.length });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
