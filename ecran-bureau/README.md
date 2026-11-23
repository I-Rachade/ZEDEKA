# Écran du bureau Zedeka

Un grand écran au bureau qui montre en direct l'activité de Zedeka. C'est une simple page web : elle s'affiche sur **n'importe quel appareil avec un navigateur** (télé connectée, ordinateur relié à un moniteur, tablette, Raspberry Pi…).

- **Écran « compteur »** : livraisons du jour en très grand, jauge de l'objectif du jour, comparaison avec hier à la même heure, record, commandes reçues / en cours / repas / colis / boutiques, temps moyen de livraison, courses Zed, commandes heure par heure, **classement des livreurs du jour** et **fil des commandes qui entrent**.
- **Écran « carte »** : restaurants et boutiques (ouverts en vert, fermés en gris, pastille rouge = commandes en cours), livreurs (vert = libre, jaune = en course, gris = sans position récente), trait jaune vers le restaurant quand un livreur va chercher une commande, et les compteurs du terrain (livreurs en ligne, libres, en course, restaurants ouverts, en cuisine, en route, à affecter).
- **Ce qui motive** : un bandeau et une petite sonnerie à chaque nouvelle commande ; confettis et fanfare **toutes les 10 livraisons**, quand **l'objectif du jour** est atteint et quand **le record** est battu.

Les deux écrans tournent automatiquement (40 s chacun). Rien de personnel n'est affiché : ni téléphone, ni adresse, ni nom de client ; les livreurs apparaissent avec leur prénom et l'initiale du nom.

---

## 1. Brancher un écran (2 minutes, sur n'importe quel appareil)

1. Sur l'appareil qui servira d'écran, ouvrez le navigateur à l'adresse **zedeka.poinderecharge.com/ecran**.
2. Un **code à 6 chiffres** s'affiche en grand (par exemple `482 713`).
3. Sur votre téléphone ou votre ordinateur : **Admin Zedeka → Écran du bureau → Brancher un écran**. Tapez le code, donnez un nom (ex. « Télé de l'accueil »), puis **Brancher**.
4. L'écran démarre tout seul dans les secondes qui suivent. Il s'en souvient ensuite : plus rien à taper, même après une coupure de courant.

Le code change tout seul toutes les 15 minutes s'il n'est pas utilisé. Pour arrêter un écran : **Débrancher** dans la même page de l'admin (il s'arrête dans les 30 secondes et affiche un nouveau code).

Mettez ensuite la page **en plein écran** (touche **F**, ou F11 sur un ordinateur) et réglez la mise en veille de l'appareil sur « jamais ».

### Réglages (facultatif, à ajouter à l'adresse)

| Ajout | Effet |
|---|---|
| `?vue=compteur` | toujours le compteur, pas de rotation |
| `?vue=carte` | toujours la carte |
| `?duree=60` | 60 secondes par écran pendant la rotation (40 par défaut, de 10 à 600) |
| `?son=0` | muet |

Plusieurs réglages : séparez-les par `&`, ex. `zedeka.poinderecharge.com/ecran?vue=carte&son=0`. Deux moniteurs ? Branchez-en un avec `?vue=compteur`, l'autre avec `?vue=carte`.

### Objectif du jour

Dans **Admin → Écran du bureau → Objectif du jour**. Laissez vide : il se calcule seul chaque jour (moyenne des 7 derniers jours + 10 %).

## 2. Conseils selon l'appareil

| Appareil | Conseil |
|---|---|
| **Télé connectée** (Android TV, Google TV, Samsung, LG…) | Ouvrez le navigateur de la télé (ou installez-en un, ex. Chrome sur Android TV). Désactivez la mise en veille de la télé. Le son passe par la télé. |
| **Ordinateur relié à un moniteur** (Windows, Mac, Linux) | Chrome ou Edge conseillé. Plein écran avec **F** ou F11. Désactivez la veille de l'ordinateur et de l'écran. Pour que l'écran s'ouvre au démarrage : ajoutez un raccourci vers l'adresse dans le dossier de démarrage. |
| **Tablette** | Laissez-la branchée sur secteur, désactivez la mise en veille. Sur Android, l'« épinglage d'écran » garde la page affichée. |
| **Raspberry Pi** | Voir la partie 3 : une commande installe tout (plein écran au démarrage, pas de veille, relance automatique). |

Le son (sonnerie et fanfare) peut être bloqué par le navigateur tant que personne n'a touché la page : un clic ou une touche une seule fois suffit. Sur le Raspberry Pi, le script s'en occupe.

