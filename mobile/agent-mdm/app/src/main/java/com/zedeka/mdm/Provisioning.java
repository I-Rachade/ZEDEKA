package com.zedeka.mdm;

import android.content.Context;
import android.os.PersistableBundle;

import java.security.SecureRandom;

/**
 * Téléphone d'entreprise provisionné par QR code (écran d'accueil d'un téléphone réinitialisé, 6 touches) :
 * le QR contient l'adresse du serveur et un jeton d'enrôlement dans PROVISIONING_ADMIN_EXTRAS_BUNDLE
 * ({"server": "...", "enrollment_token": "..."}). L'agent devient propriétaire de l'appareil et s'enrôle seul.
 */
final class Provisioning {
    private Provisioning() {}

    static void onProvisioned(Context c, PersistableBundle extras) {
        if (extras != null) {
            String server = extras.getString("server");
            String token = extras.getString("enrollment_token");
            if (token != null && !token.isEmpty()) {
                Prefs.sp(c).edit()
                        .putString("pending_server", server != null && server.startsWith("https://") ? server : Prefs.DEFAULT_SERVER)
                        .putString("pending_token", token)
                        .apply();
            }
        }
        prepareResetToken(c);
        Notifier.show(c, Notifier.ID_PROVISIONED, Notifier.CH_INFO, "Téléphone géré par votre entreprise",
                "Ouvrez Agent MDM pour voir ce qui est géré et les données collectées.", null);
        Scheduler.once(c, 0);
    }

    /** Jeton qui permet plus tard de réinitialiser le code de verrouillage à la demande de l'administrateur. */
    static void prepareResetToken(Context c) {
        if (!Admin.isDeviceOwner(c)) return;
        try {
            if (Admin.dpm(c).isResetPasswordTokenActive(Admin.component(c))) return;
            byte[] token = new byte[32];
            new SecureRandom().nextBytes(token);
            if (Admin.dpm(c).setResetPasswordToken(Admin.component(c), token)) {
                Prefs.sp(c).edit().putString("reset_token", android.util.Base64.encodeToString(token, android.util.Base64.NO_WRAP)).apply();
            }
        } catch (Exception ignored) {}
    }
}
