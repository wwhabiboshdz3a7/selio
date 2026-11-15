-- 0023 : paiement simulé en attendant Revolut. Additive et idempotente.
--
-- 1) subscriptions.simulated_checkout_at : date à laquelle le client a confirmé son offre SANS carte (mode de
--    paiement simulé : Revolut pas encore configuré, ou PAYMENT_MODE=simulated). Aucune commande, aucun débit.
-- 2) subscriptions.awaiting_payment_since : essai terminé alors que le paiement n'était pas activé ; le compte
--    est en accès de base « en attente du paiement ». L'opérateur peut prolonger l'essai ou offrir l'accès
--    (Selio Admin) ; un paiement réel, plus tard, efface la marque.
-- 3) app_admin_accounts() rend aussi awaiting_payment_since (Selio Admin › Comptes) : la fonction est recréée
--    avec la colonne en dernier (aucune autre colonne ne change).

alter table subscriptions add column if not exists simulated_checkout_at timestamptz;
alter table subscriptions add column if not exists awaiting_payment_since timestamptz;

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
  awaiting_payment_since timestamptz
)
language sql security definer stable as $$
  select o.id, o.name, o.slug, o.created_at, o.qualification, o.qualification_note, o.qualified_by, o.qualified_at,
    coalesce(s.plan, 'free'), coalesce(s.status, 'none'), coalesce(s.provider, 'none'), coalesce(s.cycle, 'monthly'),
    s.current_period_end, coalesce(s.card_on_file, false), coalesce(s.cancel_at_period_end, false), s.granted_until, s.granted_by,
    (select count(*) from memberships m where m.org_id = o.id),
    (select u.email from memberships m join users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
    s.awaiting_payment_since
  from organizations o left join subscriptions s on s.org_id = o.id
  order by o.created_at desc
$$;
revoke all on function app_admin_accounts() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_admin_accounts() to selio_app;
  end if;
end $$;
