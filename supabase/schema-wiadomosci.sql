-- TMT Grafik — wiadomości od przełożonego do pracowników.
-- Wysyła je tylko funkcja tmt-api (akcja message): zapisuje wiadomość i wysyła push.
-- Pracownik widzi wyłącznie wiadomości, w których jest adresatem, i sam potwierdza przeczytanie.

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  author      text not null,
  title       text check (title is null or char_length(title) <= 80),
  body        text not null check (char_length(body) between 1 and 2000),
  audience    text not null,
  worker_ids  text[] not null,
  important   boolean not null default false
);
create index if not exists messages_workers on public.messages using gin (worker_ids);
create index if not exists messages_created on public.messages (created_at desc);
alter table public.messages enable row level security;

drop policy if exists "kadra czyta wiadomosci" on public.messages;
create policy "kadra czyta wiadomosci" on public.messages
  for select to authenticated using (public.is_staff());

drop policy if exists "pracownik czyta swoje wiadomosci" on public.messages;
create policy "pracownik czyta swoje wiadomosci" on public.messages
  for select to authenticated using (public.my_worker_id() is not null and public.my_worker_id() = any (worker_ids));

drop policy if exists "edytor usuwa wiadomosci" on public.messages;
create policy "edytor usuwa wiadomosci" on public.messages
  for delete to authenticated using (public.can_edit());

create table if not exists public.message_reads (
  message_id  uuid not null references public.messages (id) on delete cascade,
  worker_id   text not null,
  read_at     timestamptz not null default now(),
  primary key (message_id, worker_id)
);
alter table public.message_reads enable row level security;

drop policy if exists "kadra widzi przeczytania" on public.message_reads;
create policy "kadra widzi przeczytania" on public.message_reads
  for select to authenticated using (public.is_staff());

drop policy if exists "pracownik widzi swoje przeczytania" on public.message_reads;
create policy "pracownik widzi swoje przeczytania" on public.message_reads
  for select to authenticated using (worker_id = public.my_worker_id());

drop policy if exists "pracownik potwierdza przeczytanie" on public.message_reads;
create policy "pracownik potwierdza przeczytanie" on public.message_reads
  for insert to authenticated with check (
    worker_id = public.my_worker_id()
    and exists (select 1 from public.messages m where m.id = message_id and public.my_worker_id() = any (m.worker_ids))
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reads') then
    alter publication supabase_realtime add table public.message_reads;
  end if;
end $$;
