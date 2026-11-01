# Tests de bout en bout

Playwright joue les parcours principaux dans un vrai navigateur (Chromium, format téléphone), sur le vrai site
(`next dev`) branché sur la vraie API (`wrangler dev`) :

| Fichier | Parcours |
| --- | --- |
| `tests/auth.spec.ts` | Inscription par code SMS, choix du PIN, reconnexion par numéro et PIN (et PIN faux refusé) |
| `tests/meal.spec.ts` | Commande repas sans compte avec la position du client (prix au km), le restaurant accepte et prépare, la répartition affecte un livreur, le livreur accepte, récupère, remet et encaisse ; le client confirme la réception, note le livreur et le restaurant, et voit « Livrée » |
| `tests/parcel.spec.ts` | Colis : l'expéditeur crée un lien de position, le destinataire l'ouvre et partage sa position, le prix suit la distance |
| `tests/driverDelete.spec.ts` | Le directeur supprime un livreur après confirmation : sans historique il est effacé, avec un historique son compte est fermé et son nom reste dans les anciennes données |
| `tests/restaurant-location.spec.ts` | Position obligatoire d'un restaurant : création refusée sans position, lien envoyé au gérant, restaurant masqué, le gérant partage la position, l'admin peut le rendre visible |
| `tests/table-order.spec.ts` | Commande à table : le gérant crée ses tables et leurs QR codes, le client scanne la table 2 et commande sur place sans numéro, le restaurant voit « Table 2 », la sert, le client voit « Servie à table » |
| `tests/i18n.spec.ts` | Bouton FR / EN : textes, cookie gardé au rechargement, pages rendues côté serveur et erreurs de l'API |

## Lancer

```bash
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
cd e2e
npm install
npx playwright install chromium   # une fois
npm test                          # ou npm run test:ui pour suivre pas à pas
npm run report                    # rapport HTML, avec captures et traces des échecs
```

Playwright démarre tout seul l'API sur le port 8788 et le site sur le port 3100, à côté de `npm run dev` (8787 et
3000). Arrêtez d'abord un `next dev` déjà lancé dans `frontend/` : deux `next dev` ne partagent pas le dossier `.next`.

- La base D1 des tests est neuve à chaque lancement (`e2e/.state/`, migrations et `npm run db:seed`) ; celle de
  `npm run dev` n'est pas touchée. Hors CI, des serveurs déjà lancés sur 8788 et 3100 sont réutilisés.
- Les codes SMS s'affichent à l'écran (`OTP_DEV_CODES=true`) ; mots de passe et clé admin de test dans `env.mjs`.
- Chaque test crée ses propres données (restaurant, livreur, numéros uniques) par l'API admin
  (`tests/fixtures.ts`) et envoie une adresse IP fictive à lui, pour ne pas buter sur les limites de l'API.
- En CI : `.github/workflows/e2e.yml`, à chaque changement de `backend/`, `frontend/` ou `e2e/`.
