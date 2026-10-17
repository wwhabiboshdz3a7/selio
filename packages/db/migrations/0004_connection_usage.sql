-- 0004 — Comptes Vinted catégorisés (vente, achat, perso) et compte utilisé par les achats.
-- Migration additive et idempotente (aucune suppression de colonne).

-- Catégorie du compte : sale = annonces publiées et négociées ; purchase = compte acheteur ;
-- personal = compte personnel, jamais utilisé par les automatisations ni l'achat automatique.
alter table marketplace_connections add column if not exists usage text not null default 'sale';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketplace_connections_usage_check') then
    alter table marketplace_connections add constraint marketplace_connections_usage_check check (usage in ('sale', 'purchase', 'personal'));
  end if;
end $$;
-- Filtre par catégorie (page Comptes Vinted, choix du compte Achat, exclusion des comptes Perso).
create index if not exists idx_connections_org_usage on marketplace_connections(org_id, usage);

-- Compte Achat utilisé par chaque achat (simulé) : statistiques par compte et traçabilité.
alter table purchase_requests add column if not exists connection_id text references marketplace_connections(id) on delete set null;
create index if not exists idx_purchases_org_connection on purchase_requests(org_id, connection_id);