## 3. Raspberry Pi (écran dédié, sans clavier)

### Matériel

| Élément | Conseil |
|---|---|
| Raspberry Pi | **Pi 4 (4 Go) ou Pi 5**. Un Pi 3 marche pour le compteur, mais la carte sera lente. |
| Carte microSD | 32 Go, classe A1 ou mieux |
| Alimentation | **l'officielle** (5 V 3 A pour le Pi 4, 5 V 5 A pour le Pi 5). Une alimentation faible fait planter l'écran. |
| Câble | micro-HDMI → HDMI |
| Réseau | câble Ethernet de préférence, sinon Wi-Fi |
| Clavier + souris | seulement pour l'installation |

### Préparer la carte microSD

1. Sur votre ordinateur, installez **Raspberry Pi Imager** (raspberrypi.com/software).
2. Choisissez votre modèle de Pi, puis **Raspberry Pi OS (64-bit)**, la version **avec bureau** (pas « Lite »).
3. **Modifier les réglages** (roue dentée) : nom `zedeka-ecran`, utilisateur `zedeka` + mot de passe solide, Wi-Fi (pays **TG**) si pas de câble, fuseau **Africa/Lome**, clavier `fr`, onglet Services : **activer SSH**.
4. Écrivez la carte, mettez-la dans le Pi, branchez écran, clavier, souris, réseau, puis l'alimentation en dernier.

### Installer (une seule commande)

Au premier démarrage, ouvrez le **Terminal** et tapez :

```bash
curl -fsSL -o installer-ecran.sh https://raw.githubusercontent.com/I-Rachade/ZEDEKA/HEAD/ecran-bureau/installer-ecran.sh
bash installer-ecran.sh
sudo reboot
```

Si le dépôt est privé, copiez plutôt le fichier `installer-ecran.sh` (dossier `ecran-bureau` des fichiers du projet) sur une clé USB, puis dans le Terminal : `cp /media/zedeka/*/installer-ecran.sh ~/` avant `bash installer-ecran.sh`.

Après le redémarrage, l'écran s'ouvre en plein écran et affiche son code : branchez-le depuis l'admin (partie 1, étape 3). Le script :

1. installe Chromium et `unclutter` (cache la souris) ;
2. ouvre l'écran **en plein écran (kiosque)** au démarrage et **le rouvre tout seul** s'il se ferme ;
3. **désactive la mise en veille** et ouvre la session automatiquement ;
4. redémarre le Pi **chaque nuit à 4 h** (mémoire propre, nouvelle version du site).

Avec des réglages : `bash installer-ecran.sh "https://zedeka.poinderecharge.com/ecran?vue=compteur"`.

## 4. Au quotidien

| Touche (clavier branché) | Effet |
|---|---|
| ← ou → | changer d'écran |
| P | mettre la rotation en pause / la reprendre |
| F | plein écran / sortir |

- **Pastille « En direct »** verte en haut à droite : tout va bien. Rouge « Connexion perdue » : le réseau est coupé, l'écran réessaie tout seul et garde les derniers chiffres.
- La journée va de minuit à minuit (heure de Lomé). À minuit, le compteur repart de zéro.
- **Admin → Écran du bureau** montre chaque écran branché et son « dernier signal » (s'il est bien allumé).

## 5. Dépannage

| Problème | Solution |
|---|---|
| L'écran affiche un code au lieu des chiffres | Il n'est pas (ou plus) branché : tapez le code dans l'admin. |
| « Code inconnu ou expiré » dans l'admin | Le code a changé entre-temps : tapez celui qui est affiché maintenant. |
| L'écran se met en veille | Réglez la veille de l'appareil (et de la télé/du moniteur) sur « jamais ». Raspberry Pi : `sudo raspi-config` → Display Options → Screen Blanking → **No**. |
| Pas de son | Touchez la page une fois (clic ou touche). Raspberry Pi : `sudo raspi-config` → System Options → Audio → HDMI. |
| Image coupée sur les bords (télé) | Réglage de la télé : format « Écran entier » / « Just Scan » / « 1:1 ». |
| La carte est lente | Appareil plus récent conseillé, ou un seul écran avec `?vue=compteur`. |
| Raspberry Pi : écran noir après démarrage | Attendez 1 minute (le Pi attend le réseau), sinon vérifiez le câble réseau ou le Wi-Fi. |
| Raspberry Pi : intervenir à distance | `ssh zedeka@zedeka-ecran.local` depuis un ordinateur du même réseau, puis `sudo reboot`. |
