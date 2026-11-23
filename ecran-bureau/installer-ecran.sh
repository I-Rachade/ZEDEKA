#!/bin/bash
# Écran du bureau Zedeka : configure un Raspberry Pi (Raspberry Pi OS Bookworm, avec bureau) en mode kiosque.
# Usage, sur le Pi :   bash installer-ecran.sh
# Au redémarrage, l'écran affiche un code à 6 chiffres : tapez-le dans l'admin Zedeka > Écran du bureau > Brancher.
# Facultatif : une autre adresse, ou des réglages (ex. bash installer-ecran.sh "https://zedeka.poinderecharge.com/ecran?vue=compteur").
set -euo pipefail

URL="${1:-https://zedeka.poinderecharge.com/ecran}"
if [[ "$URL" != https://*"/ecran"* ]]; then
  echo "Adresse inattendue : elle doit finir par /ecran (ex. https://zedeka.poinderecharge.com/ecran)" >&2
  exit 1
fi

echo "1/5 Paquets (Chromium, unclutter pour cacher la souris)…"
sudo apt-get update -y
sudo apt-get install -y chromium-browser unclutter || sudo apt-get install -y chromium unclutter
BROWSER="$(command -v chromium-browser || command -v chromium)"

echo "2/5 Script de lancement…"
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/zedeka-ecran" <<SCRIPT
#!/bin/bash
# Attend le réseau, puis ouvre l'écran en plein écran. Relancé tout seul s'il se ferme.
URL="$URL"
for i in \$(seq 1 60); do
  curl -s --max-time 3 -o /dev/null https://zedeka.poinderecharge.com && break
  sleep 2
done
# Pas de mise en veille de l'écran (X11).
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null
# Souris cachée (X11 ; sous Wayland, la page la cache elle-même).
command -v unclutter >/dev/null && (unclutter -idle 1 &)
# Chromium croit avoir planté après une coupure de courant : on efface ce drapeau.
PREFS="\$HOME/.config/chromium/Default/Preferences"
[ -f "\$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "\$PREFS"
while true; do
  $BROWSER --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \\
    --disable-features=Translate --check-for-update-interval=31536000 \\
    --autoplay-policy=no-user-gesture-required --password-store=basic \\
    --overscroll-history-navigation=0 --start-fullscreen "\$URL"
  sleep 5
done
SCRIPT
chmod +x "$HOME/.local/bin/zedeka-ecran"

echo "3/5 Démarrage automatique…"
# Bureau Wayland (labwc, Raspberry Pi OS Bookworm récent).
mkdir -p "$HOME/.config/labwc"
touch "$HOME/.config/labwc/autostart"
grep -q zedeka-ecran "$HOME/.config/labwc/autostart" || echo "$HOME/.local/bin/zedeka-ecran &" >> "$HOME/.config/labwc/autostart"
# Bureau Wayland (wayfire) ou X11 (LXDE) : entrée d'autostart classique, ignorée par labwc.
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/zedeka-ecran.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Écran Zedeka
Exec=$HOME/.local/bin/zedeka-ecran
X-GNOME-Autostart-enabled=true
DESK

echo "4/5 Pas de mise en veille…"
# Ouverture de session automatique et écran jamais éteint (raspi-config, si présent).
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B4 || true   # bureau, session ouverte automatiquement
  sudo raspi-config nonint do_blanking 1 || true          # 1 = pas d'extinction de l'écran
fi

echo "5/5 Redémarrage chaque nuit à 4 h (mémoire propre, mises à jour du site)…"
( sudo crontab -l 2>/dev/null | grep -v zedeka-reboot; echo "0 4 * * * /sbin/shutdown -r now # zedeka-reboot" ) | sudo crontab -

echo
echo "Terminé. Redémarrez le Pi : sudo reboot"
echo "L'écran Zedeka s'ouvrira tout seul en plein écran. La première fois, il affiche un code à 6 chiffres :"
echo "tapez-le dans l'admin Zedeka > Écran du bureau > Brancher. Ensuite, il ne demande plus rien."
