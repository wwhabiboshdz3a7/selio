-- 0003 — Dressing intelligent, republications, générateur d'annonces, achat automatique.
-- Migration additive et idempotente (aucune suppression de colonne).

-- Statistiques d'annonce (vues, favoris, offres) relevées par l'extension.
alter table inventory_items add column if not exists listing_stats jsonb not null default '{}'::jsonb;
-- Historique des republications (variante utilisée, mode, rendement à 48 h).
alter table inventory_items add column if not exists republications jsonb not null default '[]'::jsonb;
-- Attributs complémentaires (couleurs, matière, origine du texte).
alter table inventory_items add column if not exists attributes jsonb not null default '{}'::jsonb;

-- Détail de la note des bonnes affaires (points par critère).
alter table opportunities add column if not exists breakdown jsonb not null default '[]'::jsonb;

-- Achat validé à la main ou déclenché par l'achat automatique, avec délai d'annulation.
alter table purchase_requests add column if not exists mode text not null default 'manual';
alter table purchase_requests add column if not exists cancelable_until timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_requests_mode_check') then
    alter table purchase_requests add constraint purchase_requests_mode_check check (mode in ('manual', 'auto'));
  end if;
end $$;
create index if not exists idx_purchases_org_executed on purchase_requests(org_id, executed_at);
