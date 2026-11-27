-- 0025 : Selio Cloud lit la messagerie Vinted (D63). Additive et idempotente : peut être rejouée.
--
-- « Le Cloud doit être en full auto : quand l'ordinateur du client est éteint, il lit la messagerie Vinted,
-- et les nouveaux messages déclenchent les réponses et la négociation automatiques, sans dernier clic »
-- (Ibrahim, 27 novembre 2026, texte d'accord accepté par le client).
--
-- 1) cloud_actions.kind accepte « sync_inbox » (lecture de la messagerie, action légère, lecture seule).
--    Le détail du journal reste à clés fermées (contrats) : des comptes seulement, jamais un texte ni un pseudo.
-- 2) Index partiel pour retrouver vite la dernière lecture d'un compte (intervalle CLOUD_INBOX_SYNC_MINUTES).

do $$
declare
  c record;
begin
  -- Contrainte créée sans nom en 0011 (nom automatique « cloud_actions_kind_check ») : retirée sous
  -- n'importe quel nom, puis recréée avec la nouvelle liste.
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'cloud_actions' and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%kind%' and pg_get_constraintdef(con.oid) not ilike '%sync_inbox%'
  loop
    execute format('alter table cloud_actions drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'cloud_actions_kind_check') then
    alter table cloud_actions add constraint cloud_actions_kind_check check (kind in ('reply','follow_up','republish','bulk_edit','sync_inbox'));
  end if;
end $$;

create index if not exists idx_jobs_cloud_sync on jobs(org_id, ((payload->>'cloudAccountId')), created_at desc) where runs_in = 'cloud' and payload->>'cloudKind' = 'sync_inbox';
