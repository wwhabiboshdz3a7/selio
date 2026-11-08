# Connecteur Vinted Pro Integrations (squelette)

Voie officielle pour les comptes **Vinted Pro** : articles, commandes, webhooks. L'accès est **à demander
par Ibrahim** auprès de Vinted Pro. Tant qu'il n'est pas obtenu, ce connecteur est un **squelette honnête** :
il se décrit, dit ce qui manque, et **n'appelle jamais l'API**.

Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.

## Ce qui est vérifié (recherche du 8 novembre 2026)

| Point | Source | État |
| --- | --- | --- |
| Une documentation publique existe : `https://pro-docs.svc.vinted.com` (« Vinted Pro Integrations ») | résultat de recherche web | repérée, **non lue** (hôte injoignable depuis l'environnement de développement) |
| Page commerciale « Connect with our API » : `https://vinted.co.uk/pro/integrations` | résultat de recherche web | repérée, non lue |
| Accès réservé aux entreprises admises par Vinted (sur candidature) | extraits de recherche (documentation et page commerciale) | concordant, à confirmer avec Vinted |

## Ce qui n'est PAS vérifié (rapporté par des extraits de recherche ou des sites tiers)

Aucun de ces points n'est écrit dans le code : à confirmer en lisant la documentation avec l'accès.

- Jeton généré dans un « portail Pro Integrations », découpé en **clé d'accès** et **clé de signature**
  (donc probablement des requêtes signées : en-têtes et algorithme **inconnus**).
- Adresses : production `pro.svc.vinted.com`, bac à sable `pro-public-sandbox.svc.vinted.com`, un jeton par
  environnement.
- Domaines couverts : articles (création, validation, statut, imports, références), commandes et bordereaux,
  ontologies (catégories, marques, tailles), webhooks (événements d'articles et de ventes, avec validation).
  Aucune messagerie, offre, favori, recherche catalogue ni achat annoncés.
- Nombre d'emplacements d'articles limité au départ (« 500 » selon une source tierce).
- Version de la documentation (v0.220.8 sur une capture, 0.383.0 selon un article d'octobre 2026).
- Délai de mise en place annoncé de 4 à 6 semaines, correspondance des catégories à prévoir.

## Ce que fait le code

- `describe()` : transport `server`, `experimental: true`, toutes les capacités `unavailable` avec la note
  « Accès et documentation à obtenir auprès de Vinted Pro ».
- `test()` : `ok: false`, statut stocké `not_configured`, **statut d'accès `needs_access`** (champ
  `accessStatus`, voir `effectiveStatus` dans `../types.ts`) et la liste de ce qui manque. Aucun appel réseau,
  même quand tout est renseigné.
- `readItems()` / `syncOrders()` : `unsupported` avec la même note. Pas de `readConversations` (aucune
  messagerie connue côté API Pro).
- Configuration : `proAccountId` (identifiant de compte Pro), `apiBaseUrl` (adresse remise par Vinted, **vide
  par défaut**, HTTPS et domaine `vinted.com` seulement — `normalizeVintedProBaseUrl` dans les contrats) ;
  secret `apiKey` (clé fournie par Vinted), chiffré dans `secret_ciphertext`. **Jamais un mot de passe Vinted.**
- `fetch` injectable (option du constructeur) pour l'intégration à venir, avec HTTP simulé en test ; le
  squelette ne l'appelle jamais (vérifié par les tests).

## Pour brancher l'API, une fois l'accès obtenu

1. Lire la documentation avec l'accès ; noter la version, les en-têtes d'authentification et l'algorithme
   de signature (requêtes et webhooks).
2. Écrire les appels (articles, commandes, enregistrement des webhooks) sur le `fetch` injecté, avec des
   réponses enregistrées du bac à sable comme fixtures.
3. Recevoir les webhooks par une route API dédiée, signature vérifiée et traitement idempotent (même modèle
   que le webhook Revolut).
4. Passer chaque capacité de `unavailable` à `experimental`, puis `available` une fois testée sur le bac à sable.
5. Transmettre le secret déchiffré au connecteur dans `testConnection` (le cœur ne le passe pas aujourd'hui).
6. Ajouter `needs_access` aux statuts des contrats et à l'interface quand celle-ci saura l'afficher.
