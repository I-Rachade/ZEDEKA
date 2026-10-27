# Zedeka

Livraison de colis et commande de repas à Lomé. « Zedeka » veut dire « en même temps » :
vous commandez, et le livreur est déjà en route.

## Structure

- `backend/` : API REST (Node.js, Express, Prisma, PostgreSQL). Elle sert la page de commande
  aujourd'hui et servira demain l'espace admin, les livreurs et les restaurants.
- `frontend/` : site web (Next.js, TypeScript, Tailwind), en français et pensé pour mobile.

## Pilote : commande de repas par QR code

Chaque restaurant partenaire a une page `/r/<slug>` (le QR code pointe dessus). Le client choisit
ses plats, sa zone et son mode de paiement. L'API recalcule les prix, enregistre la commande et
renvoie un lien WhatsApp pré-rempli vers le numéro de Zedeka. Le client suit ensuite sa commande
sur `/commande/<code>`.

## Démarrer en local

Prérequis : Node.js 20+ et PostgreSQL.

```bash
# Backend
cd backend
cp .env.example .env        # adapter DATABASE_URL et ZEDEKA_WHATSAPP
npm install
npm run db:migrate          # crée les tables
npm run db:seed             # 2 restaurants et 3 zones de démonstration
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
| POST    | `/api/orders`              | Créer une commande, renvoie le lien WhatsApp |
| GET     | `/api/orders/:code`        | Suivi d'une commande                   |

Tous les montants sont des entiers en FCFA.
