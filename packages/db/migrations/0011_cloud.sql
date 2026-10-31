-- 0011 — Selio Cloud (29 octobre 2026). Migration additive et idempotente.
--
-- Un navigateur isolé par compte Vinted sur notre machine ; le client se connecte lui-même dans ce
-- navigateur. AUCUN mot de passe Vinted n'est stocké nulle part : seule la session du compte
-- (cookies et stockage local des domaines vinted.*, filtrés avant chiffrement) est gardée, chiffrée
-- par le coffre serveur (SecretBox AES-256-GCM, clé SECRETS_ENCRYPTION_KEY hors base, données
-- associées = identifiant du compte Cloud), dans `cloud_accounts.session_ciphertext`. Elle est
-- effacée à l'arrêt, à la suppression de la session par le client, à la suppression de la
-- connexion (cascade) et quand Vinted ne reconnaît plus la session.
--
-- Tables :
--   cloud_consents       : accords enregistrés (version du texte, empreinte, date, utilisateur, IP).
--   cloud_accounts       : un compte Cloud par connexion Vinted (connection_id unique) ; statut,
--                          raison de pause, session chiffrée, verrou applicatif `running_since`.
--   cloud_actions        : journal des actions visible du client, conservé 90 jours (index org_id +
--                          created_at pour la pagination et la purge) ; `detail` ne porte jamais de
--                          secret ni le texte d'un message.
--   cloud_login_sessions : fenêtres de connexion ; le ticket n'est stocké qu'haché (SHA-256) et ne
--                          sert qu'une fois (`attached_at` posé à la première WebSocket).
--   cloud_runtime        : une seule ligne, sans donnée d'organisation : coupe-circuit de la machine
--                          (plus aucune action Cloud jusqu'à `suspended_until` après un « trop de
--                          requêtes » ou un blocage de Vinted sur l'adresse partagée).
--
-- Restauration d'une sauvegarde : `app_cloud_after_restore()` (à lancer juste après pg_restore, voir
-- docs/SAUVEGARDE.md) met tous les comptes Cloud en pause (raison « restored »), efface toutes les
-- sessions et annule les tâches et fenêtres Cloud en cours : rien de ce que le client avait arrêté ou
-- supprimé depuis la sauvegarde ne reprend tout seul.
--
-- RLS : tables d'organisation, même politique org_isolation que les autres (0002_rls.sql). Le worker
-- qui termine une connexion ne connaît que l'identifiant de la fenêtre ou son ticket : une fonction
-- SECURITY DEFINER limitée lui rend l'organisation et le compte sans ouvrir la table. Une seconde
-- fonction liste les organisations qui ont des comptes Cloud (passages du planificateur, purge),
-- sans rien révéler d'autre.
--
-- jobs.runs_in accepte désormais « cloud » (colonne texte sans contrainte) : un index partiel sert
-- la recherche des tâches Cloud échues.

