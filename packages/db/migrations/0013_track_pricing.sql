-- 0013 — Selio Track et estimation des prix (30 octobre 2026). Migration additive et idempotente.
--
-- STATISTIQUES SEULEMENT : aucune table ci-dessous ne contient de pseudo, de photo d'annonce, de titre
-- libre ni d'identifiant d'annonce réutilisable publiquement. Les annonces vues par Track ne sont
-- repérées d'une lecture à l'autre que par une empreinte salée (SHA-256 du sel de `track_runtime` et
-- de la référence), calculée par la base : le rôle applicatif ne lit jamais le sel.
--
-- Tables d'organisation (RLS forcée, politique org_isolation comme 0002_rls.sql) :
--   track_filters        : filtres suivis (critères, empreinte normalisée) ; unique (org_id, fingerprint).
--   track_scans          : scans de niche (note 0–100 et composantes), purgés selon l'historique du plan.
--   track_photo_searches : recherches par photo (description lue et estimation) ; la photo n'est JAMAIS
--                          enregistrée.
--
-- Tables partagées entre organisations (aucune donnée d'organisation, hors RLS) :
--   track_filter_reads   : une ligne par empreinte (lecture unique quelle que soit la quantité de
--                          clients) : critères normalisés, dernière et prochaine lecture, nombre de
--                          lectures, dernier résultat, facteur, état des annonces actives (empreintes
--                          salées, prix, dates). AUCUN droit direct pour le rôle applicatif : accès
--                          seulement par les fonctions SECURITY DEFINER ci-dessous (le worker et l'API
--                          se connectent tous deux avec selio_app ; il n'existe pas de rôle worker séparé).
--   track_runtime        : une seule ligne : sels des empreintes (état des lectures et clés des
--                          références : deux sels distincts), fenêtre glissante PARTAGÉE des
--                          1 000 dernières lectures en direct de Track (o = page lue, b = blocage),
--                          facteur de ralentissement, pause de Track après un signal de Vinted. Aucun
--                          droit direct pour selio_app (fonctions seulement).
--   track_snapshots      : agrégats par empreinte et par lecture (nombre d'annonces, prix médian, P25,
--                          P75, nouvelles, disparues (estimation), délai médian, parts des marques) ;
--                          purgés selon l'historique du plan le plus long parmi les organisations qui
--                          suivent l'empreinte (12 mois au plus, `app_track_purge`).
--   price_references     : base de références de prix, sans donnée personnelle (marque, catégorie,
--                          sous-catégorie, taille, matière, couleur, état, prix affiché et final,
--                          dates AU JOUR pour Track et les ventes, nombre de photos par tranches,
--                          vues et favoris si visibles, source), gardée 24 mois. Une vente réelle
--                          convertie (avec l'accord de l'organisation) garde l'organisation qui l'a
--                          fournie (`contributor_org_id`, jamais renvoyée) pour être retirée avec elle,
--                          et n'est jamais servie une à une à une autre organisation. Les clés des
--                          références de Track sont calculées par la base avec un sel distinct de
--                          celui de l'état des lectures (`app_track_store_references`) : le rôle
--                          applicatif ne peut pas relier une référence à une annonce.
--   price_models         : modèles de prix entraînés (JSON), un seul « active » à la fois.

-- ---------------------------------------------------------------- filtres suivis (organisation)
create table if not exists track_filters (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  criteria jsonb not null default '{}'::jsonb,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, fingerprint)
);
create index if not exists idx_track_filters_fingerprint on track_filters(fingerprint) where enabled;

-- ---------------------------------------------------------------- lectures par empreinte (partagé)
create table if not exists track_filter_reads (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  -- Critères normalisés (mots-clés, marques, catégories, tailles, états, prix) : aucune donnée de personne.
  criteria jsonb not null default '{}'::jsonb,
  last_read_at timestamptz,
  next_read_at timestamptz not null default now(),
  reads integer not null default 0 check (reads >= 0),
  blocks integer not null default 0 check (blocks >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_outcome text check (last_outcome is null or last_outcome in ('ok', 'blocked', 'captcha', 'rate_limited', 'page_changed', 'error', 'timeout')),
  factor integer not null default 1 check (factor between 1 and 64),
  -- Annonces actives à la dernière lecture : [{ k: empreinte salée, p: prix, f: première vue, d: publication }].
  state jsonb not null default '[]'::jsonb,
  state_source text check (state_source is null or state_source in ('demo', 'cloud')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_track_filter_reads_next on track_filter_reads(next_read_at);

create table if not exists track_runtime (
  id smallint primary key default 1 check (id = 1),
  -- Sel des empreintes d'annonces (244 bits d'aléa) : jamais lu par le rôle applicatif.
  ref_salt text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
  -- Fenêtre glissante partagée : une lettre par lecture en direct (o = lue, b = blocage), 1 000 au plus.
  window_measures text not null default '' check (window_measures ~ '^[ob]*$' and length(window_measures) <= 1000),
  slowdown_factor integer not null default 1 check (slowdown_factor between 1 and 64),
  last_block_at timestamptz,
  paused_until timestamptz,
  pause_reason text check (pause_reason is null or pause_reason in ('captcha', 'warning', 'blocked', 'rate_limited')),
  updated_at timestamptz not null default now()
);
-- Sel des clés des références de Track (distinct du sel de l'état) : jamais lu par le rôle applicatif.
alter table track_runtime add column if not exists ref_store_salt text not null default (gen_random_uuid()::text || gen_random_uuid()::text);
insert into track_runtime (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- instantanés (partagé)
create table if not exists track_snapshots (
  id text primary key default gen_random_uuid()::text,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  source text not null default 'demo' check (source in ('demo', 'cloud')),
  read_at timestamptz not null,
  listed_count integer not null default 0 check (listed_count >= 0),
  median_price_cents integer check (median_price_cents is null or median_price_cents >= 0),
  p25_cents integer check (p25_cents is null or p25_cents >= 0),
  p75_cents integer check (p75_cents is null or p75_cents >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  gone_count integer not null default 0 check (gone_count >= 0),
  median_days_listed double precision check (median_days_listed is null or median_days_listed >= 0),
  -- Parts des marques (10 au plus) : marque, nombre, part. Aucun pseudo.
  brand_shares jsonb not null default '[]'::jsonb,
  -- Catégories et marques des critères (scans de niche).
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (fingerprint, read_at, source)
);
create index if not exists idx_track_snapshots_fp_read on track_snapshots(fingerprint, read_at desc);

-- ---------------------------------------------------------------- scans et recherches par photo (organisation)
create table if not exists track_scans (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  brand text check (brand is null or length(brand) <= 80),
  category text not null,
  status text not null default 'ok' check (status in ('ok', 'insufficient_data')),
  score integer check (score is null or score between 0 and 100),
  components jsonb,
  based_on jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  message text,
  created_at timestamptz not null default now()
);
create index if not exists idx_track_scans_org_created on track_scans(org_id, created_at desc);

create table if not exists track_photo_searches (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  -- Description lue par le modèle 1 et estimation : la photo elle-même n'est jamais enregistrée.
  description jsonb not null,
  estimate jsonb not null,
  simulated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_track_photo_searches_org_created on track_photo_searches(org_id, created_at desc);

-- ---------------------------------------------------------------- références de prix (partagé)
create table if not exists price_references (
  id text primary key default gen_random_uuid()::text,
  dedupe_key text not null unique check (length(dedupe_key) between 8 and 120),
  source text not null check (source in ('track', 'sale', 'demo', 'import')),
  contributor_org_id text references organizations(id) on delete cascade,
  status text not null default 'listed' check (status in ('listed', 'sold', 'gone')),
  brand text check (brand is null or length(brand) <= 80),
  category text not null check (category in ('women', 'men', 'kids', 'shoes', 'bags', 'accessories', 'home', 'electronics', 'other')),
  subcategory text check (subcategory is null or length(subcategory) <= 60),
  size text check (size is null or length(size) <= 40),
  material text check (material is null or length(material) <= 60),
  color text check (color is null or length(color) <= 30),
  condition text check (condition is null or condition in ('new_with_tags', 'new_without_tags', 'very_good', 'good', 'satisfactory')),
  listed_price_cents integer check (listed_price_cents is null or listed_price_cents >= 0),
  final_price_cents integer check (final_price_cents is null or final_price_cents >= 0),
  final_price_estimated boolean not null default false,
  listed_at timestamptz,
  sold_at timestamptz,
  photo_count integer check (photo_count is null or photo_count between 0 and 30),
  views integer check (views is null or views >= 0),
  favorites integer check (favorites is null or favorites >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_price_references_brand_cat_listed on price_references(lower(brand), category, listed_at desc);
create index if not exists idx_price_references_cat_listed on price_references(category, listed_at desc);
create index if not exists idx_price_references_sold on price_references(sold_at desc) where final_price_cents is not null;
create index if not exists idx_price_references_contributor on price_references(contributor_org_id) where contributor_org_id is not null;

-- ---------------------------------------------------------------- modèles de prix (partagé)
create table if not exists price_models (
  id text primary key default gen_random_uuid()::text,
  version text not null unique check (length(version) between 1 and 80),
  trained_at timestamptz not null,
  n_references integer not null default 0 check (n_references >= 0),
  metrics jsonb not null default '{}'::jsonb,
  -- Modèle sérialisé par l'entraîneur (@selio/pricing) : arbres et paramètres, aucune donnée de référence.
  model jsonb not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  synthetic boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_price_models_active on price_models(status) where status = 'active';

-- ---------------------------------------------------------------- RLS et privilèges
alter table track_filters enable row level security;
alter table track_filters force row level security;
alter table track_scans enable row level security;
alter table track_scans force row level security;
alter table track_photo_searches enable row level security;
alter table track_photo_searches force row level security;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    foreach t in array array['track_filters', 'track_scans', 'track_photo_searches'] loop
      execute format('drop policy if exists org_isolation on %I', t);
      execute format(
        'create policy org_isolation on %I for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
    end loop;
    grant select, insert, update, delete on track_filters, track_scans, track_photo_searches to selio_app;
    -- Statistiques partagées, sans donnée d'organisation ni de personne.
    grant select, insert, update, delete on track_snapshots, price_references, price_models to selio_app;
    -- Lectures par empreinte et réglages de Track : fonctions SECURITY DEFINER seulement (les privilèges
    -- par défaut du schéma les avaient accordés à la création).
    revoke all on track_filter_reads, track_runtime from selio_app;
  end if;
end $$;

-- ---------------------------------------------------------------- fonctions (SECURITY DEFINER)

-- Suivi d'une empreinte par l'organisation courante : la ligne partagée est créée si elle manque, lue à
-- `p_next_read_at` (maintenant, ou dans 2 h quand l'organisation a déjà retiré des empreintes récemment :
-- voir `track.createFilter`). Avec `p_defer`, une ligne existante que PERSONNE d'autre ne suit (filtre
-- actif) est elle aussi repoussée à `p_next_read_at` : revenir à des critères abandonnés ne déclenche pas
-- de lecture immédiate. Une ligne suivie par une autre organisation garde son rythme (sa lecture a lieu
-- de toute façon). Refusé en silence si l'organisation ne suit pas cette empreinte.
drop function if exists app_track_follow(text, jsonb, timestamptz);
create or replace function app_track_follow(p_fingerprint text, p_criteria jsonb, p_next_read_at timestamptz, p_defer boolean)
returns void
language sql security definer volatile
set search_path = public, pg_temp
as $$
  insert into track_filter_reads (fingerprint, criteria, next_read_at)
  select p_fingerprint, p_criteria, p_next_read_at
  where exists (select 1 from track_filters f where f.org_id = app_current_org() and f.fingerprint = p_fingerprint)
  on conflict (fingerprint) do update set next_read_at = greatest(track_filter_reads.next_read_at, excluded.next_read_at), updated_at = now()
  where p_defer
    and not exists (select 1 from track_filters o where o.fingerprint = excluded.fingerprint and o.enabled and o.org_id <> app_current_org())
$$;
revoke all on function app_track_follow(text, jsonb, timestamptz, boolean) from public;

-- État de lecture des empreintes suivies par l'organisation courante (aucune autre).
create or replace function app_track_state(p_fingerprints text[])
returns table (fingerprint text, last_read_at timestamptz, next_read_at timestamptz, reads integer, last_outcome text, factor integer)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select r.fingerprint, r.last_read_at, r.next_read_at, r.reads, r.last_outcome, r.factor
  from track_filter_reads r
  where r.fingerprint = any(p_fingerprints)
    and exists (select 1 from track_filters f where f.org_id = app_current_org() and f.fingerprint = r.fingerprint)
$$;
revoke all on function app_track_state(text[]) from public;

-- Empreintes dues (passage du worker) : suivies par au moins un filtre actif, prochaine lecture échue.
-- Une seule ligne par empreinte, quelle que soit la quantité de clients qui la suivent.
create or replace function app_track_due(p_now timestamptz, p_limit integer)
returns table (fingerprint text, criteria jsonb, last_read_at timestamptz, next_read_at timestamptz, reads integer, factor integer)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select r.fingerprint, r.criteria, r.last_read_at, r.next_read_at, r.reads, r.factor
  from track_filter_reads r
  where r.next_read_at <= p_now
    and exists (select 1 from track_filters f where f.fingerprint = r.fingerprint and f.enabled)
  order by r.next_read_at, r.fingerprint
  limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;
revoke all on function app_track_due(timestamptz, integer) from public;

-- Prise d'une lecture (UPDATE conditionnel) : la prochaine lecture est repoussée à `p_lease_until`, un
-- second passage simultané ne relit pas la même empreinte. Rend les critères et l'état précédent.
create or replace function app_track_claim(p_fingerprint text, p_now timestamptz, p_lease_until timestamptz)
returns table (criteria jsonb, state jsonb, state_source text, last_read_at timestamptz, reads integer, consecutive_failures integer, factor integer)
language sql security definer volatile
set search_path = public, pg_temp
as $$
  update track_filter_reads r set next_read_at = p_lease_until, updated_at = now()
  where r.fingerprint = p_fingerprint and r.next_read_at <= p_now
    and exists (select 1 from track_filters f where f.fingerprint = p_fingerprint and f.enabled)
  returning r.criteria, r.state, r.state_source, r.last_read_at, r.reads, r.consecutive_failures, r.factor
$$;
revoke all on function app_track_claim(text, timestamptz, timestamptz) from public;

-- Fin d'une lecture : mesure, état des annonces actives, prochaine lecture. `p_counted` : une page a été
-- reçue (elle compte) ; `p_state` null : état inchangé (lecture sans annonces exploitables).
create or replace function app_track_finish(
  p_fingerprint text, p_read_at timestamptz, p_next_read_at timestamptz, p_outcome text, p_counted boolean,
  p_blocked boolean, p_anomaly boolean, p_factor integer, p_state jsonb, p_state_source text)
returns void
language sql security definer volatile
set search_path = public, pg_temp
as $$
  update track_filter_reads set
    last_read_at = case when p_counted then p_read_at else last_read_at end,
    next_read_at = p_next_read_at,
    reads = reads + case when p_counted then 1 else 0 end,
    blocks = blocks + case when p_blocked then 1 else 0 end,
    consecutive_failures = case when p_anomaly then consecutive_failures + 1 when p_counted and not p_blocked then 0 else consecutive_failures end,
    last_outcome = coalesce(p_outcome, last_outcome),
    factor = greatest(1, least(64, p_factor)),
    state = coalesce(p_state, state),
    state_source = case when p_state is null then state_source else p_state_source end,
    updated_at = now()
  where fingerprint = p_fingerprint
$$;
revoke all on function app_track_finish(text, timestamptz, timestamptz, text, boolean, boolean, boolean, integer, jsonb, text) from public;

-- Empreintes salées des références d'annonces (le sel ne quitte jamais la base).
create or replace function app_track_ref_keys(p_refs text[])
returns table (ref text, key text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select u.ref, encode(sha256(convert_to((select t.ref_salt from track_runtime t where t.id = 1) || '|' || u.ref, 'UTF8')), 'hex')
  from unnest(p_refs) as u(ref)
$$;
revoke all on function app_track_ref_keys(text[]) from public;

-- Références de Track (annonces vues et disparues) : la clé de dédoublonnage est calculée ICI avec un sel
-- distinct (`ref_store_salt`) à partir de la clé de l'état, et n'est jamais rendue : le rôle applicatif,
-- qui peut calculer la clé de l'état d'une annonce, ne peut pas en déduire celle de sa référence. Dates
-- ramenées au jour (UTC), nombre de photos par tranches. Mêmes règles de mise à jour que les autres
-- références (un attribut connu n'est pas effacé par une valeur absente). Rend le nombre de lignes écrites.
create or replace function app_track_store_references(p_source text, p_rows jsonb)
returns integer
language sql security definer volatile
set search_path = public, pg_temp
as $$
  with salt as (select t.ref_store_salt as s from track_runtime t where t.id = 1),
  rows as (
    select distinct on (x.k) x.*
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
      k text, status text, brand text, category text, size text, condition text,
      listed_price_cents integer, final_price_cents integer, final_price_estimated boolean,
      listed_at timestamptz, sold_at timestamptz, photo_count integer, ord integer)
    where p_source in ('track', 'demo') and x.k ~ '^[a-f0-9]{64}$'
    order by x.k, x.ord desc nulls last
  ),
  up as (
    insert into price_references (dedupe_key, source, status, brand, category, size, condition, listed_price_cents, final_price_cents, final_price_estimated, listed_at, sold_at, photo_count)
    select p_source || ':' || encode(sha256(convert_to((select s from salt) || '|' || r.k, 'UTF8')), 'hex'), p_source, coalesce(r.status, 'listed'), nullif(left(trim(r.brand), 80), ''), r.category,
      nullif(left(trim(r.size), 40), ''), r.condition, r.listed_price_cents, r.final_price_cents, coalesce(r.final_price_estimated, false),
      date_trunc('day', r.listed_at at time zone 'UTC') at time zone 'UTC', date_trunc('day', r.sold_at at time zone 'UTC') at time zone 'UTC',
      case when r.photo_count is null then null when r.photo_count >= 10 then 10 when r.photo_count >= 6 then 6 when r.photo_count >= 4 then 4 when r.photo_count >= 2 then 2 else greatest(0, r.photo_count) end
    from rows r
    on conflict (dedupe_key) do update set
      status = excluded.status,
      brand = coalesce(excluded.brand, price_references.brand),
      category = excluded.category,
      size = coalesce(excluded.size, price_references.size),
      condition = coalesce(excluded.condition, price_references.condition),
      listed_price_cents = coalesce(excluded.listed_price_cents, price_references.listed_price_cents),
      final_price_cents = excluded.final_price_cents,
      final_price_estimated = excluded.final_price_estimated,
      listed_at = coalesce(price_references.listed_at, excluded.listed_at),
      sold_at = excluded.sold_at,
      photo_count = coalesce(excluded.photo_count, price_references.photo_count),
      updated_at = now()
    returning 1
  )
  select count(*)::integer from up
$$;
revoke all on function app_track_store_references(text, jsonb) from public;

-- Réglages partagés de Track : fenêtre glissante (lectures, blocages), facteur, pause.
create or replace function app_track_runtime()
returns table (window_reads integer, window_blocks integer, slowdown_factor integer, last_block_at timestamptz, paused_until timestamptz, pause_reason text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select length(t.window_measures), length(t.window_measures) - length(replace(t.window_measures, 'b', '')), t.slowdown_factor, t.last_block_at, t.paused_until, t.pause_reason
  from track_runtime t where t.id = 1
$$;
revoke all on function app_track_runtime() from public;

-- Mesure d'une lecture en direct dans la fenêtre partagée, facteur après la lecture, pause éventuelle
-- (jamais raccourcie par un signal plus ancien). `p_factor` null (lecture sans blocage) : facteur et date
-- du dernier blocage inchangés — le facteur redescend d'un cran par 24 h depuis le dernier blocage
-- (calcul à la lecture), il n'est jamais réécrit déjà diminué.
create or replace function app_track_runtime_record(p_blocked boolean, p_factor integer, p_block_at timestamptz, p_pause_until timestamptz, p_pause_reason text)
returns void
language sql security definer volatile
set search_path = public, pg_temp
as $$
  update track_runtime set
    window_measures = right(window_measures || case when p_blocked then 'b' else 'o' end, 1000),
    slowdown_factor = case when p_factor is null then slowdown_factor else greatest(1, least(64, p_factor)) end,
    last_block_at = coalesce(p_block_at, last_block_at),
    paused_until = case when p_pause_until is null then paused_until else greatest(coalesce(paused_until, p_pause_until), p_pause_until) end,
    pause_reason = case when p_pause_until is null then pause_reason else p_pause_reason end,
    updated_at = now()
  where id = 1
$$;
revoke all on function app_track_runtime_record(boolean, integer, timestamptz, timestamptz, text) from public;

-- Rétention (tâche quotidienne du worker) : chaque empreinte garde l'historique du plan le plus long
-- parmi les organisations qui la suivent (12 mois au plus, 0 sans offre Track) ; une empreinte que
-- plus personne ne suit perd ses instantanés et sa ligne de lecture.
create or replace function app_track_purge(p_now timestamptz)
returns table (snapshots integer, fingerprints integer)
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  n_snap integer;
  n_fp integer;
begin
  with keep as (
    select f.fingerprint,
      least(12, max(case when s.quotas->>'trackHistoryMonths' ~ '^[0-9]+$' then (s.quotas->>'trackHistoryMonths')::integer else 0 end)) as months
    from track_filters f left join subscriptions s on s.org_id = f.org_id
    group by f.fingerprint
  ), del as (
    delete from track_snapshots t
    where not exists (
      select 1 from keep k where k.fingerprint = t.fingerprint and k.months > 0 and t.read_at >= p_now - make_interval(months => k.months)
    )
    returning 1
  )
  select count(*)::integer into n_snap from del;
  with gone as (
    delete from track_filter_reads r
    where not exists (select 1 from track_filters f where f.fingerprint = r.fingerprint)
    returning 1
  )
  select count(*)::integer into n_fp from gone;
  return query select n_snap, n_fp;
end;
$$;
revoke all on function app_track_purge(timestamptz) from public;

-- Organisations qui ont des données Track (passage de rétention du worker) : aucune donnée renvoyée.
create or replace function app_track_org_ids()
returns table (org_id text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select f.org_id from track_filters f
  union
  select s.org_id from track_scans s
  union
  select p.org_id from track_photo_searches p
$$;
revoke all on function app_track_org_ids() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_track_org_ids() to selio_app;
    grant execute on function app_track_follow(text, jsonb, timestamptz, boolean) to selio_app;
    grant execute on function app_track_state(text[]) to selio_app;
    grant execute on function app_track_due(timestamptz, integer) to selio_app;
    grant execute on function app_track_claim(text, timestamptz, timestamptz) to selio_app;
    grant execute on function app_track_finish(text, timestamptz, timestamptz, text, boolean, boolean, boolean, integer, jsonb, text) to selio_app;
    -- Clés de l'état des lectures : nécessaires au worker pour reconnaître une annonce d'une lecture à
    -- l'autre. Le worker et l'API partagent selio_app (pas de rôle worker distinct) : ces clés ne sont
    -- jamais celles des références (`app_track_store_references`, autre sel).
    grant execute on function app_track_ref_keys(text[]) to selio_app;
    grant execute on function app_track_store_references(text, jsonb) to selio_app;
    grant execute on function app_track_runtime() to selio_app;
    grant execute on function app_track_runtime_record(boolean, integer, timestamptz, timestamptz, text) to selio_app;
    grant execute on function app_track_purge(timestamptz) to selio_app;
  end if;
end $$;
