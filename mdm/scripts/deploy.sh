#!/usr/bin/env bash
# Mise en ligne du parc mobile (Worker zedeka-mdm + base D1 zedeka-mdm-db), en une commande : `npm run deploy`.
# Utilisée par l'intégration Git de Cloudflare (Workers Builds, comme zedeka-api et zedeka-web), par le workflow
# GitHub « Déployer le parc mobile » et à la main. Il faut seulement un accès Cloudflare (jeton du build, secrets
# CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID, ou `npx wrangler login`).
# Au premier passage : crée la base si besoin et génère les secrets du Worker ; ensuite, les garde tels quels.
set -euo pipefail
cd "$(dirname "$0")/.."
W="npx wrangler"

# 1. Base D1 : identifiant déjà inscrit dans wrangler.jsonc ; sinon retrouvée ou créée par son nom.
if grep -q "00000000-0000-0000-0000-000000000000" wrangler.jsonc; then
  find_db() { $W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const db=JSON.parse(s).find(d=>d.name==="zedeka-mdm-db");process.stdout.write(db?db.uuid:"")})'; }
  ID=$(find_db)
  if [ -z "$ID" ]; then $W d1 create zedeka-mdm-db --location weur; ID=$(find_db); fi
  [ -n "$ID" ] || { echo "Base zedeka-mdm-db introuvable après création" >&2; exit 1; }
  sed -i "s/00000000-0000-0000-0000-000000000000/$ID/" wrangler.jsonc
fi

# 2. Schéma, puis Worker.
$W d1 migrations apply zedeka-mdm-db --remote
$W deploy

# 3. Secrets générés une seule fois (jamais affichés).
have() { $W secret list --name "$1" --format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).some(x=>x.name===process.argv[1])?0:1)}catch{process.exit(1)}})' "$2"; }
put() { printf '%s' "$3" | $W secret put "$2" --name "$1" > /dev/null && echo "Secret $2 posé sur $1"; }
rand() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('$2'))"; }
have zedeka-mdm JWT_SECRET    || put zedeka-mdm JWT_SECRET "$(rand 48 base64)"
have zedeka-mdm DATA_KEY      || put zedeka-mdm DATA_KEY "$(rand 32 base64)"
have zedeka-mdm NETWORK_TOKEN || put zedeka-mdm NETWORK_TOKEN "$(rand 24 hex)"
# Même valeur des deux côtés : la console accepte les jetons signés par l'admin Zedeka (menu Gestion > Parc mobile).
if ! have zedeka-mdm SSO_SECRET || ! have zedeka-api MDM_SSO_SECRET; then
  SSO=$(rand 48 base64)
  put zedeka-mdm SSO_SECRET "$SSO"
  put zedeka-api MDM_SSO_SECRET "$SSO" || echo "MDM_SSO_SECRET non posé sur zedeka-api : à ajouter à la main (même valeur que SSO_SECRET)" >&2
fi
echo "Parc mobile en ligne : https://zedeka-mdm.poinderecharge.com"
