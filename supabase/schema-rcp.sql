-- TMT Grafik — RCP: kiosk QR przy wejściu.
-- Odbicia są rekordami kind = 'punches' w tabeli records; zapisuje je tylko funkcja tmt-api
-- (pracownik nie ma prawa zapisu), czas odbicia bierze serwer.

-- konto tabletu przy wejściu: widzi tylko ekran kiosku
alter table public.allowed_users drop constraint if exists allowed_users_role_check;
alter table public.allowed_users add constraint allowed_users_role_check
  check (role in ('admin', 'editor', 'viewer', 'employee', 'kiosk'));

create index if not exists records_punches_at on public.records ((data ->> 'at')) where kind = 'punches';
create index if not exists records_punches_worker on public.records ((data ->> 'workerId'), (data ->> 'at')) where kind = 'punches';
