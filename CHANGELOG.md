# Journal des versions

## 2.0.0 (en cours)

### Clients (applis et web)
- Bouton Zed toujours au centre de la barre : il ouvre « Envoyer un colis » ou « Une course pour moi ».
- Accueil réservé aux restaurants (les cases Repas et Colis disparaissent).
- Page Zed en deux volets glissables : Colis et Course Zed.
- Mes commandes en trois volets glissables : Repas, Colis et Courses Zed (historique des courses).
- Suivi : détail complet de la livraison (expéditeur, destinataire, position, type, poids, taille, note, qui paie,
  plaque du livreur), visible par qui a commandé ; on glisse d'une commande en cours à l'autre.
- Zed : destination facultative (« Je vais à »), montrée au conducteur avant d'accepter.

### Livreurs et conducteurs Zed
- Appel et course Zed : destination du client affichée.
- Fin de course : prix convenu en un geste (300, 400, 500, 700 F) ou autre montant.
- Accueil : date de fin du plan Zed et nombre de courses Zed du jour.

### Restaurants et administration
- Connexion perdue : les pages gardent ce qu'elles montraient (copie sur l'appareil, effacée à la
  déconnexion), avec l'heure de la dernière mise à jour, et se rechargent seules au retour du réseau.

### Base de données
- Migration additive `0030_destination_zed.sql` : colonne `destination` des courses Zed.

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
