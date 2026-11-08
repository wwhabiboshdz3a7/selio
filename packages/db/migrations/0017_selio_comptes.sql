-- 0017 : Selio Comptes (§5.15) — progression de la checklist de mise en place d'une boutique Vinted.
--
-- Une ligne par organisation et par étape cochée (ou décochée) : identifiant d'étape stable (liste fixe dans
-- @selio/contracts, ACCOUNT_CHECKLIST_STEP_IDS), état, date et auteur. Aucune donnée personnelle, aucun
-- texte libre, aucune information venant de Vinted : Selio Comptes n'agit jamais à la place du client.
-- Les réglages de l'organisation (organizations.settings) ne conviennent pas : le schéma des réglages est
-- strict et une mise à jour des paramètres réécrit l'objet entier.
--
-- Isolation par organisation (RLS org_isolation, comme les autres tables métier).

create table if not exists account_checklist_progress (
  org_id text not null references organizations(id) on delete cascade,
  step_id text not null check (step_id ~ '^[a-z_]{3,40}$'),
  done boolean not null default false,
  done_at timestamptz,
  updated_by text references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, step_id)
);

alter table account_checklist_progress enable row level security;
alter table account_checklist_progress force row level security;
drop policy if exists org_isolation on account_checklist_progress;
create policy org_isolation on account_checklist_progress for all to selio_app using (org_id = app_current_org()) with check (org_id = app_current_org());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'selio_app') then
    grant select, insert, update, delete on account_checklist_progress to selio_app;
  end if;
end $$;
