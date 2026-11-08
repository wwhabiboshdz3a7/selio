-- 0016 : rôles d'équipe (§5.15) et parrainage (« un mois offert aux deux »).
--
-- 1) Rôles : memberships.role accepte « photographer » (contributeur photos) en plus de owner (titulaire),
--    admin (administrateur), operator (exécuteur) et viewer (lecture seule). Les invitations (table invites)
--    ne portent pas de rôle : le rôle est celui de l'appartenance créée à l'invitation, couverte par la même
--    contrainte. La RLS est INCHANGÉE : elle isole les organisations entre elles (app.org_id), pas les rôles
--    à l'intérieur d'une organisation. Les restrictions par rôle (exécuteur sans finances, contributeur
--    photos limité aux articles, photos et générateur) sont applicatives : matrice ALLOWED de
--    @selio/domain (permissions.ts), `requireAction` et `redactForRole` de @selio/core.
--
-- 2) Parrainage :
--    - referral_codes : un code unique de 6 caractères lisibles par organisation (créé à la première
--      demande). Table globale (comme memberships) : le code est cherché à l'inscription, avant de connaître
--      l'organisation marraine ; elle ne contient aucune donnée métier.
--    - referrals : lien marraine → filleule, une filleule au plus (referred_org_id unique), jamais
--      soi-même ; pending (inscrite) → qualified (premier paiement réussi, deux crédits accordés) →
--      credited (les deux mois offerts appliqués). Table globale : elle relie deux organisations ;
--      chaque organisation n'en voit, côté application, que les compteurs (aucun nom de l'autre).
--    - subscription_credits : mois offerts d'une organisation (RLS org_isolation), un par organisation et
--      par parrainage (unique), consommé au renouvellement à la place du débit (facture à 0 €).

alter table memberships drop constraint if exists memberships_role_check;
alter table memberships add constraint memberships_role_check check (role in ('owner', 'admin', 'operator', 'photographer', 'viewer'));

create table if not exists referral_codes (
  org_id text primary key references organizations(id) on delete cascade,
  code text not null unique check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists referrals (
  id text primary key default gen_random_uuid()::text,
  code text not null,
  referrer_org_id text not null references organizations(id) on delete cascade,
  referred_org_id text not null unique references organizations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'credited')),
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  credited_at timestamptz,
  constraint referrals_not_self check (referrer_org_id <> referred_org_id)
);
create index if not exists idx_referrals_referrer on referrals(referrer_org_id);

create table if not exists subscription_credits (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  kind text not null default 'referral' check (kind in ('referral')),
  months integer not null default 1 check (months between 1 and 12),
  source_referral_id text references referrals(id) on delete set null,
  consumed_at timestamptz,
  invoice_id text references invoices(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Idempotence de la qualification : un seul crédit par organisation et par parrainage.
create unique index if not exists uq_subscription_credits_source on subscription_credits(org_id, source_referral_id) where source_referral_id is not null;
create index if not exists idx_subscription_credits_available on subscription_credits(org_id, created_at) where consumed_at is null;

alter table subscription_credits enable row level security;
alter table subscription_credits force row level security;
drop policy if exists org_isolation on subscription_credits;
create policy org_isolation on subscription_credits for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org());

-- Un parrainage qualifié passe « credited » quand ses deux mois offerts ont été consommés. Les crédits des
-- deux organisations sont sous RLS : la vérification passe par cette fonction bornée (aucune donnée rendue
-- au-delà du nouvel état), appelée après la consommation d'un crédit.
create or replace function app_referral_settle(p_referral_id text, p_now timestamptz)
returns text
language plpgsql security definer volatile
set search_path = public, pg_temp
as $$
declare
  s text;
begin
  update referrals set status = 'credited', credited_at = p_now
  where id = p_referral_id and status = 'qualified'
    and exists (select 1 from subscription_credits c where c.source_referral_id = p_referral_id)
    and not exists (select 1 from subscription_credits c where c.source_referral_id = p_referral_id and c.consumed_at is null);
  select status into s from referrals where id = p_referral_id;
  return s;
end
$$;
revoke all on function app_referral_settle(text, timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant select, insert, update, delete on referral_codes, referrals, subscription_credits to selio_app;
    grant execute on function app_referral_settle(text, timestamptz) to selio_app;
  end if;
end $$;
