# Zedeka

Livraison de colis et commande de repas à Lomé. « Zedeka » veut dire « en même temps » :
vous commandez, et le livreur est déjà en route.

## Structure

- `backend/` : API REST (Express, Prisma) sur un Worker Cloudflare (`zedeka-api`), base D1 `zedeka-db`,
  fichiers dans R2 `zedeka-media`, tâches planifiées par cron.
- `frontend/` : site web (Next.js, TypeScript, Tailwind) sur un Worker Cloudflare via OpenNext (`zedeka-web`),
  en français et pensé pour mobile, sur `zedeka.poinderecharge.com`. Il passe `/api/*` à l'API par une
  liaison de service.
- `mobile/` : applications Android et iOS (coques Capacitor autour du site), voir [mobile/README.md](mobile/README.md).

Mise en ligne : [DEPLOIEMENT.md](DEPLOIEMENT.md).

## Côté clients

### Application client (`/app`, installable sur l'écran d'accueil)

- **Accueil** : adresse ou zone de livraison, accès Repas et Colis, commande en cours, restaurants
  (ouverts d'abord, frais de la zone, délai, minimum).
- **Repas** : recherche sur les noms de restaurants et de plats (sans tenir compte des accents), catégories en
  pastilles, filtres « Ouvert maintenant » et « Livraison gratuite », tri « Près de moi » et « Les plus rapides ».
  Chaque carte montre le délai, la distance (si la position est connue) et un badge « Fermé » avec la raison.
- **Commandes** : repas et colis, en cours ou passées, suivi et « Commander à nouveau ».
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
- Pas d'inscription en ligne pour les commerces ni les livreurs : leurs comptes sont créés par l'équipe dans
  l'admin (Restaurants, Livreurs). Les anciens liens `/devenir-partenaire` et `/devenir-livreur` mènent à la
  connexion de l'espace restaurant et de l'application livreur.

Quand le restaurant est fermé (fermeture temporaire ou hors horaires), la carte reste visible mais la
commande est bloquée ; elle l'est aussi sous le montant minimum du restaurant.

L'API recalcule toujours les prix, enregistre la commande et renvoie un lien WhatsApp pré-rempli vers
le numéro de Zedeka.

## Espace admin (équipe Zedeka)

`/admin`, après connexion. Chaque membre de l'équipe a son compte (adresse e-mail et mot de passe, créé dans
**Équipe**) ; le mot de passe `ADMIN_PASSWORD` reste valable seul et ouvre l'admin en directeur des opérations.

- **Directeur** : tout l'admin.
- **Dispatcheur** : tableau de bord sans montants, répartition, commandes, colis et disponibilité des livreurs.
  Pas de finances, rapport, réglages, restaurants, zones, candidatures ni équipe ; il ne voit ni ne change les
  salaires. Un compte désactivé perd l'accès tout de suite.
- Chaque course attribuée garde le nom de qui l'a attribuée (« attribuée par Koffi » dans la répartition).
- **Notifications** (cloche en haut, pour tous les rôles) : fil des événements des 30 derniers jours (nouvelles
  commandes et colis, étapes et ouverture/fermeture des restaurants, courses acceptées, refusées ou livrées, problèmes
  des livreurs, candidatures, écarts d'espèces), filtrable par catégorie, avec le nombre de non lues. Page ouverte :
  bandeau dans le coin et bip. Admin en arrière-plan ou fermé : pop-up du système (Web Push, à activer dans les
  réglages de la cloche, par navigateur). Chaque membre coupe les catégories qu'il ne veut pas (sans pop-up ni son).
  Le rôle décide des catégories reçues (`notificationCategoriesFor` dans `backend/src/team.ts`) : le directeur reçoit
  tout, le dispatcheur ni candidatures ni finances, et un nouveau rôle reçoit commandes, restaurants et livreurs.

- **Tableau de bord** : courses et revenu Zedeka du jour face au seuil de 13 500 FCFA, candidatures en attente.
- **Répartition** : commandes à affecter et en cours, livreurs en ligne, affectation en un clic.
- **Commandes** : onglets par statut, filtres (dates, repas ou colis, livraison ou à emporter), recherche,
  export CSV, fiche détaillée avec remise, supplément, paiement, annulation motivée et facture imprimable.
- **Position obligatoire des restaurants** : à la création, l'admin place le restaurant sur la carte (recherche ou lien
  Google Maps) ou demande la position au gérant par un lien (valable 7 jours, à envoyer sur WhatsApp). En attendant,
  le restaurant est masqué aux clients ; un restaurant sans position ne peut pas être rendu visible, et une position
  ne s'efface pas (on la déplace). Les candidatures validées sans position donnent un restaurant masqué.
