-- 0020 : offres commerciales (promotions sur les forfaits payants, gérées par l'équipe Selio).
--
-- « C'est moi qui choisis qui la nomme et qui fixe la réduc et le code promo et ça l'affiche sur le bandeau
-- en haut si besoin » (Ibrahim). Les forfaits (Starter, Pro, Agence) et leurs prix ne changent pas : une
-- offre est une remise appliquée au paiement et aux renouvellements.
--
-- 1) commercial_offers : table GLOBALE (comme referral_codes), écrite seulement par les routes d'administration
--    (opérateurs Selio) ; aucune donnée d'organisation. Nom affiché, code promo facultatif (A-Z, 0-9 et tiret,
--    3 à 24 caractères, stocké en majuscules, unique sans tenir compte de la casse), remise en pourcentage
--    (1 à 100) OU montant fixe par échéance (exactement l'une des deux), forfaits concernés (vide = tous),
--    durée en mois (null = tant que l'abonnement dure ; une échéance annuelle consomme 12 mois et reçoit la
--    remise une seule fois), période, maximum d'utilisations, bandeau (texte ≤ 140, construit s'il est vide),
--    actif, auteur, dates, archivage. `redemptions` compte les organisations qui l'ont appliquée : incrémenté
--    atomiquement sous le maximum (deux applications concurrentes ne dépassent jamais `max_redemptions`).
--    Suppression réelle seulement si l'offre n'a jamais servi ; sinon archivage (archived_at, inactive).
-- 2) offer_redemptions : offre appliquée à une organisation (RLS org_isolation, comme subscription_credits) :
--    INSTANTANÉ de la remise (nom, code, pourcentage ou montant, forfaits, durée) au moment où le code est
--    appliqué, et mois restants (null = sans limite), décrémentés seulement quand une échéance est réellement
--    payée ou facturée à 0 €. Une seule offre par organisation (org_id unique) : une nouvelle ne remplace
--    l'ancienne que si l'équipe Selio le fait. La référence à l'offre empêche sa suppression (archivage).
-- 3) app_public_offer_banners : lecture publique bornée du bandeau (sans session) : nom, texte, code, remise,
--    forfaits, durée et fin des offres actives, dans leur période, sous leur maximum et avec bandeau. Jamais
--    l'auteur ni les compteurs.

create table if not exists commercial_offers (
  id text primary key default gen_random_uuid()::text,
  name text not null check (char_length(name) between 2 and 80),
  code text check (code is null or code ~ '^[A-Z0-9-]{3,24}$'),
  discount_percent integer check (discount_percent is null or discount_percent between 1 and 100),
  discount_cents integer check (discount_cents is null or discount_cents between 1 and 1000000),
  plans text[] not null default '{}' check (plans <@ array['starter', 'pro', 'agence']::text[]),
  duration_months integer check (duration_months is null or duration_months between 1 and 36),
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions >= 1),
  redemptions integer not null default 0 check (redemptions >= 0),
  banner_enabled boolean not null default false,
  banner_text text check (banner_text is null or char_length(banner_text) <= 140),
  active boolean not null default true,
  created_by text references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint commercial_offers_one_discount check ((discount_percent is null) <> (discount_cents is null)),
  constraint commercial_offers_period check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint commercial_offers_max check (max_redemptions is null or redemptions <= max_redemptions)
);
-- Code unique sans tenir compte de la casse (il est déjà stocké en majuscules ; l'index le garantit aussi).
create unique index if not exists uq_commercial_offers_code on commercial_offers (upper(code)) where code is not null;
create index if not exists idx_commercial_offers_banner on commercial_offers (created_at desc) where banner_enabled and active and archived_at is null;

create table if not exists offer_redemptions (
  id text primary key default gen_random_uuid()::text,
  org_id text not null unique references organizations(id) on delete cascade,
  offer_id text not null references commercial_offers(id) on delete restrict,
  name text not null,
  code text,
  discount_percent integer check (discount_percent is null or discount_percent between 1 and 100),
  discount_cents integer check (discount_cents is null or discount_cents between 1 and 1000000),
  plans text[] not null default '{}' check (plans <@ array['starter', 'pro', 'agence']::text[]),
  duration_months integer check (duration_months is null or duration_months between 1 and 36),
  months_remaining integer check (months_remaining is null or months_remaining >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offer_redemptions_one_discount check ((discount_percent is null) <> (discount_cents is null))
);
create index if not exists idx_offer_redemptions_offer on offer_redemptions(offer_id);

alter table offer_redemptions enable row level security;
alter table offer_redemptions force row level security;
drop policy if exists org_isolation on offer_redemptions;
create policy org_isolation on offer_redemptions for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org());

-- Bandeau public : colonnes bornées, offres visibles seulement (rien d'autre n'est rendu).
create or replace function app_public_offer_banners(p_now timestamptz)
returns table (id text, name text, code text, discount_percent integer, discount_cents integer, plans text[], duration_months integer, ends_at timestamptz, banner_text text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select o.id, o.name, o.code, o.discount_percent, o.discount_cents, o.plans, o.duration_months, o.ends_at, o.banner_text
  from commercial_offers o
  where o.banner_enabled and o.active and o.archived_at is null
    and (o.starts_at is null or o.starts_at <= p_now)
    and (o.ends_at is null or o.ends_at > p_now)
    and (o.max_redemptions is null or o.redemptions < o.max_redemptions)
  order by o.created_at desc
  limit 3
$$;
revoke all on function app_public_offer_banners(timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant select, insert, update, delete on commercial_offers, offer_redemptions to selio_app;
    grant execute on function app_public_offer_banners(timestamptz) to selio_app;
  end if;
end $$;
