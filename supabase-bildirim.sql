-- Görev · telefon bildirimleri kurulumu
-- Supabase → SQL Editor → New query → bu dosyanın tamamını yapıştır → Run (gelirse "Run and enable RLS")
-- Tekrar çalıştırmak güvenlidir.

-- Bildirim alacak cihazlar
create table if not exists public.push_subs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  device     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "sahibi" on public.push_subs;
create policy "sahibi" on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- "Deneme bildirimi gönder" istekleri
create table if not exists public.push_test (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.push_test enable row level security;
drop policy if exists "sahibi ekler" on public.push_test;
create policy "sahibi ekler" on public.push_test for insert to authenticated with check (user_id = auth.uid());

-- Aynı hatırlatmanın iki kez gitmemesi için (sadece sunucu kullanır)
create table if not exists public.push_sent (
  key        text primary key,
  created_at timestamptz not null default now()
);
alter table public.push_sent enable row level security;

-- Bildirim anahtarları: sunucu ilk çalıştığında kendisi üretir.
-- Uygulama sadece herkese açık anahtarı okuyabilir, gizli anahtarı kimse göremez.
create table if not exists public.push_config (
  id            int primary key,
  vapid_public  text not null,
  vapid_private text not null,
  created_at    timestamptz not null default now()
);
alter table public.push_config enable row level security;
drop policy if exists "acik anahtar okunur" on public.push_config;
create policy "acik anahtar okunur" on public.push_config for select to authenticated using (true);
revoke all on public.push_config from anon, authenticated;
grant select (id, vapid_public) on public.push_config to authenticated;

-- Her dakika hatırlatmaları kontrol eden zamanlayıcı
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'gorev-hatirlatma';
select cron.schedule(
  'gorev-hatirlatma',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://bzbntlmptbmcvbnleqdp.supabase.co/functions/v1/hatirlatma',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
