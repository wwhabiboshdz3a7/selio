# Captures à prendre pour la fiche

Le Chrome Web Store demande au moins une capture (jusqu'à 5) en **1280 × 800** ou **640 × 400**, PNG ou JPEG, sans transparence, et une **petite vignette promotionnelle de 440 × 280**. L'icône de la fiche est `public/icons/icon-128.png`.

**Règle :** jamais un vrai compte client, jamais un pseudo, une photo de personne ou un message réels. Les pages Vinted se capturent sur les fixtures (`test/`) ou sur un compte de l'équipe, pseudos et visages floutés. Pas de logo Vinted ni de couleurs qui prêtent à confusion dans les visuels Selio ; la mention d'indépendance figure dans la description.

| # | Capture | Où | État |
|---|---|---|---|
| 1 | Panneau « Selio · article » ouvert sur une page article : champs lus, prix d'achat, bouton « Capturer vers le stock » | Fixture de page article, panneau en clair | à prendre |
| 2 | « Comparables Selio » : fourchette P25 / P50 / P75, position du prix, délai estimé, mention « Données de démonstration » si besoin | Fixture de page article, offre Pro | à prendre |
| 3 | Page conversation : « Règles de prix » et brouillon inséré dans le champ de réponse, bouton Envoyer non cliqué | Fixture de conversation | à prendre |
| 4 | Popup : « Associé », nom de l'organisation, diagnostic de la page | `chrome-extension://…/popup.html` (`node scripts/check-extension.mjs` en produit une ébauche dans `.tmp-shots/`) | ébauche automatique |
| 5 | Options : association par jeton, « Ce que fait l'extension », historique des diagnostics | `chrome-extension://…/options.html` (même script) | ébauche automatique |
| — | Petite vignette 440 × 280 : logo Selio sur fond porcelaine ou encre, phrase « Capture et aide à la rédaction, vous confirmez chaque action » | À composer (logo officiel, charte v3, Inter) | à faire |

Mode sombre : une capture sur cinq au plus, pour montrer que le panneau suit le thème du système.