- **Restaurants** : zone, délais, logo, position, abonnement mensuel (commission à 0 par défaut), carte avec photos, variantes et suppléments, QR code,
  identifiants de l'espace restaurant.
- **Candidatures** : demandes des commerces avec pièces jointes ; la validation crée le restaurant (abonnement au
  prix affiché lors de la candidature, sans commission, identifiants choisis à l'inscription), le refus demande un motif.
- **Livreurs** : validation des candidatures, zone, véhicule, en ligne ou non, et statut **Salarié Zedeka** (salaire
  mensuel) ou **Indépendant** (part par course, réglée dans Réglages). Une course attribuée à un salarié est
  acceptée d'office : pas d'offre à accepter ni de refus, et pas de part par course à la livraison.
- **Équipe** : comptes des membres (directeur ou dispatcheur), mot de passe, désactivation.
- **Zones** : tarif fixe ou à la distance (prix au km, minimum, maximum).
- **Colis** : catégories avec supplément fixe et prix au kg.
- **Finances** : espèces à récupérer auprès des livreurs, relevés et reversements aux restaurants, et **dépôts chez les
  restaurants** : Zedeka laisse une somme (25 000 FCFA par défaut, dans Réglages) ; à chaque repas livré et payé à Zedeka,
  le restaurant se paie les plats dessus au lieu d'attendre un relevé. Solde, mouvements, recharge ou correction (motif),
  alerte « dépôt bas » à l'équipe et au restaurant sous le seuil (5 000 FCFA par défaut). Un retrait payé au comptoir
  n'y touche pas et n'est jamais dû par Zedeka : le restaurant a encaissé.
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

`/restaurant` s'installe comme application (manifeste propre).

Comptes de démonstration après `npm run db:seed` : `chez-tante-ama@demo.zedeka.tg` et
`le-maquis-du-port@demo.zedeka.tg`, mot de passe `zedeka-demo`.

Statuts d'une commande repas : Nouvelle → Acceptée → En préparation → Prête → En livraison → Livrée (ou Annulée).

Revenu Zedeka d'une course = frais de livraison + supplément + commission − remise − part du livreur.
Les commerces paient un abonnement fixe (prix dans Réglages, sans commission) : le tableau de bord, le rapport et le
seuil de rentabilité ajoutent chaque jour 1/30 des abonnements des restaurants actifs.
Les salaires des livreurs salariés actifs sont comptés de la même façon (1/30 par jour) et montrés à part :
« revenu après salaires » dans le tableau de bord et le rapport ; le seuil reste comparé au revenu.
En production, `ADMIN_SECRET` doit être une longue chaîne aléatoire et l'admin passe derrière Cloudflare Access
(voir DEPLOIEMENT.md). Les notifications Web Push demandent `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY`
(`npx web-push generate-vapid-keys`) ; sans elles, aucune notification n'est envoyée. Les SMS (codes, relances) ne partent qu'une fois un
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
- **Gains** du jour, de la semaine et du mois (part du livreur sur les frais de livraison). Un salarié voit
  « Mon activité » : son salaire mensuel et le nombre de courses, sans montant par course.
- **Livreur salarié** : pas d'alarme d'offre ; la course attribuée arrive directement dans « Courses en cours » avec
  un bandeau « Course attribuée par le dispatch » (et une notification qui sonne).
- **Un problème ?** : client injoignable, adresse introuvable, accident… L'alerte apparaît en rouge dans la
  répartition, avec la position du livreur.
- **Position** envoyée toutes les 30 secondes pendant une course (écran maintenu allumé) ; la répartition affiche
  la dernière position et « vu il y a … ».
- **Profil** en lecture seule, numéro de la répartition (`ZEDEKA_WHATSAPP`), alertes, installation, déconnexion.

## Cadre légal (Togo)

Textes en français (langue officielle ; en anglais une note le précise, sauf la page de remboursement, traduite) :
`/mentions-legales`, `/conditions`, `/confidentialite`, `/remboursement`, `/cookies`, `/suppression-donnees`,
`/conditions-partenaires`, `/conditions-livreurs`, liés en pied de page du site et dans le profil de l'appli.

- **Identité de l'exploitant** : `frontend/src/lib/legal.ts`. Les valeurs entre crochets (dénomination, forme,
  capital, RCCM, NIF, siège, gérant, e-mail, téléphone, récépissé IPDCP) sont à remplir avant le lancement.
