# Agent MDM (Android)

Application Android native (Java, sans Capacitor) qui relie un téléphone au parc mobile Zedeka
(`mdm/`, en ligne sur <https://zedeka-mdm.poinderecharge.com>). Elle parle exactement le même protocole que le
simulateur `mdm/agent/simulator.mjs` :

1. `POST /agent/enroll` : jeton d'enrôlement (QR code ou code) → jeton de l'appareil
2. `POST /agent/checkin` toutes les 15 min (plus souvent en mode perdu) : inventaire → commandes et politiques
3. `POST /agent/commands/:id/result` : résultat de chaque commande
4. `POST /agent/ping` chaque minute (service permanent) : commandes en attente ? → synchronisation immédiate
5. `POST /agent/unenroll` : l'utilisateur quitte la gestion avec le code de déblocage de l'administrateur

Identifiant : `com.zedeka.mdm`. Android 8.0 minimum.

## Deux façons de l'installer

| | Téléphone personnel ou déjà en service | Téléphone de l'entreprise (neuf ou réinitialisé) |
| --- | --- | --- |
| Installation | APK installé à la main, puis QR code / code | QR code scanné à l'écran d'accueil (6 touches) ou `adb` |
| Rôle Android | Administrateur de l'appareil (activé par l'utilisateur) | Propriétaire de l'appareil (Device Owner) |
| Inventaire, conformité, applis | oui | oui |
| Localiser (sur demande motivée), faire sonner | oui | oui |
| Verrouiller, effacer à distance | oui, si l'utilisateur active l'administration | oui |
| Mode perdu | message + verrouillage + notification | écran bloquant, impossible d'en sortir |
| Code de verrouillage | règles de base imposées, l'utilisateur est invité à renforcer son code | imposé, réinitialisable à distance |
| Installer / désinstaller une appli | proposé à l'utilisateur (notification) | silencieux |
| Applis interdites | l'utilisateur est invité à les désinstaller | masquées |
| Restrictions (caméra, USB, Bluetooth…) | non | oui |
| Redémarrer à distance | non | oui |
| Quitter la gestion | avec le code de déblocage | avec le code de déblocage |
| Désinstaller l'agent | impossible tant que l'administration est active ; la désactiver verrouille l'écran et déclenche une alerte critique dans la console | bloqué par Android (désinstallation, réinitialisation d'usine et démarrage sans échec interdits) |

Sur un téléphone personnel, l'effacement complet est refusé par l'agent lui-même (seules les données de
l'entreprise peuvent être effacées), en plus du contrôle côté serveur.

## Code de déblocage

Console > fiche de l'appareil > « Code de déblocage » (administrateurs, motif obligatoire, inscrit au journal
d'audit) : code à 8 chiffres valable environ 2 heures. Le téléphone le vérifie même sans réseau (même calcul que
`mdm/src/lib/unlock.ts`, à partir d'un secret propre à l'appareil reçu à l'enrôlement), puis le serveur le
revérifie avant de retirer l'appareil.

Limite d'Android : sur un téléphone non provisionné comme téléphone d'entreprise, l'utilisateur peut toujours
désactiver l'administration dans les réglages (Android ne permet à aucune appli de l'empêcher). L'agent verrouille
alors l'écran et la console reçoit aussitôt une alerte critique. Pour une protection totale, provisionner le
téléphone en propriétaire de l'appareil (voir plus bas).

## Délai des commandes

Un service permanent (notification discrète « Agent MDM actif ») interroge le serveur chaque minute et
synchronise dès qu'une commande attend. Sur Xiaomi, Oppo, Huawei…, autoriser le « fonctionnement en arrière-plan »
(proposé dans l'appli) et le « démarrage automatique », sinon le système met l'agent en veille.

## RGPD

- Avant tout enrôlement, l'appli affiche une notice : ce qui est envoyé, ce qui n'est jamais lu, ce que
  l'entreprise peut faire, les droits de l'utilisateur. Elle reste consultable (« Notice de confidentialité »).
- « Voir les données envoyées » montre le dernier envoi réel.
- Envoyé : nom/modèle, version d'Android, chiffrement, présence d'un code (jamais le code), root, batterie,
  stockage, applications installées par l'utilisateur (nom et version). Pas de numéro de série ni d'IMEI.
- Localisation facultative, jamais continue : uniquement sur commande « Localiser » (motif obligatoire côté
  console) ou en mode perdu ; une notification prévient l'utilisateur à chaque envoi.
- Le jeton de l'appareil n'est ni sauvegardé dans le cloud ni transféré (`allowBackup=false`).

## Construire

L'action GitHub « Agent MDM Android » construit l'APK à chaque changement de `mobile/agent-mdm/`
(onglet Actions, rubrique « Artifacts »). En local : `cd mobile/agent-mdm && ./gradlew assembleDebug`
(SDK Android 36, JDK 17+).

L'APK de test est signé avec la clé de TEST du dépôt (`app/agent-test.keystore`) pour que chaque version
s'installe par-dessus la précédente. Pour la production, fournir `ZEDEKA_KEYSTORE_FILE` (+ mot de passe et alias)
comme pour les autres applications, puis `./gradlew assembleRelease`.

## Téléphone de l'entreprise (propriétaire de l'appareil)

Sur un téléphone de test réinitialisé, sans compte Google :

```
adb install app-debug.apk
adb shell dpm set-device-owner com.zedeka.mdm/.AdminReceiver
```

En production, à l'écran d'accueil d'un téléphone réinitialisé, toucher 6 fois l'écran puis scanner un QR code
qui contient :

```json
{
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.zedeka.mdm/.AdminReceiver",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": "https://…/agent-mdm.apk",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": "ksbnPju8_tVEMY_s_ZSoo_sgkoArHqjnC-EvrLG7EL8",
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
    "server": "https://zedeka-mdm.poinderecharge.com",
    "enrollment_token": "<jeton d'enrôlement créé dans la console>"
  }
}
```

La somme de contrôle ci-dessus est celle de la clé de TEST ; elle change avec la clé de production. L'agent
devient propriétaire de l'appareil et s'enrôle seul avec le jeton.

## Limites connues

- Téléphone en veille profonde : la sonde peut ralentir ; les commandes arrivent au réveil ou à la synchronisation suivante.
- La lecture du QR code passe par les services Google Play ; sans eux, saisir le code à la main.
- iPhone : plus tard (profil MDM Apple déjà prévu côté serveur).
