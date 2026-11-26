-- 0024 : bêta Selio (ouverture le lundi 30 novembre 2026). Additive et idempotente : peut être rejouée.
--
-- « Pour la bêta, les gens ne mettent pas leur carte bleue, mais ils mettent un code. Si le code est mis, ils
-- auront un mois gratuit. Le code, ce sera BETA2026SELIO. […] Au bout d'un mois, ça bloque s'ils ne mettent pas
-- de données bancaires » (Ibrahim).
--
-- 1) commercial_offers.kind : « discount » (remise, comme avant) ou « beta » (code de la bêta : accès de
--    `beta_days` jours au forfait de l'essai, sans carte, facture à 0 €). Une offre bêta garde une remise de
--    100 % (contrainte « exactement une remise » de 0020) mais n'est JAMAIS appliquée comme remise aux paiements
--    suivants (aucune ligne offer_redemptions) et n'apparaît jamais dans le bandeau public.
-- 2) beta_accesses : un accès bêta par organisation (org_id clé primaire : « une seule fois par compte »), RLS
--    org_isolation. Code saisi, offre, forfait, ouverture, facture à 0 €, écran de bienvenue vu, rappels J-7 / J-1
--    déjà envoyés (pour quelle date de fin : une prolongation les relance), et `ended_at` : fin du mois de bêta
--    sans moyen de paiement (compte bloqué tant que l'abonnement attend un paiement ; une prolongation, un accès
--    offert ou un paiement débloque).
-- 3) L'offre BETA2026SELIO (30 jours, sans maximum ni date de fin, active), créée si aucun code équivalent
--    n'existe : modifiable et désactivable dans Selio Admin › Offres.
-- 4) app_public_offer_banners : jamais une offre bêta (sinon les prix de la vitrine afficheraient 0 €).
-- 5) app_admin_accounts() rend aussi beta_started_at et beta_ended_at (Selio Admin › Comptes et tableau de bord).

alter table commercial_offers add column if not exists kind text not null default 'discount';
alter table commercial_offers add column if not exists beta_days integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commercial_offers_kind') then
    alter table commercial_offers add constraint commercial_offers_kind check (kind in ('discount', 'beta'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'commercial_offers_beta_days') then
    alter table commercial_offers add constraint commercial_offers_beta_days check (
      (kind = 'beta' and beta_days between 1 and 90) or (kind = 'discount' and beta_days is null)
    );
  end if;
end $$;

create table if not exists beta_accesses (
  org_id text primary key references organizations(id) on delete cascade,
  offer_id text references commercial_offers(id) on delete set null,
  code text,
  plan text not null default 'pro' check (plan in ('starter', 'pro', 'agence')),
  days integer not null check (days between 1 and 90),
  started_at timestamptz not null,
  invoice_id text references invoices(id) on delete set null,
  welcome_seen_at timestamptz,
  reminder7_for timestamptz,
  reminder1_for timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_beta_accesses_offer on beta_accesses(offer_id);

alter table beta_accesses enable row level security;
alter table beta_accesses force row level security;
drop policy if exists org_isolation on beta_accesses;
create policy org_isolation on beta_accesses for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org());

-- Le code de la bêta : seulement s'il n'existe aucun code équivalent (casse, espaces et tirets ignorés).
insert into commercial_offers (name, code, kind, beta_days, discount_percent, plans, duration_months, banner_enabled, banner_text, active)
select 'Bêta Selio', 'BETA2026SELIO', 'beta', 30, 100, array['pro']::text[], 1, false, 'Bêta Selio : 1 mois offert, sans carte, avec le code BETA2026SELIO', true
where not exists (select 1 from commercial_offers where regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = 'BETA2026SELIO');

create or replace function app_public_offer_banners(p_now timestamptz)
returns table (id text, name text, code text, discount_percent integer, discount_cents integer, plans text[], duration_months integer, ends_at timestamptz, banner_text text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select o.id, o.name, o.code, o.discount_percent, o.discount_cents, o.plans, o.duration_months, o.ends_at, o.banner_text
  from commercial_offers o
  where o.banner_enabled and o.active and o.archived_at is null and o.kind = 'discount'
    and (o.starts_at is null or o.starts_at <= p_now)
    and (o.ends_at is null or o.ends_at > p_now)
    and (o.max_redemptions is null or o.redemptions < o.max_redemptions)
  order by o.created_at desc
  limit 3
$$;
revoke all on function app_public_offer_banners(timestamptz) from public;

drop function if exists app_admin_accounts();
create function app_admin_accounts()
returns table (
  id text,
  name text,
  slug text,
  created_at timestamptz,
  qualification text,
  qualification_note text,
  qualified_by text,
  qualified_at timestamptz,
  plan text,
  status text,
  provider text,
  cycle text,
  current_period_end timestamptz,
  card_on_file boolean,
  cancel_at_period_end boolean,
  granted_until timestamptz,
  granted_by text,
  members bigint,
  owner_email text,
  awaiting_payment_since timestamptz,
  simulated_checkout_at timestamptz,
  beta_started_at timestamptz,
  beta_ended_at timestamptz
)
language sql security definer stable as $$
  select o.id, o.name, o.slug, o.created_at, o.qualification, o.qualification_note, o.qualified_by, o.qualified_at,
    coalesce(s.plan, 'free'), coalesce(s.status, 'none'), coalesce(s.provider, 'none'), coalesce(s.cycle, 'monthly'),
    s.current_period_end, coalesce(s.card_on_file, false), coalesce(s.cancel_at_period_end, false), s.granted_until, s.granted_by,
    (select count(*) from memberships m where m.org_id = o.id),
    (select u.email from memberships m join users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
    s.awaiting_payment_since, s.simulated_checkout_at, b.started_at, b.ended_at
  from organizations o left join subscriptions s on s.org_id = o.id left join beta_accesses b on b.org_id = o.id
  order by o.created_at desc
$$;
revoke all on function app_admin_accounts() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant select, insert, update, delete on beta_accesses to selio_app;
    grant execute on function app_public_offer_banners(timestamptz) to selio_app;
    grant execute on function app_admin_accounts() to selio_app;
  end if;
end $$;
