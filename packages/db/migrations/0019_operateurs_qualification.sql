-- 0019 : Selio Admin — qualification des comptes et accès offert. Additive et idempotente.
--
-- 1) organizations : qualification fixée par un opérateur Selio (client par défaut, bêta, partenaire, équipe
--    Selio, test, bloqué), note interne (500 caractères au plus, jamais montrée au client), auteur et date.
--    « bloque » : la session des membres est refusée par l'API (sauf pour un opérateur).
-- 2) subscriptions : accès offert (`granted_until`, null = aucun) et son auteur (`granted_by`). Un accès
--    offert est un abonnement actif sans fournisseur de paiement : jamais débité ni rétrogradé avant
--    `granted_until` ; à l'échéance, le worker le ramène à l'accès de base (ligne d'audit). Sans fin
--    (équipe Selio) : 9999-12-31.
-- 3) app_admin_accounts() : vue opérateur des comptes (organisation + abonnement + membres + titulaire),
--    SECURITY DEFINER comme app_admin_org_usage : `subscriptions` est isolée par RLS, la lecture globale
--    passe par cette fonction (aucun secret, aucune donnée métier).
--
-- organizations reste une table globale (sans RLS) ; subscriptions garde sa politique org_isolation.

alter table organizations add column if not exists qualification text not null default 'client';
alter table organizations drop constraint if exists organizations_qualification_check;
alter table organizations add constraint organizations_qualification_check
  check (qualification in ('client', 'beta', 'partenaire', 'equipe', 'test', 'bloque'));
alter table organizations add column if not exists qualification_note text;
alter table organizations drop constraint if exists organizations_qualification_note_check;
alter table organizations add constraint organizations_qualification_note_check
  check (qualification_note is null or char_length(qualification_note) <= 500);
alter table organizations add column if not exists qualified_by text references users(id) on delete set null;
alter table organizations add column if not exists qualified_at timestamptz;
create index if not exists idx_organizations_qualification on organizations(qualification) where qualification <> 'client';

alter table subscriptions add column if not exists granted_until timestamptz;
alter table subscriptions add column if not exists granted_by text references users(id) on delete set null;

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
  owner_email text
)
language sql security definer stable as $$
  select o.id, o.name, o.slug, o.created_at, o.qualification, o.qualification_note, o.qualified_by, o.qualified_at,
    coalesce(s.plan, 'free'), coalesce(s.status, 'none'), coalesce(s.provider, 'none'), coalesce(s.cycle, 'monthly'),
    s.current_period_end, coalesce(s.card_on_file, false), coalesce(s.cancel_at_period_end, false), s.granted_until, s.granted_by,
    (select count(*) from memberships m where m.org_id = o.id),
    (select u.email from memberships m join users u on u.id = m.user_id where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1)
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
