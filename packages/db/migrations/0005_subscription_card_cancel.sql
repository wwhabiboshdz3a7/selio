-- 0005 — Abonnement : carte enregistrée dès l'essai (rien débité avant la fin) et résiliation
-- en fin de période. Le fournisseur « revolut » (semaine 2) s'ajoute aux valeurs possibles de
-- `provider` (colonne texte, sans contrainte). Migration additive et idempotente.

alter table subscriptions add column if not exists card_on_file boolean not null default false;
alter table subscriptions add column if not exists cancel_at_period_end boolean not null default false;
