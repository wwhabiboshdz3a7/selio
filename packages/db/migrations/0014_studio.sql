-- 0014 — Studio façon Kavis : références de tailles, préparations d'annonce, photos portées
-- (4 novembre 2026). Migration additive et idempotente.
--
-- JAMAIS DE MESURE INVENTÉE : les mesures enregistrées ici portent leur provenance (mètre ruban
-- photographié, base de références, vendeur) ; une mesure inconnue reste vide avec une question.
--
-- Table partagée entre organisations (lecture pour tous, écriture par fonctions seulement) :
--   size_references   : mesures d'un modèle retrouvées par la référence lue sur l'étiquette
--                       (marque + référence + taille, unique par marque), famille de la pièce
--                       (GARMENT_KINDS), mesures en cm (MEASUREMENT_NAMES), source
--                       « provided » (fournie par l'opérateur) ou « seller_validated » (mesure validée
--                       par un vendeur qui a coché « partager anonymement la mesure »). AUCUNE donnée
--                       personnelle ni d'organisation : ni identifiant d'organisation, ni d'utilisateur,
--                       ni photo. Le rôle applicatif ne peut que lire ; l'écriture passe par deux
--                       fonctions SECURITY DEFINER : `app_size_reference_provide` (opérateur, contrôle
--                       applicatif `isOperator`) et `app_size_reference_contribute` (vendeur, n'écrase
--                       jamais une référence fournie, ne fait qu'ajouter les mesures manquantes).
--
-- Tables d'organisation (RLS forcée, politique org_isolation comme 0002_rls.sql) :
--   studio_preps      : préparation d'une annonce, une ligne par article (`batch_id` relie les articles
--                       d'un même envoi) : photos (clés de stockage et rôles, JAMAIS les images),
--                       champs lus avec provenance, mesures avec provenance, questions au vendeur,
--                       statut draft → validated.
--   worn_photo_jobs   : demandes de photo portée, exécutées la nuit (file `scheduled_for`) ; la photo
--                       d'origine et le résultat ne sont que des clés de stockage de l'organisation ;
--                       dépassement du quota (`overage_cents`, accord explicite daté) facturé au
--                       renouvellement (`billed_invoice_id`).
--
-- Facturation : `payment_orders.extra_lines` et `invoices.extra_lines` portent les lignes
-- supplémentaires (dépassement des photos portées) comprises dans `amount_cents`.

-- ---------------------------------------------------------------- contrôle des mesures (cm)
-- Objet { clé: nombre } : clés en minuscules (2 à 30 caractères), 20 mesures au plus, 0,5 à 300 cm.
create or replace function app_measurements_valid(p jsonb)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p)) <= 20
    and not exists (
      select 1 from jsonb_each(p) e
      where e.key !~ '^[a-z][a-z_]{1,29}$'
         or jsonb_typeof(e.value) <> 'number'
         or (e.value #>> '{}')::numeric < 0.5
         or (e.value #>> '{}')::numeric > 300
    )
$$;

-- ---------------------------------------------------------------- références de tailles (partagé)
create table if not exists size_references (
  id text primary key default gen_random_uuid()::text,
  brand text not null check (length(btrim(brand)) between 1 and 80 and length(regexp_replace(brand, '[^[:alnum:]]', '', 'g')) >= 1),
  reference text not null check (length(btrim(reference)) between 1 and 80 and length(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g')) >= 2),
  -- Taille mesurée ; null quand les mesures ne dépendent pas de la taille (sac, accessoire).
  size text check (size is null or length(btrim(size)) between 1 and 40),
  -- Clés normalisées : « Levi's » et « levis », « AB-123 » et « ab 123 », « W32 » et « w 32 » désignent la même ligne.
  brand_key text generated always as (lower(regexp_replace(brand, '[^[:alnum:]]', '', 'g'))) stored,
  reference_key text generated always as (upper(regexp_replace(reference, '[^A-Za-z0-9]', '', 'g'))) stored,
  size_key text generated always as (coalesce(lower(regexp_replace(size, '[^[:alnum:]]', '', 'g')), '')) stored,
  -- Famille de la pièce (elle fixe les mesures attendues) : mêmes valeurs que GARMENT_KINDS (@selio/contracts).
  category text not null default 'other' check (category in ('top', 'outerwear', 'dress', 'bottom', 'shoes', 'bag', 'accessory', 'other')),
  measurements jsonb not null check (app_measurements_valid(measurements) and measurements <> '{}'::jsonb),
  source text not null check (source in ('provided', 'seller_validated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_size_references_brand_ref_size on size_references(brand_key, reference_key, size_key);

-- ---------------------------------------------------------------- préparations Studio (organisation)
-- Une ligne par article retrouvé dans les photos ; les articles d'un même envoi partagent `batch_id`.
create table if not exists studio_preps (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  batch_id text not null,
  article_group integer not null default 1 check (article_group between 1 and 12),
  item_id text references inventory_items(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'validated')),
  -- [{ index, id, key|null, role, confidence }] : clés de stockage et rôles, jamais d'image.
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 12),
  -- { brand, size, material, reference } : { value, source (label | seller), confidence, question }.
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  -- [{ name, valueCm, source (tape_photo | reference_db | seller), confidence, question }].
  measurements jsonb not null default '[]'::jsonb check (jsonb_typeof(measurements) = 'array' and jsonb_array_length(measurements) <= 20),
  -- [{ field, reason, text }].
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 40),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  -- Reste de l'article : photos retenues pour le modèle, entretien, ruban visible, référence utilisée, OCR.
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  garment text check (garment is null or garment in ('top', 'outerwear', 'dress', 'bottom', 'shoes', 'bag', 'accessory', 'other')),
  category text check (category is null or category in ('women', 'men', 'kids', 'shoes', 'bags', 'accessories', 'home', 'electronics', 'other')),
  -- Lectures du simulateur (démonstration) : jamais présentées comme lues sur une vraie photo.
  simulated boolean not null default false,
  share_measurements boolean not null default false,
  validated_at timestamptz,
  listing_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_studio_preps_org_created on studio_preps(org_id, created_at desc);
create index if not exists idx_studio_preps_batch on studio_preps(org_id, batch_id);

-- ---------------------------------------------------------------- photos portées (organisation)
create table if not exists worn_photo_jobs (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  item_id text references inventory_items(id) on delete set null,
  -- Photo d'origine : clé de stockage de l'organisation (`org/<org>/<sorte>/<id>.<ext>`), jamais une URL.
  photo_key text not null check (photo_key ~ '^org/[A-Za-z0-9_-]+/(item-photo|studio-photo)/[A-Za-z0-9_-]+\.(jpg|png|webp)$' and starts_with(photo_key, 'org/' || org_id || '/')),
  pose text not null default 'front' check (pose in ('front', 'three_quarter', 'back')),
  -- Mêmes valeurs que WORN_PHOTO_STATUSES (@selio/contracts). Une demande annulée avant la nuit est supprimée.
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'refused')),
  -- Fournisseur configuré à la demande, puis celui qui l'a traitée ou refusée (« noop », « mock »…).
  provider text not null check (length(provider) between 1 and 40),
  result_key text check (result_key is null or (result_key ~ '^org/[A-Za-z0-9_-]+/[a-z-]+/[A-Za-z0-9_-]+\.(jpg|png|webp)$' and starts_with(result_key, 'org/' || org_id || '/'))),
  error text check (error is null or length(error) <= 500),
  scheduled_for timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  -- Place de quota réservée (usage_events « studio.worn_photo ») : rendue si la photo n'est pas produite.
  usage_event_id text,
  -- Dépassement du quota du plan : prix unitaire accepté (0 = dans le quota), date de l'accord explicite.
  overage_cents integer not null default 0 check (overage_cents between 0 and 10000),
  overage_accepted_at timestamptz,
  billed_invoice_id text references invoices(id) on delete set null,
  billed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (overage_cents = 0 or overage_accepted_at is not null)
);
create index if not exists idx_worn_photo_jobs_due on worn_photo_jobs(status, scheduled_for);
create index if not exists idx_worn_photo_jobs_org_created on worn_photo_jobs(org_id, created_at desc);
create index if not exists idx_worn_photo_jobs_unbilled on worn_photo_jobs(org_id, finished_at) where overage_cents > 0 and billed_invoice_id is null and status = 'done';

-- ---------------------------------------------------------------- facturation : lignes supplémentaires
alter table payment_orders add column if not exists extra_lines jsonb not null default '[]'::jsonb;
alter table invoices add column if not exists extra_lines jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_orders_extra_lines_array') then
    alter table payment_orders add constraint payment_orders_extra_lines_array check (jsonb_typeof(extra_lines) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_extra_lines_array') then
    alter table invoices add constraint invoices_extra_lines_array check (jsonb_typeof(extra_lines) = 'array');
  end if;
end $$;

-- ---------------------------------------------------------------- RLS et privilèges
alter table studio_preps enable row level security;
alter table studio_preps force row level security;
alter table worn_photo_jobs enable row level security;
alter table worn_photo_jobs force row level security;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    foreach t in array array['studio_preps', 'worn_photo_jobs'] loop
      execute format('drop policy if exists org_isolation on %I', t);
      execute format(
        'create policy org_isolation on %I for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
    end loop;
    grant select, insert, update, delete on studio_preps, worn_photo_jobs to selio_app;
    -- Références de tailles : lecture seule pour le rôle applicatif (les privilèges par défaut du schéma
    -- avaient tout accordé à la création) ; écriture par les fonctions ci-dessous.
    revoke all on size_references from selio_app;
    grant select on size_references to selio_app;
  end if;
end $$;

-- ---------------------------------------------------------------- fonctions (SECURITY DEFINER)

-- Référence fournie par l'opérateur (contrôle `isOperator` côté application) : crée ou remplace.
create or replace function app_size_reference_provide(p_brand text, p_reference text, p_size text, p_category text, p_measurements jsonb)
returns table (id text, source text)
language sql security definer volatile
set search_path = public, pg_temp
as $$
  insert into size_references as s (brand, reference, size, category, measurements, source)
  values (btrim(p_brand), btrim(p_reference), nullif(btrim(p_size), ''), coalesce(p_category, 'other'), p_measurements, 'provided')
  on conflict (brand_key, reference_key, size_key) do update set
    brand = excluded.brand,
    reference = excluded.reference,
    size = excluded.size,
    category = excluded.category,
    measurements = excluded.measurements,
    source = 'provided',
    updated_at = now()
  returning s.id, s.source
$$;
revoke all on function app_size_reference_provide(text, text, text, text, jsonb) from public;

-- Mesure validée par un vendeur qui a choisi de la partager anonymement : nouvelle ligne
-- « seller_validated », ou ajout des seules mesures manquantes d'une ligne « seller_validated »
-- (les mesures déjà connues ne sont jamais remplacées). Une référence fournie par l'opérateur
-- n'est jamais modifiée (aucune ligne rendue). Aucune donnée d'organisation ni de personne.
create or replace function app_size_reference_contribute(p_brand text, p_reference text, p_size text, p_category text, p_measurements jsonb)
returns table (id text, source text)
language sql security definer volatile
set search_path = public, pg_temp
as $$
  insert into size_references as s (brand, reference, size, category, measurements, source)
  values (btrim(p_brand), btrim(p_reference), nullif(btrim(p_size), ''), coalesce(p_category, 'other'), p_measurements, 'seller_validated')
  on conflict (brand_key, reference_key, size_key) do update set
    measurements = excluded.measurements || s.measurements,
    category = case when s.category = 'other' then excluded.category else s.category end,
    updated_at = now()
  where s.source = 'seller_validated'
  returning s.id, s.source
$$;
revoke all on function app_size_reference_contribute(text, text, text, text, jsonb) from public;

-- Photos portées à exécuter (worker) : demandes en file dont l'heure est venue, et demandes restées
-- « en cours » depuis avant `p_stale_before` (worker interrompu). Aucune donnée : identifiants seulement.
create or replace function app_worn_photo_due(p_now timestamptz, p_stale_before timestamptz, p_limit integer)
returns table (org_id text, id text, status text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select j.org_id, j.id, j.status from worn_photo_jobs j
  where (j.status = 'queued' and j.scheduled_for <= p_now)
     or (j.status = 'running' and j.started_at < p_stale_before)
  order by j.scheduled_for, j.created_at
  limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;
revoke all on function app_worn_photo_due(timestamptz, timestamptz, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_measurements_valid(jsonb) to selio_app;
    grant execute on function app_size_reference_provide(text, text, text, text, jsonb) to selio_app;
    grant execute on function app_size_reference_contribute(text, text, text, text, jsonb) to selio_app;
    grant execute on function app_worn_photo_due(timestamptz, timestamptz, integer) to selio_app;
  end if;
end $$;
