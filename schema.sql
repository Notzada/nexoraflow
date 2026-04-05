-- ============================================
-- NEXORAFLOW v3.0 — Schema Multi-Usuário
-- Cole no SQL Editor do Supabase e clique em Run
-- ============================================

-- ============ TABELAS PRINCIPAIS ============

create table if not exists expenses (
  id                  uuid default gen_random_uuid() primary key,
  user_id             uuid references auth.users(id) on delete cascade,
  description         text not null,
  amount              numeric(10,2) not null,
  category            text default 'Outros',
  source              text default 'manual',
  installments        int default 1,
  installment_current int default 1,
  installment_group   uuid,
  created_at          timestamptz default now()
);

create table if not exists habits (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null,
  emoji      text default '✅',
  created_at timestamptz default now()
);

create table if not exists habit_logs (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  habit_id   uuid references habits(id) on delete cascade,
  done_at    date default current_date,
  source     text default 'manual',
  created_at timestamptz default now(),
  unique(habit_id, done_at)
);

create table if not exists tasks (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  text       text not null,
  tag        text default 'Geral',
  done       boolean default false,
  due_date   date,
  created_at timestamptz default now()
);

create table if not exists goals (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null,
  target     numeric(10,2) not null,
  current    numeric(10,2) default 0,
  color      text default '#25d499',
  deadline   date,
  created_at timestamptz default now()
);

-- ============ NOVAS TABELAS v3 ============

create table if not exists user_profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  username     text not null unique,
  avatar_emoji text default '🧑',
  xp           int default 0,
  level        int default 1,
  created_at   timestamptz default now()
);

create table if not exists xp_logs (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  amount     int not null,
  reason     text not null,
  created_at timestamptz default now()
);

-- ============ MIGRAÇÃO (tabelas existentes) ============

alter table expenses   add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table habits     add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table habit_logs add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table tasks      add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table goals      add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table expenses add column if not exists installments        int default 1;
alter table expenses add column if not exists installment_current int default 1;
alter table expenses add column if not exists installment_group   uuid;

-- ============ RLS — POR USUÁRIO ============

alter table expenses      enable row level security;
alter table habits        enable row level security;
alter table habit_logs    enable row level security;
alter table tasks         enable row level security;
alter table goals         enable row level security;
alter table user_profiles enable row level security;
alter table xp_logs       enable row level security;

-- Remove políticas antigas abertas
drop policy if exists "allow all" on expenses;
drop policy if exists "allow all" on habits;
drop policy if exists "allow all" on habit_logs;
drop policy if exists "allow all" on tasks;
drop policy if exists "allow all" on goals;

-- Políticas por usuário
drop policy if exists "own expenses"      on expenses;
drop policy if exists "own habits"        on habits;
drop policy if exists "own habit_logs"    on habit_logs;
drop policy if exists "own tasks"         on tasks;
drop policy if exists "own goals"         on goals;
drop policy if exists "profiles read all" on user_profiles;
drop policy if exists "profiles write own" on user_profiles;
drop policy if exists "profiles update own" on user_profiles;
drop policy if exists "own xp_logs"       on xp_logs;

create policy "own expenses"
  on expenses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own habits"
  on habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own habit_logs"
  on habit_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own tasks"
  on tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own goals"
  on goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Perfil: cada um gere o próprio, todos autenticados podem ler (para o ranking)
create policy "profiles read all"
  on user_profiles for select using (auth.role() = 'authenticated');

create policy "profiles write own"
  on user_profiles for insert with check (auth.uid() = id);

create policy "profiles update own"
  on user_profiles for update using (auth.uid() = id);

-- XP logs: apenas o dono lê/escreve
create policy "own xp_logs"
  on xp_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ VERIFICAÇÕES ============

create table if not exists verifications (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  type       text not null,          -- 'habit' | 'task'
  ref_id     uuid not null,          -- habit_id ou task_id
  ref_name   text not null,          -- nome para exibição
  photo_url  text,
  xp_amount  int default 0,          -- XP concedido (para revogar se rejeitado)
  status     text default 'pending', -- 'pending' | 'approved' | 'rejected' | 'done'
  created_at timestamptz default now()
);

create table if not exists verification_votes (
  id              uuid default gen_random_uuid() primary key,
  verification_id uuid references verifications(id) on delete cascade,
  voter_id        uuid references auth.users(id) on delete cascade,
  vote            text not null, -- 'approve' | 'reject'
  created_at      timestamptz default now(),
  unique(verification_id, voter_id)
);

-- Vinculação Telegram
alter table user_profiles add column if not exists email             text;
alter table user_profiles add column if not exists telegram_chat_id  bigint;

alter table verifications      enable row level security;
alter table verification_votes enable row level security;

drop policy if exists "verifications select" on verifications;
drop policy if exists "verifications insert" on verifications;
drop policy if exists "verifications update" on verifications;
drop policy if exists "votes select"         on verification_votes;
drop policy if exists "votes insert"         on verification_votes;

-- Todos autenticados veem todas as verificações (para aprovar amigos)
create policy "verifications select"
  on verifications for select using (auth.role() = 'authenticated');

