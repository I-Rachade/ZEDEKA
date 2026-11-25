# Parc mobile de Zedeka (MDM)

**Chez Zedeka** : Worker `zedeka-mdm` sur `https://zedeka-mdm.poinderecharge.com`, base D1 `zedeka-mdm-db` (Europe de
l'Ouest), séparés de l'API et du site Zedeka. On ouvre la console depuis l'admin Zedeka, menu **Gestion > Parc mobile**
(directeur et administrateur adjoint) : l'API signe un jeton d'une minute avec `MDM_SSO_SECRET`, la console le vérifie
avec `SSO_SECRET` (même valeur) et crée le compte administrateur au premier passage.

Mise en ligne : `npm run deploy` (`scripts/deploy.sh`), lancé à chaque mise en ligne de l'API Zedeka
(`npm run deploy:mdm` de `backend/`, via l'intégration Git de Cloudflare), ou par le workflow « Déployer le parc mobile » en secours. Au premier
passage il génère les secrets `JWT_SECRET`, `DATA_KEY`, `NETWORK_TOKEN` et `SSO_SECRET` (+ `MDM_SSO_SECRET` sur
`zedeka-api`) ; ensuite il les garde. Pour brancher le contrôleur Wi-Fi, choisir un `NETWORK_TOKEN` connu :
`npx wrangler secret put NETWORK_TOKEN --name zedeka-mdm`.

Liaisons avec Zedeka (liaisons de service `ZEDEKA_API` ↔ `MDM`, jetons HS256 d'une minute signés avec le même secret) :
- **Alertes graves** (critique ou haute : perte, vol, protection désactivée, hors zone…) : envoyées à `POST /api/mdm/alerts`
  de l'API, qui les pousse en notification « Technique » au directeur et à l'adjoint (`pushToZedeka`, `src/lib/util.ts`).
- **Départ d'un membre** (désactivé ou supprimé dans Équipe) : l'API appelle `POST /api/integration/zedeka/member-left` ;
  le compte MDM est désactivé et ses téléphones d'entreprise verrouillés (appareils personnels seulement signalés).
- **Tests** : à chaque PR qui touche `mdm/`, le workflow lance le serveur, sème le parc de démonstration et passe `npm test`.

---

# Plateforme MDM sur Cloudflare

Gestion des smartphones et tablettes de l'entreprise (Android et iOS) : enrôlement automatique, localisation,
applications, verrouillage, effacement, politiques de mot de passe, tableau de bord et alertes.
Elle tourne entièrement sur Cloudflare (Workers + D1 + Cron Triggers), sans serveur à maintenir,
et peut aussi tourner sur un serveur de l'entreprise grâce au runtime open source `workerd`.

## Démarrage rapide (poste de développement)

Prérequis : Node.js 20 ou plus.

```bash
npm install
cp .dev.vars.example .dev.vars          # puis remplir les secrets (voir ci-dessous)
npm run db:migrate:local                 # crée la base D1 locale
npm run dev                              # http://localhost:8787
# dans un second terminal : parc de démonstration de 24 appareils
MDM_URL=http://localhost:8787 SETUP_TOKEN=<votre SETUP_TOKEN> npm run simulate -- --seed
MDM_URL=http://localhost:8787 npm run simulate -- --run     # fait « vivre » le parc
MDM_URL=http://localhost:8787 npm test                      # tests d'intégration
```

Connexion : `admin@entreprise.fr` / `Admin!MDM-2026` (administrateur) ou `claire.martin@entreprise.fr` / `Utilisateur!2026` (utilisateur).

Générer les secrets :

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('DATA_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

## Déploiement sur Cloudflare

```bash
npx wrangler login
npx wrangler d1 create mdm-db            # recopier database_id dans wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put JWT_SECRET
npx wrangler secret put DATA_KEY
npx wrangler secret put SETUP_TOKEN
npx wrangler secret put NETWORK_TOKEN
npm run deploy                           # https://mdm-platform.<compte>.workers.dev
```

Puis créer le premier administrateur :

```bash
curl -X POST https://<votre-domaine>/api/setup -H 'content-type: application/json' \
  -d '{"setup_token":"<SETUP_TOKEN>","email":"admin@exemple.fr","name":"Admin","password":"<mot de passe fort>"}'
```

Recommandé en production : un domaine personnalisé et Cloudflare Access (SSO + MFA) devant `/` et `/api/*`,
en laissant `/agent/*`, `/mdm/*`, `/enroll` et `/api/network/events` accessibles aux appareils et au contrôleur réseau.

## Organisation du code

| Dossier / fichier | Rôle |
| --- | --- |
| `src/index.ts` | Point d'entrée : routage, en-têtes de sécurité, tâches planifiées |
| `src/routes/auth.ts` | Connexion, comptes, rôles, droits RGPD (export, anonymisation) |
| `src/routes/devices.ts` | Inventaire, commandes à distance, localisation, carte |
| `src/routes/admin.ts` | Statistiques, alertes, applications, politiques, enrôlement, audit |
| `src/routes/agent.ts` | API des appareils, événements réseau, protocole MDM Apple, page d'enrôlement |
| `src/lib/services.ts` | Règles métier : conformité, commandes, géorepérage, alertes, purge |
| `src/lib/crypto.ts` | PBKDF2, JWT, AES-256-GCM (WebCrypto, aucune dépendance) |
| `src/providers/` | Canaux de gestion : agent, Android Management API, MDM Apple |
| `migrations/` | Schéma SQL D1 (ajouter `0002_….sql` pour toute évolution) |
| `public/` | Console d'administration (HTML/CSS/JS sans framework) |
| `agent/simulator.mjs` | Simulateur de parc et implémentation de référence de l'agent |
| `tests/` | Tests d'intégration de l'API |

## Modifier la plateforme

- **Nouvelle commande à distance** : l'ajouter dans `COMMANDS` (`src/providers/index.ts`), puis la traduire dans chaque provider.
- **Nouvelle règle de conformité** : `evaluateCompliance` dans `src/lib/services.ts`.
- **Nouvelle alerte** : `openAlert(...)` là où l'événement se produit, ou dans `runAlertRules` (exécuté toutes les 5 minutes).
- **Nouvel écran** : une fonction dans `pages` et une entrée dans `NAV` (`public/app.js`).
- **Nouveau canal de gestion** (ex. un autre fournisseur) : un fichier dans `src/providers/` et une entrée dans `PROVIDERS`.
- **Paramètres** (zone géographique, durées de conservation, version minimale d'OS…) : `vars` dans `wrangler.jsonc`.
