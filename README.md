# Zedeka

Livraison de colis et commande de repas à Lomé. « Zedeka » veut dire « en même temps » :
vous commandez, et le livreur est déjà en route.

## Structure

- `backend/` : API REST (Node.js, Express, Prisma, PostgreSQL). Elle sert la page de commande
  aujourd'hui et servira demain l'espace admin, les livreurs et les restaurants.
- `frontend/` : site web (Next.js, TypeScript, Tailwind), en français et pensé pour mobile.

## Côté clients

### Application client (`/app`, installable sur l'écran d'accueil)

- **Accueil** : adresse ou zone de livraison, accès Repas, Colis et Location, commande en cours, restaurants
  (ouverts d'abord, frais de la zone, délai, minimum).
- **Repas** : recherche sur les noms de restaurants et de plats (sans tenir compte des accents), catégories en
  pastilles, filtres « Ouvert maintenant » et « Livraison gratuite », tri « Près de moi » et « Les plus rapides ».
  Chaque carte montre le délai, la distance (si la position est connue) et un badge « Fermé » avec la raison.
- **Commandes** : repas, colis et locations, en cours ou passées, suivi et « Commander à nouveau ».
- **Profil** : compte par numéro et code à 6 chiffres (valable 10 min, 5 essais, 1 envoi par minute et 5 par
  heure), adresses enregistrées (quartier, repère obligatoire, position facultative, zone devinée du quartier),
  déconnexion, suppression du compte, aide, annulation, conditions et confidentialité.
- Le panier reste sur le téléphone (un seul restaurant à la fois) ; nom, numéro et adresse sont pré-remplis.
  Les commandes passées sans compte sont rattachées au compte à la connexion (même numéro).
- Hors ligne : bandeau d'alerte et page de secours ; après la première commande, proposition d'ajouter
  Zedeka à l'écran d'accueil.
- **Envoi des codes** : aucun fournisseur SMS/WhatsApp n'est branché. Avec `OTP_DEV_CODES=true` (par défaut
  hors production) le code s'affiche à l'écran ; en production, brancher un fournisseur via l'option `sendOtp`
  de `createApp` (voir `backend/src/routes/customer.ts`), sinon la connexion est indisponible et la commande
  sans compte reste possible.

### Pages publiques

- `/r/<slug>` : carte d'un restaurant (le QR code pointe dessus) : en-tête avec délai, minimum, distance et
  ouvert ou fermé, onglets de catégories qui suivent le défilement, fiche de plat (taille obligatoire, suppléments
  facultatifs, quantité, total en direct), panier à droite sur ordinateur et barre en bas sur téléphone.
- `/r/<slug>/commande` : caisse. Sans session, choix entre se connecter et continuer sans compte ; livraison ou
  à emporter, adresse, contact, paiement, récapitulatif avec sous-total, livraison et total, bouton fixe.
  Une seule variante (taille ou formule) par plat ; plusieurs groupes de choix restent à faire.
- `/colis` : en deux étapes. Une fenêtre demande le type de colis, la classe de poids et la taille ; puis
  expéditeur et destinataire côte à côte, le colis rappelé en haut avec un crayon pour le modifier.
- `/suivi` : suivi sans compte avec le code et le numéro utilisé (client ou destinataire), plus les commandes
  passées sur l'appareil.
- `/commande/<code>` : suivi de la commande.
- `/devenir-livreur` : candidature d'un livreur, validée ensuite dans l'admin.
- `/devenir-partenaire` : candidature d'un commerce (restaurant, boutique…), validée ensuite dans l'admin.
- `/louer/<slug>` : réservation d'un véhicule chez un loueur (à l'heure, à la journée ou au km, tout de suite ou
  plus tard) ; `/reservation/<code>` : suivi de la réservation.

Quand le restaurant est fermé (fermeture temporaire ou hors horaires), la carte reste visible mais la
commande est bloquée ; elle l'est aussi sous le montant minimum du restaurant.

L'API recalcule toujours les prix, enregistre la commande et renvoie un lien WhatsApp pré-rempli vers
le numéro de Zedeka.

## Espace admin (directeur des opérations)

`/admin`, après connexion par mot de passe (`ADMIN_PASSWORD`) :