- **Consentement** : case « J'accepte les conditions… », jamais pré-cochée, à la commande,
  au colis, à l'inscription et à la candidature livreur. L'API refuse commande, colis et candidature sans
  `acceptTerms: true` et garde l'heure dans `termsAcceptedAt` (migration `0015_consentement.sql`). Les frais
  d'annulation sont rappelés sous la case, avant la commande.
- **Cookies** : uniquement des éléments nécessaires (langue, session, panier), aucun traceur ni outil d'audience ;
  un bandeau d'information s'affiche une fois (`zedeka.cookieNotice`).
- **Conservation** (`backend/src/retention.ts`, chaque heure par le cron) : codes de connexion 24 h, positions des
  livreurs 90 jours, candidatures refusées un an (fichiers R2 compris). Les commandes restent 10 ans (OHADA).
- **Suppression** : bouton dans le profil client ; pour les autres (livreurs, partenaires, destinataires),
  `/suppression-donnees` prépare la demande à envoyer par WhatsApp ou par e-mail. Adresse à donner aux stores.
- **E-mails** : seulement des codes ; chaque e-mail dit qu'il n'y a pas de publicité et comment ne plus en recevoir.
- **Accessibilité** : contraste AA (gris `stone-400`/`500`/`600` assombris), contour de focus au clavier, lien
  « Aller au contenu », fenêtres qui gardent le focus (`components/DialogBox.tsx`), textes alternatifs.

## Langues (français et anglais)

Tout le site est en français par défaut, avec l'anglais au choix (bouton FR / EN dans les en-têtes, et dans le
profil des applications client et livreur). Le choix est gardé un an dans le cookie `lang`.

- Le texte reste écrit en français dans le code : `t("Texte français")` (composants, `useT()`), `getT()` (pages
  rendues côté serveur) ou `tr()` (code hors composant) renvoie la version anglaise si elle existe.
- Les traductions anglaises sont dans `frontend/src/lib/i18n/en/` (un fichier par espace : site, appli, admin,
  restaurant, livreur). Une phrase sans traduction s'affiche en français.
- `npm run i18n` (dans `frontend/`) liste les phrases appelées sans traduction et les textes français oubliés.
- L'API traduit ses messages (erreurs, raisons de fermeture, formule partenaire) d'après le même cookie
  (`backend/src/i18n.ts`). Le SMS de code de mot de passe part dans la langue de la personne. Les notifications
  à l'équipe, le message WhatsApp de commande et les relances SMS automatiques restent en français.

## Démarrer en local

