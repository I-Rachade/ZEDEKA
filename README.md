# Zedeka

Livraison de colis et commande de repas à Lomé. « Zedeka » veut dire « en même temps » :
vous commandez, et le livreur est déjà en route.

## Structure

- `backend/` : API REST (Node.js, Express, Prisma, PostgreSQL). Elle sert la page de commande
  aujourd'hui et servira demain l'espace admin, les livreurs et les restaurants.
- `frontend/` : site web (Next.js, TypeScript, Tailwind), en français et pensé pour mobile.

## Côté clients

- `/r/<slug>` : carte d'un restaurant (le QR code pointe dessus), avec variantes, suppléments, livraison ou
  à emporter, et position facultative pour les zones facturées à la distance.
- `/colis` : envoi d'un colis (expéditeur, destinataire, catégorie, poids).
- `/commande/<code>` : suivi de la commande.
- `/devenir-livreur` : candidature d'un livreur, validée ensuite dans l'admin.

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
- **Restaurants** : zone, délais, logo, position, commission, carte avec photos, variantes et suppléments, QR code,
  identifiants de l'espace restaurant.
- **Livreurs** : validation des candidatures, zone, véhicule, en ligne ou non.
- **Zones** : tarif fixe ou à la distance (prix au km, minimum, maximum).
- **Colis** : catégories avec supplément fixe et prix au kg.
- **Finances** : espèces à récupérer auprès des livreurs, relevés et reversements aux restaurants.
- **Rapport** et **Réglages** (part du livreur, règles d'annulation).

## Espace restaurant (gérant)

`/restaurant`, avec l'e-mail et le mot de passe créés par l'admin (section « Accès restaurant ») :

- **Tableau de bord** : nouvelles commandes, en cuisine, prêtes, ventes du jour et des 7 jours, net après commission.
- **Commandes** : onglets par statut avec compteurs, recherche, impression, bip à l'arrivée d'une commande
  (vérification toutes les 20 secondes). Fiche : accepter avec un temps de préparation ou refuser avec un motif,
  lancer la préparation, signaler « prête ». Une commande repas n'apparaît dans la répartition qu'une fois prête.
- **Carte** : plats, photos, variantes, suppléments, épuisé ou disponible.
- **Horaires et réglages** : fermeture temporaire, horaires par jour (créneaux de nuit possibles), montant minimum,
  délais, téléphone, adresse, logo.
- **Relevés** : montant dû par Zedeka pour les commandes livrées et historique des versements.

Comptes de démonstration après `npm run db:seed` : `chez-tante-ama@demo.zedeka.tg` et
`le-maquis-du-port@demo.zedeka.tg`, mot de passe `zedeka-demo`.

Statuts d'une commande repas : Nouvelle → Acceptée → En préparation → Prête → En livraison → Livrée (ou Annulée).

Revenu Zedeka d'une course = frais de livraison + supplément + commission − remise − part du livreur.
En production, l'API doit être servie en HTTPS et `ADMIN_SECRET` doit être une longue chaîne aléatoire.

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
| GET     | `/api/orders/:code`        | Suivi d'une commande                   |
| POST    | `/api/admin/login`         | Connexion admin, renvoie un jeton      |
| *       | `/api/admin/...`           | Tableau de bord, répartition, commandes, catalogue, zones, livreurs, colis, finances, réglages (jeton requis) |
| POST    | `/api/restaurant/login`    | Connexion d'un gérant, renvoie un jeton |
| *       | `/api/restaurant/...`      | Commandes, statuts, carte, réglages et relevés du restaurant connecté (jeton requis) |

Tous les montants sont des entiers en FCFA.
