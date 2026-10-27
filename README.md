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

L'API recalcule toujours les prix, enregistre la commande et renvoie un lien WhatsApp pré-rempli vers
le numéro de Zedeka.

## Espace admin (directeur des opérations)

`/admin`, après connexion par mot de passe (`ADMIN_PASSWORD`) :

- **Tableau de bord** : courses et revenu Zedeka du jour face au seuil de 13 500 FCFA, candidatures en attente.
- **Répartition** : commandes à affecter et en cours, livreurs en ligne, affectation en un clic.
- **Commandes** : onglets par statut, filtres (dates, repas ou colis, livraison ou à emporter), recherche,
  export CSV, fiche détaillée avec remise, supplément, paiement, annulation motivée et facture imprimable.
- **Restaurants** : zone, délais, logo, position, commission, carte avec photos, variantes et suppléments, QR code.
- **Livreurs** : validation des candidatures, zone, véhicule, en ligne ou non.
- **Zones** : tarif fixe ou à la distance (prix au km, minimum, maximum).
- **Colis** : catégories avec supplément fixe et prix au kg.
- **Finances** : espèces à récupérer auprès des livreurs, relevés et reversements aux restaurants.
- **Rapport** et **Réglages** (part du livreur, règles d'annulation).

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

Tous les montants sont des entiers en FCFA.
