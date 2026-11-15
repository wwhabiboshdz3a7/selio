-- Selio Manager : journal d'activité et raccourcis personnalisés.
--
-- 1) Journal d'activité : AUCUNE table nouvelle. Le journal est lu dans les traces qui existent déjà
--    (inventory_events, studio_preps, messages, jobs, orders, shipments, purchase_requests, audit_logs) ;
--    les actions sans trace propre (Selio Bot) sont écrites dans audit_logs sous « activity.<verbe> »
--    (`recordActivity`, @selio/core). Toutes ces tables sont déjà isolées par la politique org_isolation
--    (0002_rls.sql, 0014_studio.sql). On ajoute seulement les index qui servent la lecture par date.
-- 2) Raccourcis : préférences par utilisateur (users.preferences), pour retrouver les mêmes raccourcis sur
--    téléphone et ordinateur. La table users est globale (sans RLS, comme 0002) : on n'y lit et n'écrit que
--    la ligne de l'utilisateur connecté.

alter table users add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table users drop constraint if exists users_preferences_object;
alter table users add constraint users_preferences_object check (jsonb_typeof(preferences) = 'object');

create index if not exists idx_item_events_org_created on inventory_events(org_id, created_at desc);
create index if not exists idx_messages_org_outbound on messages(org_id, created_at desc) where direction = 'outbound';
create index if not exists idx_jobs_org_created on jobs(org_id, created_at desc);
create index if not exists idx_audit_org_action on audit_logs(org_id, action, created_at desc);
create index if not exists idx_purchases_org_confirmed on purchase_requests(org_id, confirmed_at desc) where confirmed_at is not null;
