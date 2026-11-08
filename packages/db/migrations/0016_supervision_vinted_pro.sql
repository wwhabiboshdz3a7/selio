-- 0016 — Supervision des services et fournisseur « vinted_pro » (8 novembre 2026).
-- Migration additive et idempotente.
--
-- FOURNISSEUR « vinted_pro » : connexion par l'API officielle Vinted Pro Integrations (comptes Pro admis
-- par Vinted). Squelette sans appel tant que l'accès n'est pas obtenu (packages/connectors/src/vinted-pro).
-- La clé fournie par Vinted va, comme les autres secrets, dans `secret_ciphertext` (chiffrée).
--
-- SUPERVISION (worker, tâche « supervision.tick » chaque minute) : contrôle de /api/health et de
-- /api/ai/health, alerte des opérateurs par Web Push et par email après 3 échecs consécutifs, rappel
-- toutes les 60 min tant que la panne dure, notification du rétablissement.
--
--   supervision_targets : état de chaque cible (une ligne par nom) : échecs consécutifs, en panne
--                         depuis, dernière alerte. La ligne est verrouillée (select … for update)
--                         pendant le calcul : jamais deux alertes pour le même échec, même avec deux
--                         workers.
--   supervision_checks  : historique court des vérifications (7 jours), pour /api/health/details.
--
-- Tables globales (aucune donnée d'organisation, aucun secret : l'adresse est gardée sans requête ni
-- identifiants, les en-têtes — jeton de santé — ne sont jamais enregistrés). Pas de RLS : lues et écrites
-- par le rôle applicatif, comme les autres tables globales (0002_rls.sql).

-- ---------------------------------------------------------------- fournisseur vinted_pro
alter table marketplace_connections drop constraint if exists marketplace_connections_provider_check;
alter table marketplace_connections add constraint marketplace_connections_provider_check
  check (provider in ('vinted', 'demo', 'vinted_pro'));

-- ---------------------------------------------------------------- supervision
create table if not exists supervision_targets (
  name text primary key check (length(name) between 1 and 60),
  url text not null check (length(url) <= 500),
  status text not null default 'unknown' check (status in ('unknown', 'up', 'down')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  failing_since timestamptz,
  down_since timestamptz,
  last_alert_at timestamptz,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_status_code integer,
  last_latency_ms integer,
  last_error text check (last_error is null or length(last_error) <= 300),
  updated_at timestamptz not null default now()
);

create table if not exists supervision_checks (
  id text primary key default gen_random_uuid()::text,
  target text not null check (length(target) between 1 and 60),
  ok boolean not null,
  status_code integer,
  latency_ms integer,
  error text check (error is null or length(error) <= 300),
  -- Notification déclenchée par cette vérification : alerte, rappel, rétablissement (ou aucune).
  event text check (event is null or event in ('alert', 'reminder', 'recovered')),
  checked_at timestamptz not null default now()
);
create index if not exists idx_supervision_checks_target_at on supervision_checks(target, checked_at desc);
create index if not exists idx_supervision_checks_at on supervision_checks(checked_at);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant select, insert, update, delete on supervision_targets, supervision_checks to selio_app;
  end if;
end $$;
