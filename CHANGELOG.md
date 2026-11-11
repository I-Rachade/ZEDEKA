# Journal des versions

## 2.0.0 (en cours)

### Corrections
- Espace restaurant : « Erreur 500 » de temps en temps quand plusieurs écrans chargeaient en même temps (tableau de
  bord, commandes, alarme). Deux requêtes partageaient une même lecture de la base et le Worker arrêtait la seconde.
- Base de données : les gestes faits au même moment ne s'écrasent plus (D1 n'a pas de transactions). Un livreur
  dont la course a été retirée ou a expiré ne peut plus l'accepter quand même ; l'admin ne change plus l'étape d'une
  commande que le restaurant ou le livreur vient de changer ; une commande annulée n'est plus marquée remise ; deux
  caisses ne peuvent plus encaisser deux fois ; deux modifications simultanées d'une commande ne comptent plus deux
  fois le remboursement ; un paiement Zed n'est validé qu'une fois ; une commande envoyée deux fois au même instant
  renvoie la première au lieu d'une « Erreur 500 ».

### Rapidité
- Vitesse réelle des téléphones (Core Web Vitals, sans donnée personnelle) dans Admin > Santé, et mesure
  « téléphone lent » du site en ligne chaque matin (onglet Actions).
- Accueil et carte des restaurants gardés 20 s en mémoire par l'API (vidé à chaque modification), notes indexées.
- Délais maximum sur Firebase, Web Push, Didit et Cloudflare Access ; plus de lectures ni de recherches en double.
- Admin > Commandes par pages de 50 ; historique sans compte en un seul appel.
- Photos en WebP (environ 30 % plus légères), squelettes des pages serveur, gestes instantanés côté restaurant.

### En un geste
- Restaurant : l'alarme de nouvelle commande montre la commande (plats, montant, livraison ou table) et l'accepte
  d'un geste, « Accepter · 15 min » ; « Voir le détail ou refuser » ouvre la fiche. Accepter met toujours la commande
  en cuisine (plus d'étape « Lancer la préparation »), 15 min proposées par défaut.
- Restaurant : « Prête » prévient aussi le livreur déjà affecté ; le bouton devient « Livreur prévenu · relancer ».
  Quand le temps annoncé est dépassé, un bip et un bouton vert « C'est prêt ? Touchez ici » le rappellent.
- Client connecté avec une adresse enregistrée : la caisse s'ouvre directement sur le récapitulatif (« Modifier »
  sur chaque ligne). Le dernier moyen de paiement est repris, et « Commander à nouveau » mène droit à la caisse.
- Livreur : à la remise, le montant exact est proposé d'office ; « Autre montant ? » ouvre le champ.

### Restaurants
- Sonnerie de table : depuis le QR code de sa table, le client appelle le serveur, demande l'addition (espèces ou
  mobile money) ou écrit une demande. L'espace restaurant (mode caisse compris) affiche un bandeau « Table 7 » et
  sonne, avec une notification push, jusqu'à « J'arrive » ; le client voit que le serveur arrive, puis « Fait »
  ferme l'appel. Relance au bout de 2 min sans réponse, un appel par table, nouvelle sonnerie après 30 s,
  fermeture automatique après 15 min. Interrupteur et temps moyen de réponse sur la page Tables et QR codes.

### Livreurs et prestataires
- Missions de service : les demandes des services de son profil, accepter (le premier gagne), en route, sur place,
  terminer avec les achats, le gaz ou les pièces payés ; « Je ne peux plus venir » renvoie la demande aux autres.

### Admin
- Demandes de service : suivi, attribution ou réattribution à un prestataire, annulation avec raison ; services de
  chaque livreur (il reçoit les demandes de ces services). Page Services : tarif de chaque service (base + unité).

### API
- Demandes de service : 3 en cours au plus par client, 2 par minute et 10 par jour, créneau de 7 h à 19 h dans les
  14 jours, prix calculé côté serveur, 3 missions en cours au plus par prestataire, prise de mission atomique.
  Migration 0037 (ajouts seulement).

### Clients (applis et web)
- Cinq services à la demande sous le bouton Services : Courses pour moi (liste et budget), Gaz et eau (bouteille
  6 ou 12 kg, bidons), Lessive (sacs, repassage, créneau), Ménage (maison ou bureau, heures, créneau) et Dépannage
  (plomberie, électricité, autre, créneau). Formulaire avec estimation du prix, suivi en cinq étapes (envoyée,
  acceptée, en route, en cours, terminée), numéro du prestataire pendant la mission, total à payer, note, annulation.
  Volet « Services » dans Mes commandes.
- Le bouton du milieu devient « Services » (carré aux coins arrondis) : livraison et transport en haut (colis, course
  Zed), puis les autres services (courses, gaz et eau, lessive, ménage, dépannage) quand l'admin les annonce
  (« Bientôt », non cliquables tant qu'ils ne sont pas prêts). Aucun module visible : la barre garde quatre onglets.
- Recherche : trouve aussi les services (« linge » → Lessive, « moto » → Course Zed).
- Colis coupé dans l'admin : la page /colis l'indique et l'API refuse les nouveaux colis.
- Bouton Zed toujours au centre de la barre : il ouvre « Envoyer un colis » ou « Une course pour moi ».
- Accueil réservé aux restaurants (les cases Repas et Colis disparaissent).
- Page Zed en deux volets glissables : Colis et Course Zed.
- Mes commandes en trois volets glissables : Repas, Colis et Courses Zed (historique des courses).
- Suivi : détail complet de la livraison (expéditeur, destinataire, position, type, poids, taille, note, qui paie,
  plaque du livreur), visible par qui a commandé ; on glisse d'une commande en cours à l'autre.
- Course Zed : le bouton « Appeler un Zed » reste visible au-dessus de la barre, sans défiler.
- Zed : destination facultative (« Je vais à »), montrée au conducteur avant d'accepter.
- Sans réseau : l'accueil, les menus des restaurants déjà ouverts, Colis, Zed, Mes commandes et le suivi restent
  affichés depuis le téléphone (dernière version reçue), avec un bandeau « Hors ligne ». Rien de personnel n'est
  gardé par le service worker ; une page jamais ouverte affiche « Pas de réseau ».

### Livreurs et conducteurs Zed
- Appel et course Zed : destination du client affichée.
- Fin de course : prix convenu en un geste (300, 400, 500, 700 F) ou autre montant.
- Accueil : date de fin du plan Zed et nombre de courses Zed du jour.

### Restaurants et administration
- Connexion perdue : les pages gardent ce qu'elles montraient (copie sur l'appareil, effacée à la
  déconnexion), avec l'heure de la dernière mise à jour, et se rechargent seules au retour du réseau.
