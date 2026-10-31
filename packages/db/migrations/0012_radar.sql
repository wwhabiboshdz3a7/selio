-- 0012 — Selio Radar en direct et Radar Auto (29 octobre 2026). Migration additive et idempotente.
--
-- Lecture des recherches EN DIRECT depuis le compte Achat du client, par Selio Cloud (session
-- chiffrée du compte Cloud, accord Cloud enregistré), au rythme de 60 s (30 s pour 3 recherches
-- prioritaires quand Radar Auto est ouvert), avec ralentissement automatique au-delà de 1 blocage
-- pour 1 000 pages. Aucun contournement : un CAPTCHA, un avertissement ou un « trop de requêtes »
-- arrête la lecture, met le compte Cloud en pause et prévient le client.
--
-- Changements :
--   radar_searches   : source (demo | cloud), priorité, compte Achat lu, facteur de ralentissement,
--                      dernière lecture, dernier blocage, compteurs de pages et de blocages, lectures
--                      anormales consécutives et raison d'un arrêt décidé par Selio.
--   radar_org_state  : facteur de ralentissement et dernier blocage PAR ORGANISATION (appliqués à
--                      toutes ses recherches en direct ; survivent à la suppression d'une recherche).
--   cloud_accounts   : held_until, compte tenu par un achat qui attend la validation 3-D Secure
--                      (aucune lecture, action ni second achat sur le compte pendant ce temps).
--   opportunities    : index de dédoublonnage par référence Vinted (observed->>'externalRef'),
--                      unique par organisation.
--   purchase_requests: total réel, référence de commande Vinted, article créé dans Manager, délai de
--                      validation 3-D Secure, « Payer » cliqué (compté dans le plafond du jour même
--                      si l'issue est incertaine), compte Cloud de l'achat ; une seule demande active
--                      par affaire (si l'existant le permet).
--   radar_reads      : mesures de chaque lecture et des pages ouvertes par un achat (durée, résultat,
--                      pages, annonces vues et nouvelles, facteur), gardées 90 jours ; base du taux de
--                      blocage, du ralentissement et des plafonds de pages par minute.
--   push_subscriptions : abonnements Web Push des appareils (PWA) ; l'adresse (endpoint) est unique.
--   radar_alerts     : file des alertes (une par affaire, une par paiement 3-D Secure en attente, une
--                      par blocage), sans donnée personnelle du vendeur.
--   embeddings_cache : vecteurs du modèle 2 (titres des ventes, observations, affaires), par modèle.
--
-- RLS : tables d'organisation, même politique org_isolation que les autres (0002_rls.sql), forcée.

-- ---------------------------------------------------------------- recherches
alter table radar_searches add column if not exists source text not null default 'demo';
alter table radar_searches add column if not exists priority boolean not null default false;
alter table radar_searches add column if not exists connection_id text references marketplace_connections(id) on delete set null;
alter table radar_searches add column if not exists slowdown_factor integer not null default 1;
alter table radar_searches add column if not exists last_read_at timestamptz;
alter table radar_searches add column if not exists last_block_at timestamptz;
alter table radar_searches add column if not exists pages_read integer not null default 0;
alter table radar_searches add column if not exists blocks_count integer not null default 0;
alter table radar_searches add column if not exists consecutive_failures integer not null default 0;
alter table radar_searches add column if not exists suspended_reason text;
alter table radar_searches drop constraint if exists radar_searches_source_check;
alter table radar_searches add constraint radar_searches_source_check check (source in ('demo', 'cloud'));
alter table radar_searches drop constraint if exists radar_searches_slowdown_factor_check;
alter table radar_searches add constraint radar_searches_slowdown_factor_check check (slowdown_factor between 1 and 64);
alter table radar_searches drop constraint if exists radar_searches_counters_check;
alter table radar_searches add constraint radar_searches_counters_check check (pages_read >= 0 and blocks_count >= 0 and consecutive_failures >= 0);
create index if not exists idx_radar_searches_org_source on radar_searches(org_id, source) where enabled;

-- ---------------------------------------------------------------- affaires
-- Une annonce Vinted (référence numérique) ne donne qu'une affaire par organisation, quelle que soit
-- la recherche qui l'a trouvée. Les anciennes affaires (sans référence) ne sont pas concernées.
create unique index if not exists uq_opportunities_org_external_ref
  on opportunities(org_id, (observed->>'externalRef'))
  where observed->>'externalRef' is not null;
create index if not exists idx_opportunities_org_status_updated on opportunities(org_id, status, updated_at);

-- ---------------------------------------------------------------- demandes d'achat
alter table purchase_requests add column if not exists total_cents integer;
alter table purchase_requests add column if not exists order_ref text;
alter table purchase_requests add column if not exists reported_item_id text references inventory_items(id) on delete set null;
alter table purchase_requests add column if not exists awaiting3ds_until timestamptz;
-- « Payer » cliqué : le paiement a pu partir. La demande reste comptée dans le plafond du jour (même
-- bloquée ou annulée) jusqu'à vérification par un humain.
alter table purchase_requests add column if not exists payment_attempted boolean not null default false;
-- Compte Selio Cloud dont le navigateur a servi à l'achat : la reprise 3-D Secure n'en accepte pas d'autre.
alter table purchase_requests add column if not exists cloud_account_id text references cloud_accounts(id) on delete set null;
alter table purchase_requests drop constraint if exists purchase_requests_total_cents_check;
alter table purchase_requests add constraint purchase_requests_total_cents_check check (total_cents is null or total_cents >= 0);
create index if not exists idx_purchases_org_awaiting3ds on purchase_requests(org_id, awaiting3ds_until) where status = 'awaiting_3ds';

-- Une seule demande active (ni annulée ni bloquée) par affaire : deux passages simultanés de l'achat
-- automatique ne peuvent pas acheter deux fois. Créé seulement si l'existant ne contient aucun doublon
-- (sinon : avertissement, l'application continue d'éviter les doublons par sa vérification).
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_purchase_requests_active_dedupe') then
    if exists (
      select 1 from purchase_requests
      where status not in ('cancelled', 'blocked')
      group by org_id, dedupe_key having count(*) > 1
    ) then
      raise warning 'purchase_requests : doublons actifs existants, index unique uq_purchase_requests_active_dedupe non créé';
    else
      create unique index uq_purchase_requests_active_dedupe on purchase_requests(org_id, dedupe_key) where status not in ('cancelled', 'blocked');
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- compte tenu par un achat (3-D Secure)
-- Pendant l'attente de la validation bancaire, le navigateur de l'achat reste ouvert avec la session
-- du compte : le verrou applicatif (`lock`) refuse toute lecture, action Cloud ou second achat sur ce
-- compte jusqu'à `held_until` (ou jusqu'à l'issue de l'achat, qui libère le compte).
alter table cloud_accounts add column if not exists held_until timestamptz;

-- ---------------------------------------------------------------- ralentissement par organisation
-- Le facteur s'applique à toutes les recherches en direct de l'organisation (même adresse, mêmes
-- comptes Achat) et survit à la suppression ou à la recréation d'une recherche.
create table if not exists radar_org_state (
  org_id text primary key references organizations(id) on delete cascade,
  slowdown_factor integer not null default 1 check (slowdown_factor between 1 and 64),
  last_block_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- mesures de lecture (90 jours)
create table if not exists radar_reads (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  -- « search » : page de recherche ; « purchase » : pages ouvertes par un achat de Radar Auto.
  kind text not null default 'search' check (kind in ('search', 'purchase')),
  -- Les mesures survivent à la suppression d'une recherche ou d'un compte (taux de blocage honnête).
  search_id text references radar_searches(id) on delete set null,
  connection_id text references marketplace_connections(id) on delete set null,
  -- « demo » : simulateur, jamais compté dans les statistiques ni dans le ralentissement.
  source text not null default 'cloud' check (source in ('demo', 'cloud')),
  read_at timestamptz not null default now(),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  outcome text not null,
  items_seen integer not null default 0 check (items_seen >= 0),
  items_new integer not null default 0 check (items_new >= 0),
  pages integer not null default 1 check (pages >= 0),
  factor integer not null default 1 check (factor >= 1),
  created_at timestamptz not null default now()
);
-- Bases créées avant ces colonnes (migration rejouable).
alter table radar_reads add column if not exists kind text not null default 'search';
alter table radar_reads add column if not exists pages integer not null default 1;
alter table radar_reads drop constraint if exists radar_reads_kind_check;
alter table radar_reads add constraint radar_reads_kind_check check (kind in ('search', 'purchase'));
alter table radar_reads drop constraint if exists radar_reads_pages_check;
alter table radar_reads add constraint radar_reads_pages_check check (pages >= 0);
alter table radar_reads drop constraint if exists radar_reads_outcome_check;
alter table radar_reads add constraint radar_reads_outcome_check check (outcome in ('ok', 'blocked', 'captcha', 'rate_limited', 'page_changed', 'error', 'timeout'));
create index if not exists idx_radar_reads_org_read_at on radar_reads(org_id, read_at desc);

-- ---------------------------------------------------------------- abonnements Web Push
create table if not exists push_subscriptions (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text check (user_agent is null or length(user_agent) <= 120),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  failures integer not null default 0 check (failures >= 0),
  disabled_at timestamptz
);
create index if not exists idx_push_subscriptions_org_active on push_subscriptions(org_id) where disabled_at is null;

-- ---------------------------------------------------------------- file des alertes
create table if not exists radar_alerts (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  -- Supprimée avec l'affaire (purge des données du vendeur).
  opportunity_id text references opportunities(id) on delete cascade,
  -- Une alerte de paiement 3-D Secure suit sa demande d'achat (supprimée avec elle).
  purchase_id text references purchase_requests(id) on delete cascade,
  -- Destinataire unique (null : tous les appareils abonnés de l'organisation).
  user_id text references users(id) on delete cascade,
  kind text not null default 'opportunity' check (kind in ('opportunity', 'blocked', 'payment_3ds')),
  channel text not null default 'push' check (channel in ('push', 'email')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  -- Une alerte par affaire (« opportunity:<id> »), par demande d'achat, par blocage.
  dedupe_key text not null,
  -- Titre, texte et chemin dans l'application : jamais de pseudo, de note ni de photo du vendeur.
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create unique index if not exists uq_radar_alerts_opportunity on radar_alerts(opportunity_id) where kind = 'opportunity' and opportunity_id is not null;
create index if not exists idx_radar_alerts_due on radar_alerts(org_id, scheduled_for) where status = 'queued';

-- ---------------------------------------------------------------- cache des embeddings (modèle 2)
create table if not exists embeddings_cache (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('sale', 'market', 'opportunity')),
  ref text not null,
  model text not null,
  dims integer not null check (dims > 0),
  -- Empreinte du texte vectorisé : un titre modifié est revectorisé.
  text_hash text not null,
  vector jsonb not null,
  created_at timestamptz not null default now(),
  unique (org_id, kind, ref, model)
);

-- ---------------------------------------------------------------- RLS et privilèges
alter table radar_reads enable row level security;
alter table radar_reads force row level security;
alter table radar_org_state enable row level security;
alter table radar_org_state force row level security;
alter table push_subscriptions enable row level security;
alter table push_subscriptions force row level security;
alter table radar_alerts enable row level security;
alter table radar_alerts force row level security;
alter table embeddings_cache enable row level security;
alter table embeddings_cache force row level security;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    foreach t in array array['radar_reads', 'radar_org_state', 'push_subscriptions', 'radar_alerts', 'embeddings_cache'] loop
      execute format('drop policy if exists org_isolation on %I', t);
      execute format(
        'create policy org_isolation on %I for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
    end loop;
    grant select, insert, update, delete on radar_reads, radar_org_state, push_subscriptions, radar_alerts, embeddings_cache to selio_app;
  end if;
end $$;

-- Organisations qui ont une recherche active ou une alerte en file (passages du worker) : aucune
-- donnée de recherche ni d'alerte n'est renvoyée.
create or replace function app_radar_org_ids()
returns table (org_id text)
language sql security definer stable as $$
  select s.org_id from radar_searches s where s.enabled
  union
  select a.org_id from radar_alerts a where a.status = 'queued'
  union
  select p.org_id from purchase_requests p where p.status = 'awaiting_3ds'
$$;
revoke all on function app_radar_org_ids() from public;

-- Un appareil (adresse Web Push unique) ne reçoit les alertes que d'une organisation : quand il
-- s'abonne pour une autre, son ancien abonnement est retiré. Seul le navigateur connaît l'adresse
-- (aléatoire, fournie par le service de notification) ; rien n'est renvoyé.
create or replace function app_push_endpoint_release(p_endpoint text, p_org text)
returns void
language sql security definer volatile as $$
  delete from push_subscriptions where endpoint = p_endpoint and org_id <> p_org
$$;
revoke all on function app_push_endpoint_release(text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_radar_org_ids() to selio_app;
    grant execute on function app_push_endpoint_release(text, text) to selio_app;
  end if;
end $$;