Prérequis : Node.js 20+ (la base D1 locale est créée par wrangler, rien d'autre à installer).

```bash
# Backend
cd backend
cp .dev.vars.example .dev.vars   # adapter ZEDEKA_WHATSAPP et ADMIN_PASSWORD
npm install
npm run db:migrate:local         # crée les tables dans la base D1 locale
npm run db:seed                  # restaurants, zones et catégories de colis de démonstration
npm run dev                      # http://localhost:8787

# Frontend (autre terminal)
cd frontend
npm install
npm run dev                      # http://localhost:3000/r/chez-tante-ama
```

Tests de l'API : `cd backend && npm test`. Tests de bout en bout (site et API ensemble, dans un navigateur) : `cd e2e && npm test`, voir
[e2e/README.md](e2e/README.md). Une modification de `prisma/schema.prisma` se reporte dans une
nouvelle migration SQL de `backend/migrations/` (`npx prisma migrate diff`).

## Endpoints

| Méthode | Chemin                     | Rôle                                   |
| ------- | -------------------------- | -------------------------------------- |
| GET     | `/api/zones`               | Zones de livraison et tarifs           |
| GET     | `/api/restaurants/:slug`   | Restaurant et carte disponible         |
| GET     | `/api/parcel-categories`   | Catégories de colis et suppléments     |
| POST    | `/api/orders`              | Créer une commande repas, renvoie le lien WhatsApp |
| POST    | `/api/parcels`             | Créer une commande colis               |
| GET     | `/api/orders/:code`        | Suivi d'une commande                   |
| POST    | `/api/track`               | Retrouver une commande ou un colis par code et numéro |
| GET     | `/api/restaurants?zoneId=&q=` | Restaurants pour l'application, avec recherche |
| GET     | `/api/policies`            | Règles d'annulation et WhatsApp de Zedeka |
| POST    | `/api/customer/otp/request` | Demander un code de connexion         |
| POST    | `/api/customer/otp/verify` | Vérifier le code, renvoie un jeton client (30 jours) |
| *       | `/api/customer/...`        | Profil, adresses, historique, suppression du compte (jeton client) |
| POST    | `/api/admin/login`         | Connexion admin, renvoie un jeton      |
| *       | `/api/admin/...`           | Tableau de bord, répartition, commandes, catalogue, zones, livreurs, colis, finances, réglages (jeton requis) |
| POST    | `/api/restaurant/login`    | Connexion d'un gérant, renvoie un jeton |
| *       | `/api/restaurant/...`      | Commandes, statuts, carte, réglages et relevés du restaurant connecté (jeton requis) |
| POST    | `/api/restaurant/password/forgot` · `/password/reset` | Code par SMS et nouveau mot de passe |
| PATCH   | `/api/restaurant/status` | Ouvrir ou fermer, avec durée |
| POST    | `/api/restaurant/password` · `/sessions/logout-all` | Changer le mot de passe, déconnecter partout |
| GET/POST/DELETE | `/api/{restaurant,admin}/push` · `/push/key` · `/push/test` | Abonnement Web Push de l'appareil |
| POST    | `/api/restaurant/orders/:id/edit/quote` · `/edit` | Chiffrer puis enregistrer une modification de commande |
| POST    | `/api/livreur/otp/request` · `/otp/verify` | Connexion du livreur par code SMS (ou statut de candidature) |
| GET     | `/api/livreur/current`     | Courses proposées et en cours (interrogé toutes les 10 s) |
| POST    | `/api/livreur/assignments/:id/accept` · `/reject` | Réponse à une course proposée |
| POST    | `/api/livreur/orders/:id/status` | Récupérée ou livrée (heure de l'appareil, espèces reçues) |
| *       | `/api/livreur/...`         | Position, problème, espèces, gains, historique, profil, en ligne, alertes |
| POST    | `/api/admin/dispatch/issues/:id/resolve` | Marquer un problème signalé comme réglé |

Tous les montants sont des entiers en FCFA.
