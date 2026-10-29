-- 0010 — Facturation Revolut : corrections de relecture (29 octobre 2026). Migration additive
-- et idempotente ; aucune colonne ni table supprimée.
--
-- 1) invoice_counters : la numérotation des factures (SEL-AAAA-000001, continue, exigence légale)
--    passe d'une séquence SQL par année à un compteur en table mis à jour DANS la transaction
--    d'émission. Une séquence ne revient pas en arrière quand la transaction est annulée (un numéro
--    était perdu) ; une ligne de compteur, si. La ligne de l'année est verrouillée le temps de la
--    transaction : deux factures simultanées reçoivent deux numéros qui se suivent. Les séquences
--    déjà créées (invoice_seq_AAAA) et les factures existantes amorcent le compteur, sans rupture ;
--    les anciennes séquences restent en place, inutilisées.
-- 2) invoices.order_id unique : filet de sécurité contre une double facture pour une même commande
--    (worker et webhook ORDER_COMPLETED concurrents). La clôture d'une commande est aussi rendue
--    conditionnelle dans le code (update … where state <> 'completed').
-- 3) payment_events.claimed_at : réservation atomique d'une livraison de webhook. Deux livraisons
--    identiques et simultanées (Revolut renvoie) : la seconde est un doublon tant que la première
--    est en cours (2 minutes) ou traitée ; une réservation dont le traitement a échoué est relâchée.

create table if not exists invoice_counters (
  year integer primary key,
  last integer not null default 0
);

-- Reprise de la numérotation : plus grand numéro déjà émis par année (factures) et séquences 0009.
do $$
declare
  r record;
  n bigint;
  called boolean;
begin
  for r in select substring(number from 5 for 4)::integer as year, max(substring(number from 10)::integer) as last
           from invoices where number ~ '^SEL-[0-9]{4}-[0-9]{6}$' group by 1 loop
    insert into invoice_counters (year, last) values (r.year, r.last)
      on conflict (year) do update set last = greatest(invoice_counters.last, excluded.last);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where c.relkind = 'S' and ns.nspname = current_schema() and c.relname ~ '^invoice_seq_[0-9]{4}$' loop
    execute format('select last_value, is_called from %I', r.relname) into n, called;
    insert into invoice_counters (year, last) values (substring(r.relname from 13)::integer, case when called then n else 0 end)
      on conflict (year) do update set last = greatest(invoice_counters.last, excluded.last);
  end loop;
end $$;

-- Numéro suivant : compteur de l'année incrémenté dans la transaction appelante (ligne verrouillée
-- jusqu'au commit ; annulation de la transaction = numéro rendu). SECURITY DEFINER : le rôle
-- applicatif n'ouvre pas la table.
create or replace function app_next_invoice_number(p_year integer)
returns text
language plpgsql security definer as $$
declare
  n integer;
begin
  if p_year < 2000 or p_year > 2999 then
    raise exception 'année de facture invalide : %', p_year;
  end if;
  insert into invoice_counters (year, last) values (p_year, 1)
    on conflict (year) do update set last = invoice_counters.last + 1
    returning last into n;
  return format('SEL-%s-%s', p_year, lpad(n::text, 6, '0'));
end $$;
revoke all on function app_next_invoice_number(integer) from public;

create unique index if not exists uq_invoices_order on invoices(order_id) where order_id is not null;

alter table payment_events add column if not exists claimed_at timestamptz;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_next_invoice_number(integer) to selio_app;
  end if;
end $$;
