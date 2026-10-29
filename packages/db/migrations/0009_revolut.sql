-- 0009 — Paiement avec Revolut (Merchant API) à la place de l'ancien adaptateur de test.
-- Migration additive et idempotente.
--
-- 1) subscriptions : identifiants Revolut (client, moyen de paiement « pour le marchand » :
--    jamais un numéro de carte), périodicité, offre en attente, relances après échec
--    (J+1, J+3, J+7 après l'échéance), conservation des données après le retour à l'accès
--    de base. Les lignes d'un fournisseur autre que « none » ou « revolut » repassent à
--    « none » (aucun abonnement réel n'a existé chez l'ancien adaptateur de test). La colonne
--    historique de cet adaptateur (0001) reste en place, vide : aucune suppression de colonne.
-- 2) payment_orders : une ligne par commande créée chez le fournisseur (autorisation pendant
--    l'essai, paiement depuis le formulaire, renouvellement et relances). Le webhook retrouve
--    l'organisation par order_id via une fonction SECURITY DEFINER, sans ouvrir la table.
-- 3) invoices : factures numérotées SEL-AAAA-000001, séquentielles par année (une séquence SQL
--    par année, créée à la demande sous verrou consultatif).
-- 4) payment_events : idempotence par (fournisseur, commande, événement) — l'identifiant de
--    ligne est « revolut:<order_id>:<event> » ; order_id est aussi stocké à part.
--
-- RLS : payment_orders et invoices sont des tables d'organisation (politique org_isolation,
-- RLS forcée), comme subscriptions. payment_events reste globale (0002).

alter table subscriptions add column if not exists revolut_customer_id text;
alter table subscriptions add column if not exists payment_method_id text;
alter table subscriptions add column if not exists cycle text not null default 'monthly';
alter table subscriptions add column if not exists pending_plan text;
alter table subscriptions add column if not exists charge_attempts integer not null default 0;
alter table subscriptions add column if not exists next_charge_at timestamptz;
alter table subscriptions add column if not exists last_charge_error text;
alter table subscriptions add column if not exists data_retention_until timestamptz;
update subscriptions set provider = 'none' where provider not in ('none', 'revolut');

-- Les webhooks retrouvent un abonnement par référence externe ou par client Revolut.
create or replace function app_find_subscription_by_ref(p_ref text)
returns table (id text, org_id text)
language sql security definer stable as $$
  select id, org_id from subscriptions where external_ref = p_ref or revolut_customer_id = p_ref limit 1
$$;
revoke all on function app_find_subscription_by_ref(text) from public;

create table if not exists payment_orders (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  order_id text not null unique,
  kind text not null,
  plan text not null,
  cycle text not null default 'monthly',
  amount_cents integer not null,
  capture_mode text not null,
  state text not null default 'pending',
  attempt integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_payment_orders_org on payment_orders(org_id, created_at desc);

create table if not exists invoices (
  id text primary key default gen_random_uuid()::text,
  org_id text not null references organizations(id) on delete cascade,
  number text not null unique,
  plan text not null,
  cycle text not null default 'monthly',
  amount_cents integer not null,
  vat_rate numeric(5,2) not null default 20,
  vat_notice text,
  period_start timestamptz not null,
  period_end timestamptz not null,
  order_id text,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_invoices_org on invoices(org_id, issued_at desc);

alter table payment_events add column if not exists order_id text;
create index if not exists idx_payment_events_order on payment_events(order_id);

-- Numéro de facture séquentiel par année : SEL-2026-000001, SEL-2026-000002… Une séquence par
-- année (invoice_seq_2026), créée à la première facture de l'année sous verrou consultatif de
-- transaction (deux premières factures simultanées ne créent pas la séquence en double).
-- À appeler juste avant l'insertion, en fin de transaction : une séquence ne revient pas en
-- arrière si la transaction échoue ensuite.
create or replace function app_next_invoice_number(p_year integer)
returns text
language plpgsql security definer as $$
declare
  seq_name text := format('invoice_seq_%s', p_year);
  n bigint;
begin
  if p_year < 2000 or p_year > 2999 then
    raise exception 'année de facture invalide : %', p_year;
  end if;
  perform pg_advisory_xact_lock(727009, p_year);
  execute format('create sequence if not exists %I', seq_name);
  execute format('select nextval(%L)', seq_name) into n;
  return format('SEL-%s-%s', p_year, lpad(n::text, 6, '0'));
end $$;
revoke all on function app_next_invoice_number(integer) from public;

-- Le webhook ne connaît que l'identifiant de commande : retrouver l'organisation sans ouvrir la table.
create or replace function app_find_payment_order(p_order_id text)
returns table (id text, org_id text, kind text, state text)
language sql security definer stable as $$
  select id, org_id, kind, state from payment_orders where order_id = p_order_id limit 1
$$;
revoke all on function app_find_payment_order(text) from public;

do $$
declare t text;
begin
  foreach t in array array['payment_orders', 'invoices'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists org_isolation on %I', t);
    execute format('create policy org_isolation on %I for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant select, insert, update, delete on payment_orders, invoices to selio_app;
    grant execute on function app_find_subscription_by_ref(text) to selio_app;
    grant execute on function app_next_invoice_number(integer) to selio_app;
    grant execute on function app_find_payment_order(text) to selio_app;
  end if;
end $$;
