-- 0008 — Rattrapage des quotas d'abonnement et vue administrateur alignée sur le quota IA réel.
--
-- 1) Les offres 1/3/10 (Starter, Pro, Agence) ont ajouté les champs par filiale au JSON `quotas`
--    (studioListingsPerMonth, trackScansPerMonth, cloudIncluded, followUp24h…). Les abonnements
--    créés avant gardaient leur ancien JSON : un Pro inscrit avant le changement avait encore
--    3 000 réponses IA, 5 comptes et 10 membres… et 0 annonce Studio (lu avec les défauts du
--    schéma → « Studio n'est pas inclus dans votre offre »). On réécrit ces lignes avec les quotas
--    de leur plan. Seules les lignes SANS champ par filiale sont touchées : un JSON complet est
--    un devis sur mesure (ou déjà à jour) et reste intact. Les valeurs ci-dessous sont la copie de
--    PLAN_QUOTAS (packages/contracts/src/org.ts) au 28 octobre 2026 ; le test de packages/db
--    vérifie qu'elles n'ont pas divergé. Le code applique la même règle à la lecture
--    (`resolveQuotas`) pour les lignes que cette migration n'aurait pas vues.
--
-- 2) app_admin_org_usage (0006) ne renvoyait que les usage_events : le compteur « Réponses de mon
--    IA perso » de la vue administrateur comptait les succès face au quota du plan, alors que le
--    refus compte toutes les lignes ai_requests (hors aide) face au plus petit entre le plan et le
--    réglage de l'organisation. La fonction renvoie désormais aussi ce décompte et `settings.ai`.
--    Le type de retour change : il faut supprimer puis recréer la fonction.
--
-- Migration idempotente.

update subscriptions set quotas = '{"items":50,"aiRequestsPerMonth":50,"automationActionsPerDay":10,"connections":1,"members":1,"studioListingsPerMonth":0,"wornPhotosPerMonth":0,"trackFiltersFollowed":0,"trackScansPerMonth":0,"trackPhotoSearchesPerMonth":0,"trackHistoryMonths":0,"cloudIncluded":false,"followUp24h":"none"}'::jsonb
  where plan = 'free' and not (quotas ? 'studioListingsPerMonth');
update subscriptions set quotas = '{"items":500,"aiRequestsPerMonth":300,"automationActionsPerDay":100,"connections":1,"members":1,"studioListingsPerMonth":0,"wornPhotosPerMonth":0,"trackFiltersFollowed":0,"trackScansPerMonth":0,"trackPhotoSearchesPerMonth":0,"trackHistoryMonths":0,"cloudIncluded":false,"followUp24h":"none"}'::jsonb
  where plan = 'starter' and not (quotas ? 'studioListingsPerMonth');
update subscriptions set quotas = '{"items":5000,"aiRequestsPerMonth":1500,"automationActionsPerDay":500,"connections":3,"members":3,"studioListingsPerMonth":20,"wornPhotosPerMonth":10,"trackFiltersFollowed":5,"trackScansPerMonth":10,"trackPhotoSearchesPerMonth":30,"trackHistoryMonths":3,"cloudIncluded":false,"followUp24h":"suggested"}'::jsonb
  where plan = 'pro' and not (quotas ? 'studioListingsPerMonth');
update subscriptions set quotas = '{"items":20000,"aiRequestsPerMonth":5000,"automationActionsPerDay":2000,"connections":10,"members":10,"studioListingsPerMonth":60,"wornPhotosPerMonth":30,"trackFiltersFollowed":25,"trackScansPerMonth":50,"trackPhotoSearchesPerMonth":150,"trackHistoryMonths":12,"cloudIncluded":true,"followUp24h":"auto"}'::jsonb
  where plan = 'agence' and not (quotas ? 'studioListingsPerMonth');
-- Plan inconnu (jamais écrit par le code) : accès de base, comme quotasForPlan.
update subscriptions set quotas = '{"items":50,"aiRequestsPerMonth":50,"automationActionsPerDay":10,"connections":1,"members":1,"studioListingsPerMonth":0,"wornPhotosPerMonth":0,"trackFiltersFollowed":0,"trackScansPerMonth":0,"trackPhotoSearchesPerMonth":0,"trackHistoryMonths":0,"cloudIncluded":false,"followUp24h":"none"}'::jsonb
  where plan not in ('free', 'starter', 'pro', 'agence') and not (quotas ? 'studioListingsPerMonth');

drop function if exists app_admin_org_usage(timestamptz, timestamptz);
create function app_admin_org_usage(p_month_start timestamptz, p_day_start timestamptz)
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
  cloud_today bigint,
  ai_requests_month bigint,
  ai_settings jsonb
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
    coalesce((select sum(ue.quantity) from usage_events ue where ue.org_id = o.id and ue.kind = 'cloud.action' and ue.created_at >= p_day_start), 0),
    -- Même décompte que repos.aiRequests.countSince (le refus) : toutes les requêtes du mois, hors questions d'aide.
    (select count(*) from ai_requests r where r.org_id = o.id and r.created_at >= p_month_start and r.kind <> 'help_answer'),
    coalesce(o.settings -> 'ai', '{}'::jsonb)
  from organizations o left join subscriptions s on s.org_id = o.id
  order by o.created_at
$$;
revoke all on function app_admin_org_usage(timestamptz, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant execute on function app_admin_org_usage(timestamptz, timestamptz) to selio_app;
  end if;
end $$;
