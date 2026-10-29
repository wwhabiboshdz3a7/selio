# Checklist avant mise en production

## Infrastructure
- [ ] PostgreSQL 16 managé ou Docker avec sauvegardes quotidiennes et test de restauration effectué (SECURITY.md).
- [ ] Rôle `selio_app` avec mot de passe fort (`APP_DB_PASSWORD`) ; l'API n'utilise jamais le rôle propriétaire.
- [ ] Redis persistant (AOF) pour le worker.
- [ ] `SECRETS_ENCRYPTION_KEY` générée, stockée hors Git et sauvegardée séparément.
- [ ] TLS devant l'API (Caddy/Nginx), `TRUST_PROXY=true`, `COOKIE_SECURE=true`, `NODE_ENV=production`.
- [ ] `CORS_ORIGINS` et `PUBLIC_WEB_URL` = domaine Netlify ; `VITE_API_BASE_URL` côté Netlify.
- [ ] Supervision : `/api/health`, `/api/ai/health` (jeton), alertes sur les journaux d'erreur.

## Produit
- [ ] Textes juridiques (mentions légales, confidentialité, conditions) complétés et validés par un conseil : ce sont des **brouillons**.
- [ ] Tarifs définitifs décidés ; `VITE_SHOW_INDICATIVE_PRICING` ajusté ; CGV rédigées.
- [ ] Service d'email choisi avec Ibrahim et branché (`EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`, SPF/DKIM) : invitations et mot de passe oublié sont prêts ; par défaut `noop`, rien ne part (avertissement au démarrage).
- [ ] Stockage objet pour les photos (MinIO sur la machine derrière Caddy, `STORAGE_*`) : routes `/api/uploads` prêtes, envoi depuis le navigateur à brancher (data URL en démo, URL en base en connecté tant que ce n'est pas fait).
- [ ] `pnpm db:migrate` exécuté (0005 → 0010 : carte enregistrée, vue administrateur de l'usage, jetons, rattrapage des quotas des anciens abonnements, paiement Revolut avec `payment_orders` et `invoices`, compteur de factures transactionnel et réservation des webhooks).
- [ ] Logo vectoriel officiel fourni (`logo-principal.svg`) pour favicons nets.

## Connecteurs et IA
- [ ] Adaptateurs DOM Vinted validés sur le site réel par un humain (diagnostic de l'extension) ; statut « expérimental » retiré uniquement après validation.
- [ ] Vérification juridique de l'usage de l'extension au regard des conditions d'utilisation de la plateforme.
- [ ] Serveur Ollama installé (OLLAMA-SETUP.md), `pnpm ai:diagnose` OK, latence et capacité mesurées, `ALLOW_AI_FALLBACK=false`.
- [ ] Quotas IA par plan revus selon la capacité mesurée.

## Paiement (Revolut Merchant API)
- [ ] Compte Revolut Business avec le compte marchand (Merchant) activé ; clés du **bac à sable** d'abord (`REVOLUT_SECRET_KEY=sk_…`, `REVOLUT_MODE=sandbox`) côté API et worker.
- [ ] Webhook créé par l'API chez Revolut (`POST /api/1.0/webhooks`, URL `https://<api>/api/billing/webhook/revolut`, les 5 événements `ORDER_*`) et `signing_secret` copié dans `REVOLUT_WEBHOOK_SECRET` ; démarrage sans avertissement « webhooks refusés ».
- [ ] Parcours validé en bac à sable avec les cartes de test : carte enregistrée pendant l'essai (autorisation de 1 € annulée, rien débité), paiement hors essai, facture `SEL-AAAA-000001` imprimable, carte refusée → relances J+1 / J+3 / J+7 avec emails (worker toutes les heures), « Changer de carte » en retard de paiement puis débit retenté dans l'heure, retour à l'accès de base, résiliation en trois clics et reprise.
- [ ] Procédure convenue pour une capture inattendue d'autorisation de vérification (audit `billing.unexpected_capture`) : remboursement manuel depuis Revolut Business.
- [ ] Mentions des factures renseignées côté Netlify (`VITE_INVOICE_ISSUER_NAME`, `_ADDRESS`, `_SIREN`, `_VAT`, `_EMAIL`) et régime de TVA choisi (`FRANCHISE_TVA`) : plus aucun « à compléter » sur une facture réelle ; numérotation continue validée avec le comptable (séquence SQL par année).
- [ ] CSP du site inchangée ou mise à jour à l'identique dans `netlify.toml` et `deploy/netlify/_headers` (script et iframes Revolut autorisés) ; le formulaire s'ouvre en production.
- [ ] Passage en live : clés live, second webhook sur `https://merchant.revolut.com`, puis `REVOLUT_MODE=live` **et** `REVOLUT_LIVE_ALLOWED=true`. Sans les deux, l'API et le worker refusent de démarrer : c'est voulu.
- [ ] Emails d'échec de paiement réels (`EMAIL_PROVIDER=smtp`) : en `noop`, les relances sont faites mais aucun email ne part.
- [ ] Décidé avec Ibrahim : purge ou anonymisation des données 30 jours après le retour à l'accès de base (tâche à écrire) ; prélèvement SEPA pour l'annuel (plus tard).

## Qualité
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` verts sur la branche de release.
- [ ] Revue de sécurité des dépendances (`pnpm audit`) et mise à jour des versions épinglées.
- [ ] Jeu de données de démonstration réinitialisé ; aucun compte de test en production.
- [ ] Opérateurs listés dans `OPERATOR_EMAILS` ; comptes de test supprimés.
