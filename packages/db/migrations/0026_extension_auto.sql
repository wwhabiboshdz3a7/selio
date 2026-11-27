-- 0026 : automatisation complète par l'extension, navigateur du vendeur ouvert (D64). Additive et idempotente.
--
-- « Le plein automatique doit aussi marcher SANS Selio Cloud, par l'extension, tant que le Chrome du vendeur
-- est ouvert. Pas de dernier clic » (Ibrahim, 27 novembre 2026).
--
-- 1) extension_autos : un réglage par compte Vinted (connexion) — interrupteur « Automatisation complète dans
--    ce navigateur » (désactivé par défaut), pause venue de Vinted (CAPTCHA, avertissement, blocage, trop de
--    requêtes : reprise par le client seulement), dernier contact de l'extension (routage des tâches), rythme
--    humain (dernière action, prochaine action permise). RLS org_isolation.
-- 2) cloud_actions : le journal du Cloud reçoit aussi les actions faites par l'extension, avec la source
--    « browser » (« navigateur ») et le compte Vinted (connection_id) à la place du compte Cloud.

create table if not exists extension_autos (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  connection_id text not null references marketplace_connections(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by text,
  paused_reason text check (paused_reason is null or paused_reason in ('client','captcha','warning','blocked','rate_limited','interrupted')),
  paused_at timestamptz,
  warnings_count integer not null default 0,
  last_seen_at timestamptz,
  last_action_at timestamptz,
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, connection_id)
);

alter table extension_autos enable row level security;
alter table extension_autos force row level security;

alter table cloud_actions add column if not exists source text not null default 'cloud';
alter table cloud_actions add column if not exists connection_id text references marketplace_connections(id) on delete cascade;
alter table cloud_actions alter column account_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cloud_actions_source_check') then
    alter table cloud_actions add constraint cloud_actions_source_check check (
      (source = 'cloud' and account_id is not null) or (source = 'browser' and connection_id is not null)
    );
  end if;
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    drop policy if exists org_isolation on extension_autos;
    create policy org_isolation on extension_autos for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org());
    grant select, insert, update, delete on extension_autos to selio_app;
  end if;
end $$;

create index if not exists idx_cloud_actions_connection_created on cloud_actions(connection_id, created_at desc) where connection_id is not null;
create index if not exists idx_jobs_browser_auto on jobs(org_id, scheduled_for) where runs_in = 'browser' and status = 'queued' and payload->>'extAuto' = 'true';

-- Organisations suivies par le passage du Cloud et l'entretien du journal (purge à 90 jours) : comptes Cloud
-- ET comptes en automatisation complète par l'extension.
create or replace function app_cloud_org_ids()
returns table (org_id text)
language sql security definer stable as $$
  select a.org_id from cloud_accounts a
  union
  select e.org_id from extension_autos e
$$;
revoke all on function app_cloud_org_ids() from public;