create table if not exists cloud_consents (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  -- Pas de clé étrangère vers users : l'accord est une trace qui doit survivre au départ du membre.
  user_id text not null,
  version text not null,
  text_hash text not null,
  accepted_at timestamptz not null default now(),
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cloud_consents_org_accepted on cloud_consents(org_id, accepted_at desc);

create table if not exists cloud_accounts (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  connection_id text not null unique references marketplace_connections(id) on delete cascade,
  status text not null default 'needs_login' check (status in ('needs_login','active','paused','stopped')),
  paused_reason text,
  paused_at timestamptz,
  session_ciphertext bytea,
  session_saved_at timestamptz,
  last_action_at timestamptz,
  warnings_count integer not null default 0,
  settings jsonb not null default '{"levels":["light"]}'::jsonb,
  -- Verrou applicatif : posé le temps d'un passage du planificateur, libéré ensuite ; un verrou
  -- plus vieux que CLOUD_LOCK_STALE_MINUTES est considéré abandonné.
  running_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_cloud_accounts_org_status on cloud_accounts(org_id, status);
-- Raisons de pause : client, signaux de Vinted, passage interrompu, restauration d'une sauvegarde.
-- Contrainte nommée, remplacée à chaque passage (la migration reste rejouable sur une base plus ancienne).
alter table cloud_accounts drop constraint if exists cloud_accounts_paused_reason_check;
alter table cloud_accounts add constraint cloud_accounts_paused_reason_check
  check (paused_reason is null or paused_reason in ('client','captcha','warning','blocked','rate_limited','interrupted','restored'));

create table if not exists cloud_actions (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  account_id text not null references cloud_accounts(id) on delete cascade,
  kind text not null check (kind in ('reply','follow_up','republish','bulk_edit')),
  level text not null check (level in ('light','heavy')),
  status text not null check (status in ('queued','running','done','failed','skipped','paused')),
  detail jsonb not null default '{}'::jsonb,
  job_id text references jobs(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_cloud_actions_org_created on cloud_actions(org_id, created_at desc);
create index if not exists idx_cloud_actions_account_created on cloud_actions(account_id, created_at desc);

create table if not exists cloud_login_sessions (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  account_id text not null references cloud_accounts(id) on delete cascade,
  ticket_hash text not null unique,
  status text not null default 'open' check (status in ('open','done','expired','cancelled')),
  -- Ticket consommé par la première WebSocket : toute seconde connexion est refusée.
  attached_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table cloud_login_sessions add column if not exists attached_at timestamptz;
create index if not exists idx_cloud_login_sessions_org_status on cloud_login_sessions(org_id, status);
create index if not exists idx_cloud_login_sessions_account on cloud_login_sessions(account_id);

create index if not exists idx_jobs_cloud_due on jobs(org_id, scheduled_for) where runs_in = 'cloud' and status = 'queued';

-- Coupe-circuit de la machine (une seule ligne, aucune donnée d'organisation, donc hors RLS).
create table if not exists cloud_runtime (
  id smallint primary key default 1 check (id = 1),
  suspended_until timestamptz,
  reason text check (reason is null or reason in ('rate_limited','blocked')),
  updated_at timestamptz not null default now()
);
insert into cloud_runtime (id) values (1) on conflict (id) do nothing;

-- RLS : même politique que les autres tables d'organisation (0002_rls.sql), forcée pour selio_app
-- (le rôle est créé par 0002). Activée sans condition : la sécurité ne dépend pas des privilèges.
alter table cloud_consents enable row level security;
alter table cloud_consents force row level security;
alter table cloud_accounts enable row level security;
alter table cloud_accounts force row level security;
alter table cloud_actions enable row level security;
alter table cloud_actions force row level security;
alter table cloud_login_sessions enable row level security;
alter table cloud_login_sessions force row level security;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    foreach t in array array['cloud_consents','cloud_accounts','cloud_actions','cloud_login_sessions'] loop
      execute format('drop policy if exists org_isolation on %I', t);
      execute format(
        'create policy org_isolation on %I for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
    end loop;
    grant select, insert, update, delete on cloud_consents, cloud_accounts, cloud_actions, cloud_login_sessions to selio_app;
    grant select, update on cloud_runtime to selio_app;
  end if;
end $$;

-- Fenêtre de connexion retrouvée par identifiant ou par empreinte de ticket, hors contexte
-- d'organisation (le worker qui ferme la fenêtre ne connaît que l'un des deux). Aucun secret :
-- l'empreinte sert à la comparaison à temps constant côté application.
-- Le type de retour a changé (attached_at) : la fonction est recréée.
drop function if exists app_find_cloud_login_session(text, text);
create function app_find_cloud_login_session(p_id text, p_ticket_hash text)
returns table (id text, org_id text, account_id text, status text, expires_at timestamptz, ticket_hash text, attached_at timestamptz)
language sql security definer stable as $$
  select id, org_id, account_id, status, expires_at, ticket_hash, attached_at
  from cloud_login_sessions
  where (p_id is not null and id = p_id) or (p_ticket_hash is not null and ticket_hash = p_ticket_hash)
  limit 1
$$;
revoke all on function app_find_cloud_login_session(text, text) from public;

-- Organisations ayant au moins un compte Cloud, quel que soit son statut (passages du planificateur,
-- purge du journal, fenêtres expirées) : le worker les parcourt une à une avec le contexte RLS de
-- chacune. Aucune donnée de compte n'est renvoyée.
create or replace function app_cloud_org_ids()
returns table (org_id text)
language sql security definer stable as $$
  select distinct a.org_id from cloud_accounts a
$$;
revoke all on function app_cloud_org_ids() from public;

-- Après une restauration (bascule sur le portable, retour sur la machine) : rien ne reprend tout seul.
-- Exécutée par le propriétaire de la base (pg_restore), jamais par selio_app (aucun droit accordé).
-- Comptes non arrêtés → pause « restored » ; toutes les sessions effacées (y compris celles que le
-- client avait supprimées après la sauvegarde) ; verrous libérés ; fenêtres de connexion fermées ;
-- tâches Cloud en file ou en cours annulées (elles ont pu être exécutées après la sauvegarde). Rend le
-- nombre de comptes touchés.
create or replace function app_cloud_after_restore()
returns integer
language plpgsql as $$
declare
  n integer;
begin
  update cloud_accounts
     set status = case when status = 'stopped' then 'stopped' else 'paused' end,
         paused_reason = case when status = 'stopped' then null else 'restored' end,
         paused_at = case when status = 'stopped' then paused_at else now() end,
         session_ciphertext = null,
         session_saved_at = null,
         running_since = null,
         updated_at = now();
  get diagnostics n = row_count;
  update cloud_login_sessions set status = 'cancelled', updated_at = now() where status = 'open';
  update jobs set status = 'cancelled', updated_at = now() where runs_in = 'cloud' and status in ('queued', 'running', 'awaiting_approval');
  update cloud_actions set status = 'failed', finished_at = now() where status in ('queued', 'running');
  update cloud_runtime set suspended_until = null, reason = null, updated_at = now();
  return n;
end;
$$;
revoke all on function app_cloud_after_restore() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_find_cloud_login_session(text, text) to selio_app;
    grant execute on function app_cloud_org_ids() to selio_app;
  end if;
end $$;
