# Écran du bureau Zedeka : installation sur Raspberry Pi

Un grand moniteur au bureau qui montre en direct l'activité de Zedeka :

- **Écran « compteur »** : livraisons du jour en très grand, jauge de l'objectif du jour, comparaison avec hier à la même heure, record, commandes reçues / en cours / repas / colis / boutiques, temps moyen de livraison, courses Zed, commandes heure par heure, **classement des livreurs du jour** et **fil des commandes qui entrent**.
- **Écran « carte »** : restaurants et boutiques (ouverts en vert, fermés en gris, pastille rouge = commandes en cours), livreurs (vert = libre, jaune = en course, gris = sans position récente), trait jaune vers le restaurant quand un livreur va chercher une commande, et les compteurs du terrain (livreurs en ligne, libres, en course, restaurants ouverts, en cuisine, en route, à affecter).
- **Ce qui motive** : un bandeau et une petite sonnerie à chaque nouvelle commande ; confettis et fanfare **toutes les 10 livraisons**, quand **l'objectif du jour** est atteint et quand **le record** est battu.

Les deux écrans tournent automatiquement (40 s chacun). Rien de personnel n'est affiché : ni téléphone, ni adresse, ni nom de client ; les livreurs apparaissent avec leur prénom et l'initiale du nom.

---

## 1. Matériel

| Élément | Conseil |
|---|---|
| Raspberry Pi | **Pi 4 (4 Go) ou Pi 5**. Un Pi 3 marche pour le compteur, mais la carte sera lente. |
| Carte microSD | 32 Go, classe A1 ou mieux |
| Alimentation | **l'officielle** (5 V 3 A pour le Pi 4, 5 V 5 A pour le Pi 5). Une alimentation faible fait planter l'écran. |
| Câble | micro-HDMI → HDMI (Pi 4 et Pi 5 ont des prises micro-HDMI) |
| Réseau | câble Ethernet de préférence, sinon Wi-Fi |
| Moniteur ou télé | Full HD (1920×1080) idéal ; la page s'adapte aussi au 4K et au 1366×768 |
| Clavier + souris | seulement pour l'installation |
| Haut-parleurs | facultatif : son par HDMI (télé) ou prise jack |

## 2. Créer le lien de l'écran (sur votre ordinateur)

