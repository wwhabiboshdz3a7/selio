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
- [ ] Service d'email choisi et branché (invitations, réinitialisation de mot de passe, notifications) — non implémenté.
- [ ] Stockage objet pour les photos avec URLs signées — non branché (data URL en démo, URL en base en connecté).
- [ ] Logo vectoriel officiel fourni (`logo-principal.svg`) pour favicons nets.

## Connecteurs et IA
- [ ] Adaptateurs DOM Vinted validés sur le site réel par un humain (diagnostic de l'extension) ; statut « expérimental » retiré uniquement après validation.
- [ ] Vérification juridique de l'usage de l'extension au regard des conditions d'utilisation de la plateforme.
- [ ] Serveur Ollama installé (OLLAMA-SETUP.md), `pnpm ai:diagnose` OK, latence et capacité mesurées, `ALLOW_AI_FALLBACK=false`.
- [ ] Quotas IA par plan revus selon la capacité mesurée.

## Paiement
- [ ] Compte Stripe, produits/prix créés, `STRIPE_PRICE_*`, webhook pointant vers `/api/billing/webhook`, test en mode test.
- [ ] `STRIPE_LIVE_ALLOWED=true` uniquement après validation complète du parcours en test.

## Qualité
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build` verts sur la branche de release.
- [ ] Revue de sécurité des dépendances (`pnpm audit`) et mise à jour des versions épinglées.
- [ ] Jeu de données de démonstration réinitialisé ; aucun compte de test en production.
- [ ] Opérateurs listés dans `OPERATOR_EMAILS` ; comptes de test supprimés.
