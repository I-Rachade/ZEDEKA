# Applications mobiles Zedeka (Android et iOS)

Chaque application est une coque [Capacitor](https://capacitorjs.com) qui ouvre le site en ligne : une
correction publiée sur `zedeka.poinderecharge.com` arrive aussitôt dans l'application, sans nouvelle version
sur les stores. Seul ce qui touche au téléphone (icône, permissions, plugins natifs) demande une mise à jour.

| Application | Dossier | Ouvre | Identifiant |
| --- | --- | --- | --- |
| Client | `client/` | `https://zedeka.poinderecharge.com/app` | `com.zedeka.client` |
| Livreur | à venir | `/livreur` | `com.zedeka.livreur` |
| Restaurant | à venir | `/restaurant` | `com.zedeka.restaurant` |

L'identifiant ne peut plus changer une fois l'application publiée.

## Ce que fait l'application client

- Ouvre `/app` en plein écran, portrait, avec l'icône et l'écran de démarrage Zedeka (vert, logo Z).
- Les liens vers d'autres sites (WhatsApp, `wa.me`) s'ouvrent dans l'application correspondante.
- Sans réseau au démarrage : page « Pas de connexion » avec un bouton Réessayer (`client/www/hors-ligne.html`).
- Position : demandée par le téléphone (Android et iOS) pour l'adresse et le tri « Près de moi ».
- La proposition « Ajouter à l'écran d'accueil » du site ne s'affiche pas dans l'application.

## Construire

APK Android de test : chaque changement de `mobile/client` lance l'action GitHub « App client Android » ;
l'APK se télécharge dans l'onglet Actions, rubrique « Artifacts », et s'installe sur un téléphone Android
(autoriser l'installation depuis cette source).

Sur un ordinateur :

```bash
cd mobile/client
npm install
npx cap sync
npx cap open android   # Android Studio : Build > Generate Signed App Bundle pour le Play Store
npx cap open ios       # Xcode (Mac obligatoire) : Product > Archive pour l'App Store
```

Icônes et écran de démarrage : les images sources sont dans `client/assets/` ; après modification,
`npm run assets` puis `npx cap sync`.

## Publier

### Google Play

1. Compte développeur Google Play (25 $ une fois) : <https://play.google.com/console/signup>.
2. Créer une clé de signature (Android Studio, *Generate Signed App Bundle*, ou `keytool`) et la garder en
   lieu sûr : sans elle, plus de mise à jour possible (ou activer « Play App Signing », recommandé).
3. Dans la Play Console : créer l'application « Zedeka », remplir la fiche (description, captures, icône
   512 × 512, image de présentation 1024 × 500), la politique de confidentialité
   (`https://zedeka.poinderecharge.com/app/confidentialite`), le questionnaire de contenu et la section
   « Sécurité des données » (numéro de téléphone, adresse, position).
4. Envoyer le fichier `.aab` en test interne, puis en production. Un compte personnel récent doit d'abord
   faire tester l'application par 12 personnes pendant 14 jours avant la production.

### App Store (iPhone)

1. Compte Apple Developer (99 $ par an) : <https://developer.apple.com/programs/enroll/>.
2. Un Mac avec Xcode (ou un service de build en ligne comme Codemagic ou Ionic Appflow).
3. Dans Xcode : choisir l'équipe (Signing & Capabilities), puis Archive et envoi vers App Store Connect.
4. Dans App Store Connect : fiche (captures iPhone 6,9 pouces), politique de confidentialité, « App Privacy »,
   un compte de test pour la revue (numéro et code), puis TestFlight et soumission.

Apple refuse parfois les applications qui ne font qu'afficher un site (règle 4.2). Les arguments de Zedeka :
commande et suivi en direct, position, ouverture de WhatsApp. Ajouter les notifications de suivi de commande
(plugin Push de Capacitor) renforcerait le dossier si Apple refuse.
