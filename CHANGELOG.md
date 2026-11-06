# Journal des versions

## 2.0.0 (en cours)

### Clients (applis et web)
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
