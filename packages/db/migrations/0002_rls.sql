-- Isolation multi-tenant par Row Level Security.
-- L'API se connecte avec un rôle NON superuser (selio_app) et pose, à chaque
-- transaction, `set local app.org_id = '<org>'`. Toute lecture/écriture hors
-- de cette organisation est refusée par PostgreSQL, en plus des contrôles
-- applicatifs. Les tables globales (users, sessions, organizations,
-- memberships, payment_events, rate_limits) sont accessibles au rôle
-- applicatif sans filtre : elles ne contiennent pas de données métier par org.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'selio_app') then
    create role selio_app login password 'selio_app' nobypassrls;
  end if;
end $$;

grant usage on schema public to selio_app;
grant select, insert, update, delete on all tables in schema public to selio_app;
alter default privileges in schema public grant select, insert, update, delete on tables to selio_app;

create or replace function app_current_org() returns text
language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'marketplace_connections','inventory_items','inventory_events','customers','conversations','messages',
    'orders','shipments','automation_rules','automation_state','jobs','radar_searches','opportunities',
    'purchase_requests','ai_requests','usage_events','subscriptions','audit_logs','extension_tokens'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists org_isolation on %I', t);
    execute format(
      'create policy org_isolation on %I for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org())', t);
  end loop;
end $$;

-- audit_logs : les entrées globales (org_id null) sont visibles de l'opérateur via le rôle propriétaire uniquement.
-- Les jetons d'extension doivent être retrouvables par préfixe avant de connaître l'organisation :
-- une fonction SECURITY DEFINER limitée renvoie l'org et le hash, sans ouvrir la table.
create or replace function app_find_extension_token(p_prefix text)
returns table (id text, org_id text, user_id text, secret_hash text, scopes jsonb, expires_at timestamptz, revoked_at timestamptz)
language sql security definer stable as $$
  select id, org_id, user_id, secret_hash, scopes, expires_at, revoked_at
  from extension_tokens where prefix = p_prefix limit 1
$$;
revoke all on function app_find_extension_token(text) from public;
grant execute on function app_find_extension_token(text) to selio_app;

create or replace function app_touch_extension_token(p_id text)
returns void language sql security definer as $$
  update extension_tokens set last_used_at = now() where id = p_id
$$;
revoke all on function app_touch_extension_token(text) from public;
grant execute on function app_touch_extension_token(text) to selio_app;

-- Les webhooks de paiement doivent pouvoir retrouver un abonnement par référence externe.
create or replace function app_find_subscription_by_ref(p_ref text)
returns table (id text, org_id text)
language sql security definer stable as $$
  select id, org_id from subscriptions where external_ref = p_ref or stripe_customer_id = p_ref limit 1
$$;
revoke all on function app_find_subscription_by_ref(text) from public;
grant execute on function app_find_subscription_by_ref(text) to selio_app;

-- Vue opérateur agrégée (aucune donnée métier détaillée, aucun secret).
create or replace function app_admin_org_summary()
returns table (id text, name text, plan text, members bigint, items bigint, created_at timestamptz)
language sql security definer stable as $$
  select o.id, o.name, coalesce(s.plan, 'free'),
    (select count(*) from memberships m where m.org_id = o.id),
    (select count(*) from inventory_items i where i.org_id = o.id),
    o.created_at
  from organizations o left join subscriptions s on s.org_id = o.id
  order by o.created_at
$$;
revoke all on function app_admin_org_summary() from public;
grant execute on function app_admin_org_summary() to selio_app;
