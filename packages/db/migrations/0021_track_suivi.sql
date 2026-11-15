-- 0021 : Selio Track, suivi et exploitation. Additive et idempotente.
--
-- 1) Alertes de tendance par filtre : réglage `track_filters.alert_rules` (coupé par défaut) et historique
--    `track_alert_events` (organisation, RLS forcée) : règle, variation, référence, message, lecture qui l'a
--    déclenchée. Agrégats seulement : aucune annonce, aucun pseudo, aucune photo. Une alerte par filtre et
--    par règle au plus toutes les 24 h (contrôlé par le cœur, sous un verrou de l'organisation).
-- 2) Notification : la file `radar_alerts` (Web Push de la PWA, tâche « alerts.send ») accepte le type
--    `track_trend`.
-- 3) Pause manuelle de Track posée par un opérateur « tech » (`track_runtime.manual_*`) : respectée par le
--    worker à chaque lecture, sans redémarrage, quelle que soit la source (simulateur ou direct).
-- 4) Journal partagé des lectures (`track_read_log`, 7 jours) : empreinte, source, résultat, compteurs,
--    facteur, code. Aucune donnée d'organisation ni de personne ; aucun droit direct pour l'application.
-- 5) Fonctions SECURITY DEFINER de lecture pour l'administration (`/admin/track`) et pour le worker
--    (organisations à prévenir après un instantané) : rien d'autre n'est ouvert.

-- ---------------------------------------------------------------- 1) alertes de tendance
alter table track_filters add column if not exists alert_rules jsonb not null default '{}'::jsonb;

create table if not exists track_alert_events (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  filter_id text not null references track_filters(id) on delete cascade,
  rule text not null check (rule in ('median_price', 'new_listings', 'days_to_sell')),
  source text not null default 'demo' check (source in ('demo', 'cloud')),
  value double precision not null,
  reference double precision,
  message text not null check (length(message) <= 400),
  notified boolean not null default false,
  read_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_track_alert_events_filter on track_alert_events(org_id, filter_id, rule, created_at desc);

alter table track_alert_events enable row level security;
alter table track_alert_events force row level security;

-- ---------------------------------------------------------------- 2) file des notifications
alter table radar_alerts drop constraint if exists radar_alerts_kind_check;
alter table radar_alerts add constraint radar_alerts_kind_check check (kind in ('opportunity', 'blocked', 'payment_3ds', 'track_trend'));

-- ---------------------------------------------------------------- 3) pause manuelle
alter table track_runtime add column if not exists manual_paused boolean not null default false;
alter table track_runtime add column if not exists manual_paused_at timestamptz;
alter table track_runtime add column if not exists manual_paused_by text;
alter table track_runtime add column if not exists manual_pause_reason text check (manual_pause_reason is null or length(manual_pause_reason) <= 300);