1. Ouvrez l'admin Zedeka → menu **Écran du bureau** (réservé au directeur).
2. Donnez un nom (ex. « Grand écran du bureau ») → **Créer le lien**.
3. **Copiez le lien** : il n'est montré qu'une seule fois. Il ressemble à
   `https://zedeka.poinderecharge.com/ecran?cle=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
4. Dans la même page, réglez si vous voulez **l'objectif du jour** (laissez vide : il se calcule seul chaque jour, moyenne des 7 derniers jours + 10 %).

> Ce lien donne accès à l'écran en lecture seule, sans connexion à l'admin. Ne le partagez pas. Si vous le perdez ou s'il fuit : **Révoquer** dans la même page (l'écran s'arrête dans les 30 secondes), puis créez-en un nouveau.

**Options à ajouter à la fin du lien** (facultatif) :

| Ajout | Effet |
|---|---|
| `&vue=compteur` | toujours le compteur, pas de rotation |
| `&vue=carte` | toujours la carte |
| `&duree=60` | 60 secondes par écran pendant la rotation (40 par défaut, de 10 à 600) |
| `&son=0` | muet |

Deux moniteurs ? Créez deux liens (un par Pi), l'un avec `&vue=compteur`, l'autre avec `&vue=carte`.

## 3. Préparer la carte microSD

1. Sur votre ordinateur, installez **Raspberry Pi Imager** (raspberrypi.com/software).
2. Choisissez votre modèle de Pi, puis **Raspberry Pi OS (64-bit)**, la version **avec bureau** (pas « Lite »).
3. Cliquez sur **Modifier les réglages** (roue dentée) :
   - nom de l'appareil : `zedeka-ecran`
   - utilisateur : `zedeka` + un mot de passe solide
   - Wi-Fi (si pas de câble) : nom du réseau, mot de passe, pays **TG**
   - fuseau horaire : **Africa/Lome**, clavier : `fr`
   - onglet Services : **activer SSH** (pour intervenir à distance plus tard)
4. Écrivez la carte, mettez-la dans le Pi, branchez écran, clavier, souris, réseau, puis l'alimentation en dernier.

## 4. Installer l'écran (une seule commande)

Au premier démarrage, ouvrez le **Terminal** (icône en haut à gauche) et tapez :

```bash
curl -fsSL -o installer-ecran.sh https://raw.githubusercontent.com/I-Rachade/ZEDEKA/HEAD/ecran-bureau/installer-ecran.sh
```

Si le dépôt est privé, copiez plutôt le fichier `installer-ecran.sh` (dossier `ecran-bureau` des fichiers du projet) sur une clé USB, puis dans le Terminal : `cp /media/zedeka/*/installer-ecran.sh ~/`.

Puis lancez-le avec **votre lien entre guillemets** :

```bash
bash installer-ecran.sh "https://zedeka.poinderecharge.com/ecran?cle=VOTRE_CLE"
sudo reboot
```

Le script :

1. installe Chromium et `unclutter` (cache la souris) ;
2. crée le lanceur `~/.local/bin/zedeka-ecran` : il attend le réseau, ouvre l'écran **en plein écran (kiosque)** et **le rouvre tout seul** s'il se ferme ;
3. le lance **au démarrage** (bureau Wayland *labwc* récent et anciens bureaux) ;
4. **désactive la mise en veille** de l'écran et ouvre la session automatiquement ;
5. redémarre le Pi **chaque nuit à 4 h** (mémoire propre, nouvelle version du site).

Après le redémarrage, l'écran Zedeka s'affiche seul. Le lien est gardé dans le Pi : plus besoin de le retaper, même après une coupure de courant.

## 5. Installation à la main (si le script ne convient pas)

```bash
sudo apt update && sudo apt install -y chromium-browser unclutter
sudo raspi-config nonint do_boot_behaviour B4   # bureau + session automatique
sudo raspi-config nonint do_blanking 1          # écran jamais éteint
```

Ajoutez cette ligne à `~/.config/labwc/autostart` (créez le fichier s'il n'existe pas) :

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required "https://zedeka.poinderecharge.com/ecran?cle=VOTRE_CLE" &
```

Sur un ancien Raspberry Pi OS (X11/LXDE), le fichier est `~/.config/lxsession/LXDE-pi/autostart`, avec en plus :

```
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 1
```

## 6. Au quotidien

| Touche (clavier branché) | Effet |
|---|---|
| ← ou → | changer d'écran |
| P | mettre la rotation en pause / la reprendre |
| F | plein écran / sortir |
| Alt + F4 | fermer (il se rouvre dans les 5 secondes) |

- **Pastille « En direct »** verte en haut à droite : tout va bien. Rouge « Connexion perdue » : le réseau est coupé, l'écran réessaie tout seul et garde les derniers chiffres.
- La journée va de minuit à minuit (heure de Lomé). À minuit, le compteur repart de zéro.
- L'objectif et les liens se gèrent dans **Admin → Écran du bureau**. La page montre aussi le « dernier signal » de chaque écran (s'il est bien allumé).

## 7. Dépannage

| Problème | Solution |
|---|---|
| « Ce lien d'écran a été révoqué » | Créez un nouveau lien dans l'admin, puis relancez `bash installer-ecran.sh "nouveau lien"` et `sudo reboot`. |
| « Écran du bureau, créez un lien… » | Le Pi n'a pas de lien gardé : même solution. |
| Écran noir après démarrage | Attendez 1 minute (le Pi attend le réseau). Sinon, vérifiez le câble réseau ou le Wi-Fi. |
| L'écran se met en veille | `sudo raspi-config` → Display Options → Screen Blanking → **No**, puis redémarrez. Réglez aussi la mise en veille du moniteur/télé sur « jamais ». |
| Pas de son | `sudo raspi-config` → System Options → Audio → HDMI. Le son demande Chromium lancé avec `--autoplay-policy=no-user-gesture-required` (le script le fait). |
| Image coupée sur les bords (télé) | Réglage de la télé : format « Écran entier » / « Just Scan » / « 1:1 ». |
| La carte est lente | Pi 4 (4 Go) ou Pi 5 conseillé. Ou bien un seul écran avec `&vue=compteur`. |
| Intervenir à distance | `ssh zedeka@zedeka-ecran.local` depuis un ordinateur du même réseau, puis `sudo reboot`. |
