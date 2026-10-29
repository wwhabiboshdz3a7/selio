-- 0006 — Vue administrateur de l'utilisation par client (docs §5.2).
-- Les tables usage_events et subscriptions sont isolées par RLS (une organisation à la fois) ;
-- l'opérateur a besoin d'un résumé de toutes les organisations d'un coup. Comme
-- app_admin_org_summary (0002), une fonction SECURITY DEFINER limitée renvoie, par organisation,
-- le plan et ses quotas, les compteurs du mois (par type d'événement) et les actions Cloud du jour,
-- sans ouvrir les tables. Aucun secret, aucune donnée de vendeur tiers. Migration idempotente.

create or replace function app_admin_org_usage(p_month_start timestamptz, p_day_start timestamptz)
returns table (
  id text,
  name text,
  plan text,
  status text,
  quotas jsonb,
  created_at timestamptz,
  members bigint,
  items bigint,
  connections bigint,
  month_usage jsonb,
  cloud_today bigint
)
language sql security definer stable as $$
  select o.id, o.name, coalesce(s.plan, 'free'), coalesce(s.status, 'none'), coalesce(s.quotas, '{}'::jsonb), o.created_at,
    (select count(*) from memberships m where m.org_id = o.id),
    (select count(*) from inventory_items i where i.org_id = o.id and i.status <> 'archived'),
    (select count(*) from marketplace_connections c where c.org_id = o.id and c.provider <> 'demo'),
    coalesce((
      select jsonb_object_agg(u.kind, u.total)
      from (select ue.kind, sum(ue.quantity) as total from usage_events ue where ue.org_id = o.id and ue.created_at >= p_month_start group by ue.kind) u
    ), '{}'::jsonb),
    coalesce((select sum(ue.quantity) from usage_events ue where ue.org_id = o.id and ue.kind = 'cloud.action' and ue.created_at >= p_day_start), 0)
  from organizations o left join subscriptions s on s.org_id = o.id
  order by o.created_at
$$;
revoke all on function app_admin_org_usage(timestamptz, timestamptz) from public;
grant execute on function app_admin_org_usage(timestamptz, timestamptz) to selio_app;
