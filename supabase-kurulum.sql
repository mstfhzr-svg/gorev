-- Görev uygulaması · Supabase veritabanı kurulumu
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run
-- Tekrar çalıştırmak güvenlidir (var olanları bozmaz).

create extension if not exists pgcrypto;

-- ── Listeler ─────────────────────────────────────────────
create table if not exists public.lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '',
  color       text not null default '#5B7FD1',
  hidden_home boolean not null default false,
  sort        double precision not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Görevler (parent_id ile sınırsız alt görev ağacı) ────
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id     uuid references public.lists(id) on delete set null,
  parent_id   uuid references public.tasks(id) on delete cascade,
  title       text not null default '',
  notes       text not null default '',
  due_date    date,
  due_time    text,
  priority    smallint not null default 0,          -- 0 yok, 1 düşük, 2 orta, 3 yüksek
  tags        text[] not null default '{}',
  repeat      jsonb,                                 -- {type:'daily'|'weekly'|'monthly'|'yearly'|'interval', every, days}
  remind      jsonb,                                 -- {offset_min} ya da {at}
  photos      text[] not null default '{}',          -- depolama yolları
  done        boolean not null default false,
  done_at     timestamptz,
  collapsed   boolean not null default false,
  sort        double precision not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_user_idx   on public.tasks(user_id);
create index if not exists tasks_parent_idx on public.tasks(parent_id);

-- ── Görev günlüğü (tamamlananların geçmişi) ──────────────
create table if not exists public.task_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id    uuid,
  title      text not null default '',
  path       text not null default '',
  list_id    uuid,
  done_at    timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Alışkanlıklar ────────────────────────────────────────
create table if not exists public.habits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null default '',
  color        text not null default '#DF5830',
  icon         text not null default 'star',
  period       jsonb not null default '{"type":"daily"}',  -- daily | weekly{days} | monthly{days} | interval{every}
  per_day      integer not null default 1,
  remind_times text[] not null default '{}',
  start_date   date not null default current_date,
  archived     boolean not null default false,
  sort         double precision not null default 0,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id   uuid not null references public.habits(id) on delete cascade,
  day        date not null,
  count      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, day)
);

-- ── Ayarlar ──────────────────────────────────────────────
create table if not exists public.settings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Güvenlik: herkes yalnızca kendi verisini görür ───────
do $$
declare t text;
begin
  foreach t in array array['lists','tasks','task_log','habits','habit_logs','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "sahibi" on public.%I', t);
    execute format('create policy "sahibi" on public.%I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    -- canlı senkron (telefon ↔ Mac)
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ── Fotoğraflar için özel depolama alanı ─────────────────
insert into storage.buckets (id, name, public)
values ('ekler', 'ekler', false)
on conflict (id) do nothing;

drop policy if exists "ekler sahibi okur"  on storage.objects;
drop policy if exists "ekler sahibi yazar" on storage.objects;
drop policy if exists "ekler sahibi siler" on storage.objects;
create policy "ekler sahibi okur" on storage.objects for select to authenticated
  using (bucket_id = 'ekler' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ekler sahibi yazar" on storage.objects for insert to authenticated
  with check (bucket_id = 'ekler' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ekler sahibi siler" on storage.objects for delete to authenticated
  using (bucket_id = 'ekler' and (storage.foldername(name))[1] = auth.uid()::text);