- Admin : nouvelle page « Services » (directeur ; l'adjoint en lecture) : chaque module du bouton du milieu se règle
  seul (Ouvert, Bientôt, Caché) et dans l'ordre voulu. La course Zed suit le réglage « Mode Zed ». Un service pas
  encore construit ne peut pas être ouvert. API : /api/services servie depuis un cache en mémoire (30 s) avec ETag
  (304 sans corps) ; l'appli affiche aussitôt la dernière liste gardée sur le téléphone.
- Admin : nouvelle page « Santé » (directeur et adjoint) : temps de réponse du serveur et de la base, activité
  du jour, dernière activité de chaque appli, livreurs sans signal et commandes ouvertes depuis plus de 1 h 30.

### Marchands e-commerce (nouvelle appli)
- Appli marchand `/marchand` (et APK « Zedeka Marchand », `com.zedeka.marchand`) pour les boutiques en ligne qui
  envoient surtout des colis. Même compte que l'appli client (numéro ou e-mail et PIN), avec un profil boutique.
- Envoi groupé : jusqu'à 50 colis d'un coup, saisis un par un ou collés depuis un tableur ou WhatsApp
  (« Nom ; Téléphone ; Adresse ; Montant ; Réf »), prix ligne par ligne avant de valider.
- Contre-remboursement : le livreur encaisse le prix des articles chez le client ; la livraison est payée par la
  boutique (retenue sur le reversement) ou par le client. Le livreur voit simplement le montant à encaisser.
- Pour chaque client : message WhatsApp prêt à envoyer avec le lien de position (24 h) ou le lien de suivi.
- Ramassage habituel (jours et heure) et bouton « Venez ramasser maintenant » qui prévient l'équipe.
- Argent : solde à recevoir, colis pas encore reversés, historique des reversements.
- Admin : page « Marchands » (boutiques, ramassages demandés, solde, suspendre, reverser).

### Base de données
- Migration additive `0030_destination_zed.sql` : colonne `destination` des courses Zed.
- Migration additive `0033_marchands.sql` : tables `Merchant` et `MerchantPayout`, colonnes `merchantId`,
  `codAmount`, `merchantRef` et `merchantPayoutId` des commandes.

## 1.0.0 (4 novembre 2026)

Première version figée de Zedeka : tout ce qui est en ligne sur `zedeka.poinderecharge.com` au 4 novembre 2026
(jusqu'à la PR #72). Branche de conservation : `release/1.0`, étiquette : `v1.0.0`.

### Clients
- Commande de repas en 3 étapes : recherche, catégories, filtres, panier, caisse avec point de livraison sur la carte.
- Envoi de colis en 3 étapes : types de colis, prix à la distance, position du destinataire par lien partagé,
  paiement par l'expéditeur ou le destinataire.
- Mode Zed : moto-taxi à la demande, bouton flottant dans la barre client.
- Commande à table avec QR code numéroté.
- Connexion par code PIN avec le téléphone ou l'e-mail, codes envoyés par SMS (Didit).
- Suivi des commandes quasi instantané, notifications (application et navigateur), clôture de la livraison
  et notes du livreur et du restaurant.
- Horaires d'ouverture et prochaine ouverture affichés, bannière publicitaire en carrousel sur l'accueil.
- Interface façon Apple, en français et en anglais.

### Restaurants
- Espace restaurant : commandes, carte avec photos des plats et logo envoyés depuis l'appareil.
- Équipe : caissières et manageuses ; mode caisse avec trois affichages.
- Abonnement fixe des commerces partenaires, retraits payés au comptoir.

### Livreurs
- Inscription et connexion par numéro ou e-mail et code PIN.
- Étapes une par une : ramassage puis livraison, livreur visible par le client après acceptation.

### Administration
- Centre de notifications pour toute l'équipe, compteurs d'activité, rôles Managerin et Administrateur adjoint.
- Attribution automatique, appel et WhatsApp, gestion des restaurants, livreurs, zones, horaires et publicités.
- Livraison au km ou par zone au choix dans les réglages.

### Applications Android
- Quatre applications Capacitor : client, livreur, restaurant et admin (APK de test et .aab pour le Play Store).

### Technique, sécurité et conformité
- Hébergement Cloudflare (Workers, base D1, fichiers R2), déploiement automatique depuis la branche principale.
- Sécurité : limites de débit, codes à usage unique, protections SSRF et CSP, accès admin derrière Cloudflare Access.
- Conformité Togo : mentions légales, CGU/CGV, confidentialité, cookies, consentement, suppression des comptes
  et des données.
- Rapidité : fichiers gardés en cache, accueil instantané, vignettes des photos, index de la base D1.
- Tests de bout en bout avec Playwright.
