-- 0018 : corrections de la revue (parrainage et supervision). Additive et idempotente.
--
-- 1) Parrainage : état « refused ». Le contrôle d'auto-parrainage est refait au premier paiement de la
--    filleule (aucun membre commun, email canonique différent, client et moyen de paiement Revolut
--    différents, plafond de mois offerts de la marraine) : en cas d'échec, le lien passe « refused », avec
--    la date et la raison (codes fixes, aucune donnée sur l'autre organisation), et aucun crédit n'est accordé.
-- 2) Supervision : nombre de canaux réellement délivrés (push + emails d'un vrai fournisseur) pour la
--    notification déclenchée par une vérification (null : pas de notification, ou pas encore connue).
--
-- Note : deux migrations portent le préfixe 0016 (rôles/parrainage et supervision/Vinted Pro). Elles
-- s'appliquent dans l'ordre des noms et ne se chevauchent pas ; elles ne sont pas renommées (une base qui
-- les a déjà appliquées les rejouerait sous un autre nom).

alter table referrals drop constraint if exists referrals_status_check;
alter table referrals add constraint referrals_status_check check (status in ('pending', 'qualified', 'credited', 'refused'));
alter table referrals add column if not exists refused_at timestamptz;
alter table referrals add column if not exists refused_reason text;
alter table referrals drop constraint if exists referrals_refused_reason_check;
alter table referrals add constraint referrals_refused_reason_check
  check (refused_reason is null or refused_reason in ('shared_member', 'same_email', 'same_payment', 'cap_reached'));

alter table supervision_checks add column if not exists delivered integer check (delivered is null or delivered >= 0);
create index if not exists idx_supervision_checks_events on supervision_checks(checked_at desc) where event is not null;
