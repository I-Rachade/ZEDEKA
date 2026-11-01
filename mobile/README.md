# Applications mobiles Zedeka (Android et iOS)

Chaque application est une coque [Capacitor](https://capacitorjs.com) qui ouvre le site en ligne : une
correction publiée sur `zedeka.poinderecharge.com` arrive aussitôt dans l'application, sans nouvelle version
sur les stores. Seul ce qui touche au téléphone (icône, permissions, plugins natifs) demande une mise à jour.

| Application | Dossier | Ouvre | Identifiant |
| --- | --- | --- | --- |
| Client | `client/` | `https://zedeka.poinderecharge.com/app` | `com.zedeka.client` |
| Livreur | `livreur/` | `https://zedeka.poinderecharge.com/livreur` | `com.zedeka.livreur` |
| Restaurant | `restaurant/` | `https://zedeka.poinderecharge.com/restaurant` | `com.zedeka.restaurant` |

L'identifiant ne peut plus changer une fois l'application publiée.

## Ce que fait l'application client

- Ouvre `/app` en plein écran, portrait, avec l'icône et l'écran de démarrage Zedeka (vert, logo Z).
- Les liens vers d'autres sites (WhatsApp, `wa.me`) s'ouvrent dans l'application correspondante.
- Sans réseau au démarrage : page « Pas de connexion » avec un bouton Réessayer (`client/www/hors-ligne.html`).
- Position : demandée par le téléphone (Android et iOS) pour l'adresse et le tri « Près de moi ».
- La proposition « Ajouter à l'écran d'accueil » du site ne s'affiche pas dans l'application.

## Applications livreur et restaurant : alertes natives

Même principe que l'application client, avec en plus les notifications Firebase (plugin
`@capacitor-firebase/messaging`) : la nouvelle course (livreur) ou la nouvelle commande (restaurant) sonne même
téléphone verrouillé, ce que les notifications du navigateur font mal, surtout sur iPhone.

- Le site reconnaît l'application : « Activer les alertes » (bandeau ou profil) demande l'autorisation du
  téléphone et enregistre le jeton Firebase auprès de l'API (`POST /api/<espace>/push/native`).
- Sur Android, les alertes passent par le canal « Alertes Zedeka » (importance maximale, son, vibration,
  visible écran verrouillé) ; sur iPhone, elles sont « urgentes » (time-sensitive).
- Toucher la notification ouvre la page concernée.
- Le restaurant peut tourner l'écran (tablette) ; le livreur reste en portrait.

### Brancher Firebase (une fois, gratuit)

1. Créer un projet sur <https://console.firebase.google.com> (par exemple « Zedeka »).
2. Ajouter deux applications Android (`com.zedeka.livreur`, `com.zedeka.restaurant`) et télécharger chaque
   `google-services.json` dans `mobile/livreur/android/app/` et `mobile/restaurant/android/app/`.
3. Ajouter deux applications iOS (mêmes identifiants) et placer chaque `GoogleService-Info.plist` dans
   `mobile/<app>/ios/App/App/` (dans Xcode : glisser le fichier dans le dossier App, cible App cochée).
4. iPhone : dans le compte Apple Developer, créer une clé APNs (Certificates, Identifiers & Profiles > Keys,
   « Apple Push Notifications service ») et l'envoyer dans Firebase (Paramètres du projet > Cloud Messaging).
   Dans Xcode, la capacité « Push Notifications » est déjà déclarée (`App.entitlements`).
5. API : Paramètres du projet > Comptes de service > « Générer une nouvelle clé privée », puis mettre tout le
   contenu du fichier JSON dans le secret `FCM_SERVICE_ACCOUNT` du Worker `zedeka-api`
   (`npx wrangler secret put FCM_SERVICE_ACCOUNT`).

Sans ces fichiers, les applications s'installent et fonctionnent, mais les alertes natives restent coupées
(les notifications du navigateur continuent de marcher sur le site).

## Construire

APK Android de test : chaque changement de `mobile/` lance l'action GitHub « Apps Android » ;
les APK se téléchargent dans l'onglet Actions, rubrique « Artifacts », et s'installe sur un téléphone Android
(autoriser l'installation depuis cette source).

Sur un ordinateur (remplacer `client` par `livreur` ou `restaurant`) :

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
2. Créer une clé de signature (une par application) (Android Studio, *Generate Signed App Bundle*, ou `keytool`) et la garder en
   lieu sûr : sans elle, plus de mise à jour possible (ou activer « Play App Signing », recommandé).
3. Dans la Play Console : créer chaque application (« Zedeka », « Zedeka Livreur », « Zedeka Restaurant »), remplir la fiche (description, captures, icône
   512 × 512, image de présentation 1024 × 500), la politique de confidentialité
   (`https://zedeka.poinderecharge.com/app/confidentialite`), le questionnaire de contenu et la section
   « Sécurité des données » (numéro de téléphone, adresse, position).
4. Envoyer le fichier `.aab` en test interne, puis en production. Un compte personnel récent doit d'abord
   faire tester l'application par 12 personnes pendant 14 jours avant la production (pour chaque application ; un compte d'entreprise en est dispensé).

#### Construire les `.aab` signés

L'action GitHub « Apps Android : Play Store » (onglet Actions > Run workflow, choisir la version affichée)
construit les trois `.aab` signés ; ils se téléchargent dans la rubrique « Artifacts ». Le numéro de version
(`versionCode`) augmente tout seul à chaque exécution, comme l'exige le Play Store.

Secrets GitHub à créer une fois (Settings > Secrets and variables > Actions) :
`ZEDEKA_UPLOAD_KEYSTORE_BASE64` (la clé d'envoi `.jks` en base64), `ZEDEKA_KEYSTORE_PASSWORD`, `ZEDEKA_KEY_ALIAS`,
`ZEDEKA_KEY_PASSWORD`. Facultatif pour les alertes natives : `FIREBASE_LIVREUR_JSON` et `FIREBASE_RESTAURANT_JSON`
(contenu de chaque `google-services.json`). La clé ne doit jamais être mise dans le dépôt (`*.jks` est ignoré).

### App Store (iPhone)

1. Compte Apple Developer (99 $ par an) : <https://developer.apple.com/programs/enroll/>.
2. Un Mac avec Xcode (ou un service de build en ligne comme Codemagic ou Ionic Appflow).
3. Dans Xcode : choisir l'équipe (Signing & Capabilities), puis Archive et envoi vers App Store Connect.
4. Dans App Store Connect : fiche (captures iPhone 6,9 pouces), politique de confidentialité, « App Privacy »,
   un compte de test pour la revue (numéro et code), puis TestFlight et soumission.

Apple refuse parfois les applications qui ne font qu'afficher un site (règle 4.2). Les arguments de Zedeka :
commande et suivi en direct, position, ouverture de WhatsApp. Ajouter les notifications de suivi de commande
(plugin Push de Capacitor) renforcerait le dossier si Apple refuse.
