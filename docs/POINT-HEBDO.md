# Point de la semaine — 8 novembre 2026

Pour Ibrahim. Ce qui est fait, ce qui avance, ce qui attend une décision. Les chiffres sont ceux mesurés cette semaine ; ce qui n'a pas pu être mesuré est dit tel quel.

## Fait

- **Rôles d'équipe** : titulaire, administrateur, exécuteur, contributeur photos, lecture seule. L'exécuteur publie et répond, mais ne voit ni le chiffre d'affaires, ni les marges, ni les prix d'achat, ni les factures. Après la relecture, les derniers endroits où ces montants passaient encore (tableau de bord, seuils de déclaration, raisons des contre-offres, journal d'activité, prix payé des achats Radar) sont fermés et testés. Il voit toujours le **prix plancher** d'un article, pour négocier (choix à confirmer). Le contributeur photos peut maintenant **enregistrer en brouillon** l'annonce qu'il a générée (sans prix d'achat, sans publication).
- **Parrainage** « un mois offert aux deux » : prêt mais **fermé**. Le lien partagé remplit le code à l'inscription. Le contrôle « on ne se parraine pas soi-même » se fait au premier paiement : même personne, même adresse email (même avec un « +2 » ou des points Gmail), même client ou même carte enregistrée chez Revolut → refusé. Au plus 12 mois offerts par parrain sur un an.
- **Selio Comptes** : une checklist pour monter une boutique Vinted et des textes à recopier. Selio ne crée aucun compte et ne touche jamais à Vinted à la place du client.
- **Vinted Pro** : la place du connecteur officiel est prête, mais il ne fait **rien** tant que nous n'avons pas l'accès.
- **Site** : une page par filiale, les deux pages « Selio ou Bleam ? » et « Alternative à Bleam » (cachées des moteurs de recherche en attendant les textes d'Elias), la phrase d'indépendance partout où il faut : « Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted. »
- **Extension Chrome** : le dossier de publication est prêt (paquet de 57 fichiers, 812 Ko). **Rien n'est payé ni publié.** L'extension n'envoie plus rien sans un clic : les prix comparables partent seulement quand on clique sur « Voir les comparables ». La politique de confidentialité dit exactement ce qui part.
- **Surveillance du service** : chaque minute, le worker vérifie l'API et l'IA. Après 3 échecs, une alerte part sur le téléphone des opérateurs et par email, puis un rappel toutes les heures, puis « rétabli ». Si la base de données tombe, l'alerte part quand même (par email). Une alerte que personne n'a reçue n'est plus marquée « envoyée » : elle est retentée la minute suivante.
- **Essai « verre liquide »** : le dock en bas sur téléphone et la carte d'alerte du Radar. **Désactivé par défaut** (Paramètres › Apparence). Le texte et les couleurs restent lisibles sur n'importe quel fond ; la barre « Enregistrer » ne passe plus sous le dock.
- **Tests** : tout est au vert. 1 610 tests automatiques, et 176 parcours dans un vrai navigateur (ordinateur, tablette, téléphone).

## Chiffres mesurés cette semaine

| Quoi | Résultat | Conditions |
|---|---|---|
| Fluidité du défilement avec le dock en verre | 60 images par seconde, 0 % d'images lentes | Chromium sur serveur, iPhone 15 et Android **émulés** |
| Coût d'une image du dock | 0,65 ms opaque → 2,6 ms en verre (16 % du temps disponible à 60 images/s) | idem |
| Ce qui coûte dans le verre | le flou presque rien (+2 %) ; le reflet animé fait l'essentiel (× 4) | idem |
| Capacité du Cloud, temps de réponse de l'IA, taux de blocage Vinted | **pas mesurés** : la machine de Marseille n'est pas encore branchée | — |

## En cours

- Rien de neuf en cours : tout ce bloc est livré. Restent à faire sur la machine : appliquer les mises à jour de la base (0016 à 0018) et brancher les alertes (clés des notifications, service d'email).

## Bloqué / à vérifier

- **Le vrai Safari sur iPhone** : nos essais tournent dans Chromium. Il faut regarder le dock en verre sur ton iPhone (et sur un Android d'entrée de gamme) pour trancher.
- **Documentation Vinted Pro** : inaccessible d'ici, et il faut de toute façon l'accès.
- **Une panne complète de la machine, ou de Redis**, n'est signalée par personne tant qu'aucun contrôle extérieur (gratuit) n'est activé.

## Décisions qui t'attendent

1. **Ouvrir le parrainage** maintenant ou plus tard (et garder le plafond de 12 mois offerts par an ?).
2. **Compte développeur Chrome Web Store (5 $)** : on le crée au nom de l'entreprise ?
3. **Service d'email** : sans lui, une panne de la base de données ne prévient personne.
4. **Contrôle extérieur gratuit** pour la surveillance (prévient si la machine entière s'arrête).
5. **Domaine définitif du site** (aujourd'hui « selio.fr » provisoirement).
6. **Verre liquide** : on garde l'essai tel quel, on l'étend, ou on abandonne — après ton essai sur iPhone. Si un téléphone rame, on peut figer le reflet sans enlever le flou.
7. **Prix plancher visible par l'exécuteur** : on le laisse (il en a besoin pour négocier) ?
8. **Demande d'accès Vinted Pro Integrations**, à faire de ton côté.
9. Toujours en attente : textes d'Elias pour les comparatifs, avis de l'avocat (pages légales, politique de l'extension, Cloud, Radar, Track), prix définitifs, date de remise à zéro des quotas, photos portées, Radar Auto pour les clients.