-- Apenas o dono insere
create policy "verifications insert"
  on verifications for insert with check (auth.uid() = user_id);

-- Qualquer autenticado pode atualizar status (para votação)
create policy "verifications update"
  on verifications for update using (auth.role() = 'authenticated');

-- Votos: todos podem ver, cada um insere o próprio
create policy "votes select"
  on verification_votes for select using (auth.role() = 'authenticated');

create policy "votes insert"
  on verification_votes for insert with check (auth.uid() = voter_id);

-- ============ REALTIME ============

-- ============ GAMIFICAÇÃO v4 ============

-- Campos extras no perfil
alter table user_profiles add column if not exists streak             int  default 0;
alter table user_profiles add column if not exists last_activity_date date;
alter table user_profiles add column if not exists referral_code      text unique;

-- Amigos (bidirecional)
create table if not exists friends (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  friend_id  uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, friend_id)
);

-- XP semanal (ranking)
create table if not exists weekly_xp (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  xp         int default 0,
  week_start date not null,
  created_at timestamptz default now(),
  unique(user_id, week_start)
);

alter table friends    enable row level security;
alter table weekly_xp  enable row level security;

drop policy if exists "friends read"      on friends;
drop policy if exists "friends write"     on friends;
drop policy if exists "weekly_xp read"    on weekly_xp;
drop policy if exists "weekly_xp write"   on weekly_xp;

create policy "friends read"   on friends   for select using (auth.role() = 'authenticated');
create policy "friends write"  on friends   for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "weekly_xp read" on weekly_xp for select using (auth.role() = 'authenticated');
create policy "weekly_xp write" on weekly_xp for all   using (auth.uid() = user_id) with check (auth.uid() = user_id);

do $$ begin alter publication supabase_realtime add table friends;    exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table weekly_xp;  exception when others then null; end $$;

-- ============ REALTIME ============

-- ============ SOLICITAÇÕES DE AMIZADE v5 ============

create table if not exists friend_requests (
  id         uuid default gen_random_uuid() primary key,
  from_id    uuid references auth.users(id) on delete cascade,
  to_id      uuid references auth.users(id) on delete cascade,
  status     text default 'pending', -- pending | accepted | rejected
  created_at timestamptz default now(),
  unique(from_id, to_id)
);

alter table friend_requests enable row level security;

drop policy if exists "fr_select" on friend_requests;
drop policy if exists "fr_insert" on friend_requests;

create policy "fr_select" on friend_requests for select using (auth.uid() = from_id or auth.uid() = to_id);
create policy "fr_insert" on friend_requests for insert with check (auth.uid() = from_id);

-- ============ CONQUISTAS v5 ============

create table if not exists user_achievements (
  id             uuid default gen_random_uuid() primary key,
  user_id        uuid references auth.users(id) on delete cascade,
  achievement_id text not null,
  unlocked_at    timestamptz default now(),
  unique(user_id, achievement_id)
);

alter table user_achievements enable row level security;

drop policy if exists "achievements read all" on user_achievements;
drop policy if exists "achievements write own" on user_achievements;

-- Todos autenticados veem (para exibir conquistas de amigos no futuro)
create policy "achievements read all"
  on user_achievements for select using (auth.role() = 'authenticated');

-- Apenas o backend (service_role) insere — sem insert policy para usuários normais
create policy "achievements write own"
  on user_achievements for insert with check (auth.uid() = user_id);

-- ============ HORÁRIO NAS TAREFAS v6 ============
alter table tasks add column if not exists due_time text;

-- ============ EVENTOS v6 ============

create table if not exists events (
  id          uuid default gen_random_uuid() primary key,
  title       text not null,
  description text,
  xp_reward   int default 50,
  starts_at   timestamptz default now(),
  ends_at     timestamptz,
  active      boolean default true,
  created_at  timestamptz default now()
);

-- Submissões de prova por etapa do evento
create table if not exists event_submissions (
  id             uuid default gen_random_uuid() primary key,
  event_id       uuid references events(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete cascade,
  step           int not null default 1, -- 1=garrafinha cheia, 2=garrafinha vazia
  photo_url      text,
  status         text default 'pending', -- pending | approved | rejected
  submitted_at   timestamptz default now(),
  unique(event_id, user_id, step)
);

alter table events           enable row level security;
alter table event_submissions enable row level security;

create policy "events_read"   on events            for select using (auth.role() = 'authenticated');
create policy "esub_read"     on event_submissions  for select using (auth.role() = 'authenticated');
create policy "esub_insert"   on event_submissions  for insert with check (auth.uid() = user_id);

-- Evento inicial: Desafio da Garrafinha
insert into events (title, description, xp_reward, ends_at)
values (
  'Desafio da Garrafinha 💧',
  'Beba 2L de água hoje! Envie uma foto da garrafinha cheia e depois vazia. Seus amigos precisam aprovar as duas provas.',
  60,
  now() + interval '7 days'
) on conflict do nothing;

-- ============ REALTIME ============

do $$ begin alter publication supabase_realtime add table expenses;           exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table habit_logs;         exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table tasks;              exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table user_profiles;      exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table verifications;      exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table verification_votes; exception when others then null; end $$;