-- ---------------------------------------------------------------- 4) journal des lectures (partagé)
create table if not exists track_read_log (
  id bigserial primary key,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  read_at timestamptz not null,
  source text not null check (source in ('demo', 'cloud')),
  outcome text not null check (length(outcome) <= 40),
  listed integer not null default 0 check (listed >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  gone_count integer not null default 0 check (gone_count >= 0),
  factor integer not null default 1 check (factor between 1 and 64),
  message text check (message is null or length(message) <= 200)
);
create index if not exists idx_track_read_log_read on track_read_log(read_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    execute 'drop policy if exists org_isolation on track_alert_events';
    execute 'create policy org_isolation on track_alert_events for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org())';
    grant select, insert, update, delete on track_alert_events to selio_app;
    -- Journal partagé : fonctions SECURITY DEFINER seulement.
    revoke all on track_read_log from selio_app;
    revoke all on sequence track_read_log_id_seq from selio_app;
  end if;
end $$;

-- ---------------------------------------------------------------- 5) fonctions

-- Pause manuelle (lecture).
create or replace function app_track_manual_pause()
returns table (paused boolean, since timestamptz, by_user text, reason text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select t.manual_paused, t.manual_paused_at, t.manual_paused_by, t.manual_pause_reason from track_runtime t where t.id = 1
$$;
revoke all on function app_track_manual_pause() from public;

-- Pause manuelle (écriture) : l'API la réserve aux opérateurs « tech » et l'audite (`admin.track_*`).
create or replace function app_track_set_manual_pause(p_paused boolean, p_by text, p_reason text)
returns table (paused boolean, since timestamptz, by_user text, reason text)
language sql security definer volatile
set search_path = public, pg_temp
as $$
  update track_runtime set
    manual_paused = p_paused,
    manual_paused_at = case when p_paused then coalesce(case when manual_paused then manual_paused_at end, now()) else null end,
    manual_paused_by = case when p_paused then left(p_by, 100) else null end,
    manual_pause_reason = case when p_paused then left(p_reason, 300) else null end,
    updated_at = now()
  where id = 1
  returning manual_paused, manual_paused_at, manual_paused_by, manual_pause_reason
$$;
revoke all on function app_track_set_manual_pause(boolean, text, text) from public;

-- Journal d'une lecture (worker) ; les lignes de plus de 7 jours sont effacées au passage.
create or replace function app_track_log_read(
  p_fingerprint text, p_read_at timestamptz, p_source text, p_outcome text, p_listed integer, p_new integer, p_gone integer, p_factor integer, p_message text)
returns void
language sql security definer volatile
set search_path = public, pg_temp
as $$
  delete from track_read_log where read_at < p_read_at - interval '7 days';
  insert into track_read_log (fingerprint, read_at, source, outcome, listed, new_count, gone_count, factor, message)
  values (p_fingerprint, p_read_at, p_source, left(p_outcome, 40), greatest(0, coalesce(p_listed, 0)), greatest(0, coalesce(p_new, 0)), greatest(0, coalesce(p_gone, 0)),
    greatest(1, least(64, coalesce(p_factor, 1))), left(p_message, 200));
$$;
revoke all on function app_track_log_read(text, timestamptz, text, text, integer, integer, integer, integer, text) from public;

-- Dernières lectures (administration) : toutes, ou seulement les anomalies et blocages.
create or replace function app_track_admin_reads(p_limit integer, p_problems_only boolean)
returns table (fingerprint text, read_at timestamptz, source text, outcome text, listed integer, new_count integer, gone_count integer, factor integer, message text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select l.fingerprint, l.read_at, l.source, l.outcome, l.listed, l.new_count, l.gone_count, l.factor, l.message
  from track_read_log l
  where not p_problems_only or l.outcome <> 'ok'
  order by l.read_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 200))
$$;
revoke all on function app_track_admin_reads(integer, boolean) from public;

-- Compteurs de l'administration : empreintes suivies, dues, ralenties ; lectures des dernières 24 h.
create or replace function app_track_admin_counts(p_now timestamptz)
returns table (followed integer, due integer, slowed integer, reads_24h integer, ok_24h integer, anomalies_24h integer, blocked_24h integer)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select
    (select count(*)::integer from track_filter_reads r where exists (select 1 from track_filters f where f.fingerprint = r.fingerprint and f.enabled)),
    (select count(*)::integer from track_filter_reads r where r.next_read_at <= p_now and exists (select 1 from track_filters f where f.fingerprint = r.fingerprint and f.enabled)),
    (select count(*)::integer from track_filter_reads r where r.factor > 1 and exists (select 1 from track_filters f where f.fingerprint = r.fingerprint and f.enabled)),
    (select count(*)::integer from track_read_log l where l.read_at >= p_now - interval '24 hours'),
    (select count(*)::integer from track_read_log l where l.read_at >= p_now - interval '24 hours' and l.outcome = 'ok'),
    (select count(*)::integer from track_read_log l where l.read_at >= p_now - interval '24 hours' and l.outcome in ('page_changed', 'error', 'timeout')),
    (select count(*)::integer from track_read_log l where l.read_at >= p_now - interval '24 hours' and l.outcome in ('blocked', 'captcha', 'rate_limited'))
$$;
revoke all on function app_track_admin_counts(timestamptz) from public;

-- Utilisation de Track par organisation (administration) : filtres (tous, actifs, avec alertes), scans et
-- recherches par photo du mois. Aucun critère, aucun nom de filtre.
create or replace function app_track_admin_org_usage(p_month_start timestamptz)
returns table (org_id text, name text, plan text, quotas jsonb, filters integer, enabled_filters integer, alert_filters integer, scans integer, photo_searches integer)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select o.id, o.name, coalesce(s.plan, 'free'), coalesce(s.quotas, '{}'::jsonb),
    (select count(*)::integer from track_filters f where f.org_id = o.id),
    (select count(*)::integer from track_filters f where f.org_id = o.id and f.enabled),
    (select count(*)::integer from track_filters f where f.org_id = o.id and f.enabled and coalesce((f.alert_rules->>'enabled')::boolean, false)),
    coalesce((select sum(u.quantity)::integer from usage_events u where u.org_id = o.id and u.kind = 'track.scan' and u.created_at >= p_month_start), 0),
    coalesce((select sum(u.quantity)::integer from usage_events u where u.org_id = o.id and u.kind = 'track.photo_search' and u.created_at >= p_month_start), 0)
  from organizations o left join subscriptions s on s.org_id = o.id
  order by o.created_at
$$;
revoke all on function app_track_admin_org_usage(timestamptz) from public;

-- Filtres suivis par organisation (vue « utilisation par client » de l'administration).
create or replace function app_track_filter_counts()
returns table (org_id text, filters integer)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select f.org_id, count(*)::integer from track_filters f group by f.org_id
$$;
revoke all on function app_track_filter_counts() from public;

-- Organisations et filtres à évaluer après un instantané (worker) : filtres actifs de l'empreinte, alertes
-- allumées. Aucune autre donnée.
create or replace function app_track_alert_targets(p_fingerprint text)
returns table (org_id text, filter_id text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select f.org_id, f.id from track_filters f
  where f.fingerprint = p_fingerprint and f.enabled and coalesce((f.alert_rules->>'enabled')::boolean, false)
  order by f.org_id, f.id
$$;
revoke all on function app_track_alert_targets(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_track_manual_pause() to selio_app;
    grant execute on function app_track_set_manual_pause(boolean, text, text) to selio_app;
    grant execute on function app_track_log_read(text, timestamptz, text, text, integer, integer, integer, integer, text) to selio_app;
    grant execute on function app_track_admin_reads(integer, boolean) to selio_app;
    grant execute on function app_track_admin_counts(timestamptz) to selio_app;
    grant execute on function app_track_admin_org_usage(timestamptz) to selio_app;
    grant execute on function app_track_filter_counts() to selio_app;
    grant execute on function app_track_alert_targets(text) to selio_app;
  end if;
end $$;
