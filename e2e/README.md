# Tests de bout en bout

Playwright joue les parcours principaux dans un vrai navigateur (Chromium, format téléphone), sur le vrai site
(`next dev`) branché sur la vraie API (`wrangler dev`) :

| Fichier | Parcours |
| --- | --- |
| `tests/auth.spec.ts` | Inscription par code SMS, choix du PIN, reconnexion par numéro et PIN (et PIN faux refusé) |
| `tests/meal.spec.ts` | Commande repas sans compte avec la position du client (prix au km), le restaurant accepte et prépare, la répartition affecte un livreur, le livreur accepte, récupère, remet et encaisse ; le client confirme la réception, note le livreur et le restaurant, et voit « Livrée » |
| `tests/parcel.spec.ts` | Colis : l'expéditeur crée un lien de position, le destinataire l'ouvre et partage sa position, le prix suit la distance |
| `tests/driverDelete.spec.ts` | Le directeur supprime un livreur en tapant « supprimer » : sans historique il est effacé, avec un historique son compte est fermé et son nom reste dans les anciennes données |
| `tests/restaurantDelete.spec.ts` | Le directeur supprime un restaurant en tapant « supprimer » : refusé tant qu'une commande est en cours ; sans commande il est effacé, avec des commandes il disparaît du site et ses accès sont fermés, mais la commande garde son nom |
| `tests/restaurant-location.spec.ts` | Position obligatoire d'un restaurant : création refusée sans position, lien envoyé au gérant, restaurant masqué, le gérant partage la position, l'admin peut le rendre visible |
| `tests/opening-hours.spec.ts` | Horaires d'ouverture : l'admin les saisit, le client voit la semaine et le restaurant fermé avec l'heure de réouverture, la commande est refusée, le gérant retrouve les mêmes horaires |
| `tests/table-order.spec.ts` | Commande à table : le gérant crée ses tables et leurs QR codes, le client scanne la table 2 et commande sur place sans numéro, le restaurant voit « Table 2 », la sert, le client voit « Servie à table » |
| `tests/table-bell.spec.ts` | Sonnerie de table : le client de la table 4 demande l'addition en espèces, l'espace restaurant sonne avec un bandeau « Table 4 », « J'arrive » s'affiche chez le client, « Fait » ferme l'appel et le temps de réponse s'affiche ; sonnerie coupée, le bouton disparaît |
| `tests/pos.spec.ts` | Mode caisse du restaurant : nouvelle commande en grand, tableau cuisine, file unique et caisse au choix, acceptation et étapes en un geste, mode retenu à la prochaine visite puis retour au mode complet |
| `tests/restaurant-team.spec.ts` | Équipe du restaurant : le gérant ajoute une caissière, elle se connecte, ne voit que les commandes, accepte une commande à table, l'encaisse au comptoir (son nom reste sur la commande) et la sert |
| `tests/merchant.spec.ts` | Appli marchand : création de la boutique, envoi groupé (un colis saisi, un autre collé depuis une liste) avec contre-remboursement, livraison et encaissement par le livreur, solde de la boutique et reversement par le directeur |
| `tests/services.spec.ts` | Bouton Services : le directeur ouvre, annonce (« Bientôt ») ou cache chaque module ; mode livraison et moto seulement ; tuiles « Bientôt » non cliquables ; recherche d'un service ; ordre de la feuille ; colis coupé (page fermée, API refuse) ; tout caché, plus de bouton du milieu |
| `tests/service-requests.spec.ts` | Les cinq services : le directeur les ouvre et règle un tarif, donne des services à un livreur ; trois clients font une demande de chaque service ; le livreur ne voit que ses services, prend le gaz, en route, sur place, termine avec le prix du gaz ; le client voit le total et note ; l'admin attribue la lessive et annule le dépannage ; garde-fous de l'API (service fermé, formulaire invalide, créneau, demande d'un autre client, service absent du profil) |
| `tests/slot.spec.ts` | Retrait programmé dans 1 h 30 : proposé tout de suite en réservation (3 min pour répondre) au livreur le plus proche, qui l'accepte, le voit dans « Mes retraits programmés », reçoit quand même une course normale, puis se désiste (plus d'1 h avant) et la course redevient libre |
| `tests/i18n.spec.ts` | Bouton FR / EN : textes, cookie gardé au rechargement, pages rendues côté serveur et erreurs de l'API |

## Lancer

```bash
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
cd e2e
npm install
npx playwright install chromium   # une fois
npm test                          # ou npm run test:ui pour suivre pas à pas
npm run report                    # rapport HTML, avec captures et traces des échecs
```

Playwright démarre tout seul l'API sur le port 8788 et le site sur le port 3100, à côté de `npm run dev` (8787 et
3000). Arrêtez d'abord un `next dev` déjà lancé dans `frontend/` : deux `next dev` ne partagent pas le dossier `.next`.

- La base D1 des tests est neuve à chaque lancement (`e2e/.state/`, migrations et `npm run db:seed`) ; celle de
  `npm run dev` n'est pas touchée. Hors CI, des serveurs déjà lancés sur 8788 et 3100 sont réutilisés.
- Les codes SMS s'affichent à l'écran (`OTP_DEV_CODES=true`) ; mots de passe et clé admin de test dans `env.mjs`.
- Chaque test crée ses propres données (restaurant, livreur, numéros uniques) par l'API admin
  (`tests/fixtures.ts`) et envoie une adresse IP fictive à lui, pour ne pas buter sur les limites de l'API.
- En CI : `.github/workflows/e2e.yml`, à chaque changement de `backend/`, `frontend/` ou `e2e/`.