- **Tableau de bord** : courses et revenu Zedeka du jour face au seuil de 13 500 FCFA, candidatures en attente.
- **Répartition** : commandes à affecter et en cours, livreurs en ligne, affectation en un clic.
- **Commandes** : onglets par statut, filtres (dates, repas ou colis, livraison ou à emporter), recherche,
  export CSV, fiche détaillée avec remise, supplément, paiement, annulation motivée et facture imprimable.
- **Restaurants** : zone, délais, logo, position, abonnement mensuel (commission à 0 par défaut), carte avec photos, variantes et suppléments, QR code,
  identifiants de l'espace restaurant.
- **Candidatures** : demandes des commerces avec pièces jointes ; la validation crée le restaurant (abonnement au
  prix affiché lors de la candidature, sans commission, identifiants choisis à l'inscription), le refus demande un motif.
- **Livreurs** : validation des candidatures, zone, véhicule, en ligne ou non.
- **Zones** : tarif fixe ou à la distance (prix au km, minimum, maximum).
- **Colis** : catégories avec supplément fixe et prix au kg.
- **Finances** : espèces à récupérer auprès des livreurs, relevés et reversements aux restaurants.
- **Rapport** et **Réglages** (part du livreur, règles d'annulation).

## Espace restaurant (gérant)

`/restaurant`, avec l'e-mail et le mot de passe créés par l'admin (section « Accès restaurant ») :

- **Tableau de bord** : nouvelles commandes, en cuisine, prêtes, ventes du jour et des 7 jours, montant net pour le restaurant.
- **Commandes** : onglets par statut avec compteurs, recherche, impression. Fiche : accepter avec un temps de
  préparation ou refuser avec un motif, lancer la préparation, signaler « prête ». Une commande repas n'apparaît dans
  la répartition qu'une fois prête.
- **Alarme** : à chaque nouvelle commande, écran plein avec sonnerie en boucle jusqu'à « Voir » (vérification toutes
  les 20 secondes, écran maintenu allumé), plus une notification Web Push si les alertes sont activées. Sans réponse
  après 3 minutes, l'admin est alerté dans la répartition et le restaurant reçoit un SMS.
- **Ouvert / Fermé** dans l'en-tête : fermer 30 minutes, 1 heure, jusqu'au lendemain 6 h ou jusqu'à réouverture.
- **Modifier une commande** avant « prête » : retirer un article, baisser une quantité, remplacer par un plat de prix
  égal ou inférieur, avec un motif. Le total est recalculé par le serveur, le client voit la modification sur son
  suivi et l'écart payé en mobile money est noté à rembourser.
- **Carte** : plats, photos, variantes, suppléments, épuisé ou disponible.
- **Horaires et réglages** : fermeture temporaire, horaires par jour (créneaux de nuit possibles), montant minimum,
  délais, téléphone, adresse, logo.
- **Relevés** : montant dû par Zedeka pour les commandes livrées et historique des versements.
- **Mon compte** : alertes sur cet appareil avec test, changement de mot de passe, installation de l'application,
  déconnexion de tous les appareils. « Mot de passe oublié ? » envoie un code par SMS au numéro du compte.

`/restaurant` et `/location` s'installent comme applications (manifeste propre à chaque espace).

Comptes de démonstration après `npm run db:seed` : `chez-tante-ama@demo.zedeka.tg` et
`le-maquis-du-port@demo.zedeka.tg`, mot de passe `zedeka-demo`.

## Espace loueur (location de véhicules)

`/location`, avec l'e-mail et le mot de passe créés par l'admin (menu « Location ») :

- **Tableau de bord** : courses par statut, planifiées, revenus du jour et des 7 jours, taille de la flotte.
- **Courses** : onglets (toutes, planifiées, en attente, confirmées, en cours, terminées, annulées, paiement échoué),
  recherche, alarme à l'arrivée d'une réservation (relance admin et SMS après 10 minutes). Fiche : frise des étapes, attribution de l'immatriculation et du
  chauffeur, modification (durée, départ, frais, remise) avec recalcul, facture, itinéraire avec lien vers la carte.
- **Véhicules** : modèle, photos, caractéristiques, une immatriculation par exemplaire, tarifs à l'heure, à la journée
  et au km (chacun activable), remise.
- **Chauffeurs** : coordonnées et pièce d'identité, nombre de courses.
- **Ouvert / Fermé** et **Mon compte** comme pour les restaurants.
- **Réglages** : fermeture temporaire, réservations à l'avance, zone et délai de prise en charge, taxe.
- **Relevés** : ce que Zedeka doit pour les courses terminées.

Prix d'une course = prix unitaire × nombre de véhicules × durée − remises + frais supplémentaires + taxe.
Compte de démonstration : `lome-auto@demo.zedeka.tg`, mot de passe `zedeka-demo`.

Statuts d'une commande repas : Nouvelle → Acceptée → En préparation → Prête → En livraison → Livrée (ou Annulée).

Revenu Zedeka d'une course = frais de livraison + supplément + commission − remise − part du livreur.
Les commerces paient un abonnement fixe (prix dans Réglages, sans commission) : le tableau de bord, le rapport et le
seuil de rentabilité ajoutent chaque jour 1/30 des abonnements des restaurants actifs.
En production, l'API doit être servie en HTTPS et `ADMIN_SECRET` doit être une longue chaîne aléatoire.
Les notifications Web Push demandent `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) ;
en local, une paire est créée dans `backend/vapid.json`. Les SMS (codes, relances) ne partent qu'une fois un
fournisseur branché ; en attendant, ils sont écrits dans le journal de l'API.

## Application livreur (`/livreur`, installable sur le téléphone)

- **Connexion** par le numéro de téléphone et un code SMS. Seuls les livreurs validés et actifs entrent ; un
  candidat voit où en est sa candidature (`/livreur/candidature`).
- **En ligne / hors ligne**. Sans signe de vie de l'application pendant 30 minutes, le livreur passe hors ligne.
- **Course proposée** : quand la répartition affecte une commande, alarme plein écran avec sonnerie (et Web Push).
  Le livreur accepte ou refuse avec une raison dans les 60 secondes ; sans réponse, la course revient « à affecter ».
  La répartition voit « Envoyée », « Acceptée », « Refusée » ou « pas de réponse ».
- **Déroulé** : ramassage (adresse, appel, itinéraire, articles à vérifier), puis livraison, chaque étape validée
  en glissant un bouton. Sans réseau, l'étape est gardée sur le téléphone avec son heure et envoyée au retour.
- **Espèces** : à la remise, le livreur confirme le montant reçu ; un écart demande une raison et alerte l'admin.
  « Espèces en main » liste ce qui reste à remettre à Zedeka.
- **Gains** du jour, de la semaine et du mois (part du livreur sur les frais de livraison).
- **Un problème ?** : client injoignable, adresse introuvable, accident… L'alerte apparaît en rouge dans la
  répartition, avec la position du livreur.
- **Position** envoyée toutes les 30 secondes pendant une course (écran maintenu allumé) ; la répartition affiche
  la dernière position et « vu il y a … ».
- **Profil** en lecture seule, numéro de la répartition (`ZEDEKA_WHATSAPP`), alertes, installation, déconnexion.

## Cadre légal (Togo)

- Pages publiques, aussi reprises dans l'application client : `/mentions-legales`, `/conditions` (CGU/CGV clients),
  `/confidentialite`, `/conditions-partenaires`, `/conditions-livreurs`. Liens dans le pied de page du site.
- L'identité de l'exploitant (dénomination, forme juridique OHADA, capital, RCCM, NIF, siège, hébergeur, récépissé IPDCP)
  est dans `frontend/src/lib/legal.ts` : les valeurs entre crochets sont à remplacer avant la mise en ligne.
- Commande, colis, réservation et candidature livreur exigent la case « J'accepte les conditions » ; l'API refuse sans elle
  (`acceptTerms: true`) et enregistre `termsAcceptedAt`. La connexion client vaut acceptation (mention sous le bouton).
- Durées de conservation (loi n° 2019-014) appliquées toutes les 6 h par `backend/src/retention.ts` : codes de connexion
  24 h, positions des livreurs 90 jours, candidatures refusées 1 an. Commandes gardées 10 ans (comptabilité OHADA).
- Avant le lancement : déclarer les traitements à l'IPDCP et faire relire les textes par un juriste togolais.

## Démarrer en local

Prérequis : Node.js 20+ et PostgreSQL.

```bash
# Backend
cd backend
cp .env.example .env        # adapter DATABASE_URL et ZEDEKA_WHATSAPP
npm install
npm run db:migrate          # crée les tables
npm run db:seed             # restaurants, zones et catégories de colis de démonstration
npm run dev                 # http://localhost:4000

# Frontend (autre terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                 # http://localhost:3000/r/chez-tante-ama
```

Tests de l'API : `cd backend && npm test`.

## Endpoints

| Méthode | Chemin                     | Rôle                                   |
| ------- | -------------------------- | -------------------------------------- |
| GET     | `/api/zones`               | Zones de livraison et tarifs           |
| GET     | `/api/restaurants/:slug`   | Restaurant et carte disponible         |
| GET     | `/api/parcel-categories`   | Catégories de colis et suppléments     |
| POST    | `/api/orders`              | Créer une commande repas, renvoie le lien WhatsApp |
| POST    | `/api/parcels`             | Créer une commande colis               |
| POST    | `/api/drivers/apply`       | Candidature livreur                    |
| POST    | `/api/vendor-applications` | Candidature d'un commerce (formulaire avec fichiers) |
| GET     | `/api/orders/:code`        | Suivi d'une commande                   |
| POST    | `/api/track`               | Retrouver une commande, un colis ou une location par code et numéro |
| GET     | `/api/restaurants?zoneId=&q=` | Restaurants pour l'application, avec recherche |
| GET     | `/api/rentals`             | Loueurs actifs                         |
| GET     | `/api/policies`            | Règles d'annulation et WhatsApp de Zedeka |
| POST    | `/api/customer/otp/request` | Demander un code de connexion         |
| POST    | `/api/customer/otp/verify` | Vérifier le code, renvoie un jeton client (30 jours) |
| *       | `/api/customer/...`        | Profil, adresses, historique, suppression du compte (jeton client) |
| POST    | `/api/admin/login`         | Connexion admin, renvoie un jeton      |
| *       | `/api/admin/...`           | Tableau de bord, répartition, commandes, catalogue, zones, livreurs, colis, finances, réglages (jeton requis) |
| GET     | `/api/rentals/:slug`       | Loueur et véhicules disponibles        |
| POST    | `/api/trips`               | Réserver un véhicule, renvoie le lien WhatsApp |
| GET     | `/api/trips/:code`         | Suivi d'une réservation                |
| POST    | `/api/location/login`      | Connexion d'un loueur, renvoie un jeton |
| *       | `/api/location/...`        | Courses, véhicules, chauffeurs, réglages et relevés du loueur connecté (jeton requis) |
| POST    | `/api/restaurant/login`    | Connexion d'un gérant, renvoie un jeton |
| *       | `/api/restaurant/...`      | Commandes, statuts, carte, réglages et relevés du restaurant connecté (jeton requis) |
| POST    | `/api/{restaurant,location}/password/forgot` · `/password/reset` | Code par SMS et nouveau mot de passe |
| PATCH   | `/api/{restaurant,location}/status` | Ouvrir ou fermer, avec durée |
| POST    | `/api/{restaurant,location}/password` · `/sessions/logout-all` | Changer le mot de passe, déconnecter partout |
| GET/POST/DELETE | `/api/{restaurant,location,admin}/push` · `/push/key` · `/push/test` | Abonnement Web Push de l'appareil |
| POST    | `/api/restaurant/orders/:id/edit/quote` · `/edit` | Chiffrer puis enregistrer une modification de commande |
| POST    | `/api/livreur/otp/request` · `/otp/verify` | Connexion du livreur par code SMS (ou statut de candidature) |
| GET     | `/api/livreur/current`     | Courses proposées et en cours (interrogé toutes les 10 s) |
| POST    | `/api/livreur/assignments/:id/accept` · `/reject` | Réponse à une course proposée |
| POST    | `/api/livreur/orders/:id/status` | Récupérée ou livrée (heure de l'appareil, espèces reçues) |
| *       | `/api/livreur/...`         | Position, problème, espèces, gains, historique, profil, en ligne, alertes |
| POST    | `/api/admin/dispatch/issues/:id/resolve` | Marquer un problème signalé comme réglé |

Tous les montants sont des entiers en FCFA.
