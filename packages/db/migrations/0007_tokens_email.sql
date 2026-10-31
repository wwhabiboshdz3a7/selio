-- 0007 — Jetons à usage unique envoyés par email : réinitialisation de mot de passe
-- et invitations. Migration additive et idempotente.
--
-- Le jeton brut (32 octets, base64url) n'est jamais stocké : seule son empreinte
-- SHA-256 (token_hash) l'est. Un jeton sert une fois (used_at / accepted_at) et
-- expire (1 h pour le mot de passe, 7 jours pour l'invitation).
--
-- RLS : comme users et sessions (0002_rls.sql), ces deux tables sont GLOBALES.
-- Elles sont manipulées hors de tout contexte d'organisation (la personne n'est
-- pas connectée quand elle suit le lien) et ne portent aucune donnée métier :
-- pas de politique org_isolation, accès par le rôle applicatif via withGlobal.

create table if not exists password_resets (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_password_resets_user on password_resets(user_id);
create index if not exists idx_password_resets_expires on password_resets(expires_at);

create table if not exists invites (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_invites_org_user on invites(org_id, user_id);
create index if not exists idx_invites_expires on invites(expires_at);

-- Les privilèges par défaut de 0002 couvrent déjà les nouvelles tables ; la clause
-- explicite garantit l'accès du rôle applicatif même si la migration tourne ailleurs.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant select, insert, update, delete on password_resets, invites to selio_app;
  end if;
end $$;
