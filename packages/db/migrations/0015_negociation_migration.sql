-- 0015 — Négociation avancée (limites de Vinted mesurées) et migration depuis un autre outil
-- (7 novembre 2026). Migration additive et idempotente.
--
-- LIMITES DE VINTED : contre-offres par conversation, durée d'une offre, délai entre deux messages.
-- Elles sont INCONNUES tant qu'elles n'ont pas été mesurées sur un vrai compte (protocole dans
-- docs/NEGOCIATION.md et packages/domain/src/negotiation-limits.ts). Tant qu'aucune ligne n'existe,
-- Selio applique les valeurs prudentes par défaut des réglages (`automation.vintedLimits`,
-- « à mesurer ») ; aucune valeur n'est jamais présentée comme vérifiée sans mesure datée.
--
--   negotiation_limits : historique des mesures (une ligne par mesure, la plus récente s'applique).
--                        `org_id` null = mesure de l'équipe (globale, faite par l'opérateur sur un
--                        compte de l'équipe), lisible par toutes les organisations ; sinon mesure propre
--                        à une organisation (prioritaire sur la mesure globale). Écriture d'une mesure
--                        globale par la fonction `app_negotiation_limits_record_global` seulement
--                        (contrôle `isOperator` côté application). Aucune donnée personnelle.
--
-- MIGRATION DEPUIS UN AUTRE OUTIL (Bleam, Clemz, V-Tools…) : jamais d'identifiants demandés, jamais de
-- connexion à leurs services, jamais de lecture de leurs serveurs. Entrées acceptées : texte collé,
-- captures d'écran (lues par le modèle 1, JAMAIS stockées : seul leur nombre est gardé), fichier fourni
-- par le client au titre de la portabilité RGPD.
--
--   migration_mappings : correspondance « ancien → nouveau » proposée (brouillon) puis appliquée
--                        (champs acceptés seulement). L'entrée brute (texte collé ou fichier) n'est
--                        gardée que 7 jours (`raw_input_purge_at`), puis effacée par
--                        `app_migration_purge_raw_inputs` (worker, tâche de rétention).
--
-- Tables d'organisation : RLS forcée, politique org_isolation comme 0002_rls.sql (lecture des mesures
-- globales en plus pour negotiation_limits).

-- ---------------------------------------------------------------- limites de Vinted mesurées
create table if not exists negotiation_limits (
  id text primary key default gen_random_uuid()::text,
  -- null : mesure globale de l'équipe ; sinon mesure propre à l'organisation.
  org_id text references organizations(id) on delete cascade,
  max_counter_offers_per_conversation integer not null check (max_counter_offers_per_conversation between 1 and 20),
  offer_duration_hours integer not null check (offer_duration_hours between 1 and 168),
  min_delay_between_messages_seconds integer not null check (min_delay_between_messages_seconds between 0 and 3600),
  source text not null default 'measured' check (source in ('default_conservative', 'measured')),
  -- Date de la mesure (fixée par le serveur) : obligatoire pour une mesure.
  measured_at timestamptz,
  measured_by text check (measured_by is null or length(measured_by) <= 64),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  check (source <> 'measured' or measured_at is not null)
);
create index if not exists idx_negotiation_limits_org on negotiation_limits(org_id, created_at desc);

-- ---------------------------------------------------------------- migration des réglages
create table if not exists migration_mappings (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  source text not null default 'unknown' check (source in ('bleam', 'clemz', 'vtools', 'other', 'unknown')),
  input_kind text not null check (input_kind in ('text', 'screenshot', 'rgpd_file')),
  -- Correspondance normalisée (MigrationMapping, @selio/contracts) : champs, champs inconnus, avertissements.
  mapping jsonb not null check (jsonb_typeof(mapping) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'applied')),
  -- Texte collé ou contenu du fichier RGPD : gardé 7 jours au plus, puis effacé (jamais les captures).
  raw_input text check (raw_input is null or length(raw_input) <= 2000000),
  raw_input_purge_at timestamptz,
  -- Nombre de captures lues par le modèle 1 (les images ne sont jamais stockées).
  screenshot_count integer not null default 0 check (screenshot_count between 0 and 4),
  applied_field_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(applied_field_ids) = 'array'),
  applied_result jsonb check (applied_result is null or jsonb_typeof(applied_result) = 'object'),
  created_by text check (created_by is null or length(created_by) <= 64),
  applied_by text check (applied_by is null or length(applied_by) <= 64),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (raw_input is null or raw_input_purge_at is not null),
  check (status <> 'applied' or applied_at is not null)
);
create index if not exists idx_migration_mappings_org on migration_mappings(org_id, created_at desc);
create index if not exists idx_migration_mappings_purge on migration_mappings(raw_input_purge_at) where raw_input is not null;

-- ---------------------------------------------------------------- RLS et privilèges
alter table negotiation_limits enable row level security;
alter table negotiation_limits force row level security;
alter table migration_mappings enable row level security;
alter table migration_mappings force row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    drop policy if exists org_isolation on migration_mappings;
    create policy org_isolation on migration_mappings for all to selio_app
      using (org_id = app_current_org()) with check (org_id = app_current_org());
    grant select, insert, update, delete on migration_mappings to selio_app;

    -- Limites : lecture de ses mesures et des mesures globales ; écriture de ses seules mesures.
    drop policy if exists org_isolation on negotiation_limits;
    drop policy if exists negotiation_limits_read on negotiation_limits;
    drop policy if exists negotiation_limits_write on negotiation_limits;
    create policy negotiation_limits_read on negotiation_limits for select to selio_app
      using (org_id is null or org_id = app_current_org());
    create policy negotiation_limits_write on negotiation_limits for insert to selio_app
      with check (org_id is not null and org_id = app_current_org());
    -- Historique de mesures : ni modification ni suppression par le rôle applicatif (une nouvelle mesure s'ajoute).
    revoke all on negotiation_limits from selio_app;
    grant select, insert on negotiation_limits to selio_app;
  end if;
end $$;

-- ---------------------------------------------------------------- fonctions (SECURITY DEFINER)

-- Mesure globale (équipe) : contrôle `isOperator` côté application. Valeurs bornées par la table.
create or replace function app_negotiation_limits_record_global(p_max_counter integer, p_offer_hours integer, p_delay_seconds integer, p_measured_at timestamptz, p_measured_by text, p_note text)
returns table (id text, created_at timestamptz)
language sql security definer volatile
set search_path = public, pg_temp
as $$
  insert into negotiation_limits as n (org_id, max_counter_offers_per_conversation, offer_duration_hours, min_delay_between_messages_seconds, source, measured_at, measured_by, note)
  values (null, p_max_counter, p_offer_hours, p_delay_seconds, 'measured', p_measured_at, left(p_measured_by, 64), left(p_note, 500))
  returning n.id, n.created_at
$$;
revoke all on function app_negotiation_limits_record_global(integer, integer, integer, timestamptz, text, text) from public;

-- Rétention : efface l'entrée brute (texte collé, fichier) arrivée à échéance, toutes organisations.
-- Aucune donnée rendue : le nombre de lignes seulement.
create or replace function app_migration_purge_raw_inputs(p_now timestamptz)
returns integer
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  update migration_mappings set raw_input = null, raw_input_purge_at = null, updated_at = now()
  where raw_input is not null and raw_input_purge_at <= p_now;
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function app_migration_purge_raw_inputs(timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_negotiation_limits_record_global(integer, integer, integer, timestamptz, text, text) to selio_app;
    grant execute on function app_migration_purge_raw_inputs(timestamptz) to selio_app;
  end if;
end $$;
