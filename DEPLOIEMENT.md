# Mettre Zedeka en ligne sur Cloudflare

Zedeka tourne sur le même compte Cloudflare que poinderecharge, mais avec sa propre base et son propre
stockage : les deux bases et les deux fichiers clients restent séparés.

| Élément | Nom | Rôle |
| --- | --- | --- |
| Site | Worker `zedeka-web` (`frontend/`) | Next.js via OpenNext, sur `zedeka.poinderecharge.com` |
| API | Worker `zedeka-api` (`backend/`) | Express sur Workers ; pas d'adresse publique |
| Base | D1 `zedeka-db` | Données Zedeka (part de zéro, rien à reprendre) |
| Fichiers | R2 `zedeka-media` | Logos et pièces des candidatures partenaires |

Le site reçoit toutes les visites. Il passe `/api/*` à l'API par une liaison de service (`API` dans
`frontend/wrangler.jsonc`) : l'API n'est joignable que par le site.

Rien de ce qui suit ne touche à poinderecharge. Le compte a déjà Workers Paid, R2 Paid et Zero Trust
(offre gratuite, suffisante pour Access) : aucun abonnement à ajouter.

## 1. Créer la base et l'espace de fichiers

```bash
cd backend
npm install
npx wrangler login
npx wrangler d1 create zedeka-db        # noter le database_id affiché
npx wrangler r2 bucket create zedeka-media
```

Reporter le `database_id` dans `backend/wrangler.jsonc` (déjà fait pour `zedeka-db`), puis créer les tables :

```bash
npm run db:migrate                       # applique migrations/0001_init.sql sur la base en ligne
```

## 2. Secrets de l'API

Dans le tableau de bord (Workers & Pages > zedeka-api > Settings > Variables and Secrets) ou avec
`npx wrangler secret put <NOM>` :

| Nom | Valeur |
| --- | --- |
| `ADMIN_PASSWORD` | Mot de passe de l'admin |
| `ADMIN_SECRET` | Longue chaîne aléatoire (`openssl rand -base64 48`) |
| `ZEDEKA_WHATSAPP` | Numéro WhatsApp de Zedeka, format international sans + |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `VAPID_CONTACT` | `mailto:rachadeissaka@gmail.com` |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Voir l'étape 4 |
| `ADMIN_ACCESS_REQUIRED` | `1` |
| `ADMIN_EMAILS` | `rachadeissaka@gmail.com` |
| `DIDIT_API_KEY` | Clé API Didit (console Didit > API & Webhooks) : envoi des codes de connexion par SMS |

Ne pas définir `OTP_DEV_CODES` en production. Sans `DIDIT_API_KEY`, la connexion des clients et des livreurs
est indisponible (la commande sans compte reste possible).

## 3. Déployer

L'API d'abord (le site s'y relie), puis le site :

`npm run deploy` dans `backend/` applique d'abord les migrations en attente sur la base en ligne
(dont `0002_donnees_de_base.sql` : types de colis et zones de départ, modifiables ensuite dans l'admin).

```bash
cd backend && npm run deploy
cd ../frontend && npm install && npm run deploy
```

`frontend/wrangler.jsonc` déclare `zedeka.poinderecharge.com` comme domaine personnalisé : Cloudflare crée
l'enregistrement DNS et le certificat dans la zone poinderecharge.com au premier déploiement.

Les tâches planifiées (relances des restaurants, propositions de course expirées, livreurs inactifs) tournent
chaque minute via le cron de `backend/wrangler.jsonc`.

## 4. Protéger l'admin (Cloudflare Access, double authentification)

Même protection que le back-office poinderecharge :

1. Zero Trust > Access > Applications > Add an application > Self-hosted.
2. Nom « Zedeka admin », domaines : `zedeka.poinderecharge.com/admin` et `zedeka.poinderecharge.com/api/admin`.
3. Règle : Allow, Emails = `rachadeissaka@gmail.com`. Exiger la double authentification (Authentication >
   méthode avec second facteur, comme pour poinderecharge).
4. Copier l'« Application Audience (AUD) Tag » dans `ACCESS_AUD`, et l'adresse de l'équipe
   (`https://<équipe>.cloudflareaccess.com`) dans `ACCESS_TEAM_DOMAIN`.

Avec `ADMIN_ACCESS_REQUIRED=1`, l'API vérifie elle-même la signature du jeton Access à chaque requête admin
(`backend/src/access.ts`) et refuse toute adresse absente de `ADMIN_EMAILS`. Un réglage manquant ferme l'admin
au lieu de l'ouvrir. Le mot de passe admin reste demandé en plus.

## 5. Vérifier

- `https://zedeka.poinderecharge.com/api/health` répond `{"ok":true}`.
- `/admin` demande d'abord la connexion Access, puis le mot de passe.
- Créer le restaurant d'essai dans l'admin, puis un livreur d'essai.

## En local

```bash
cd backend
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run db:seed              # données de démonstration, base locale seulement
npm run dev                  # http://localhost:8787

cd ../frontend               # autre terminal
npm install
npm run dev                  # http://localhost:3000 ; /api/* part vers localhost:8787
npm run preview              # ou : le site tel qu'il tournera sur Cloudflare, relié à l'API locale
```

## Limites connues

- **Pas de transactions sur D1.** Les opérations qui en avaient besoin (validation d'un partenaire, relevés
  d'espèces et reversements) réservent d'abord les lignes par une mise à jour conditionnelle : un double clic
  ne crée pas de doublon, mais une panne au milieu peut laisser une étape à refaire à la main.
- **Cron à la minute.** Une course proposée à un livreur expire au bout de 60 secondes, mais n'est remise
  « à affecter » qu'au passage suivant du cron (jusqu'à 2 minutes au total).
- **SMS.** Les codes sont envoyés et vérifiés par Didit (code à 6 chiffres, valable 5 minutes, 3 essais).
  Chaque envoi est facturé sur le compte Didit : sans crédit, la demande de code répond « L'envoi du code a échoué ».
