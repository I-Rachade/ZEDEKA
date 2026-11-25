package com.zedeka.mdm;

import android.content.Context;
import android.os.UserManager;

/**
 * Empêche de retirer l'agent sans le code de l'administrateur.
 *  - Téléphone d'entreprise (propriétaire de l'appareil) : désinstallation bloquée par Android, réinitialisation
 *    d'usine et démarrage sans échec interdits. Seul le code de déblocage (ou un effacement depuis la console) libère le téléphone.
 *  - Administrateur de l'appareil : Android interdit de désinstaller l'agent tant que l'administration est active,
 *    mais laisse toujours l'utilisateur la désactiver dans les réglages. L'agent verrouille alors l'écran et alerte
 *    aussitôt la console (alerte critique « protection désactivée »).
 */
final class Protection {
    private Protection() {}

    static void apply(Context c) {
        if (!Admin.isDeviceOwner(c)) return;
        try {
            Admin.dpm(c).setUninstallBlocked(Admin.component(c), c.getPackageName(), true);
            Admin.dpm(c).addUserRestriction(Admin.component(c), UserManager.DISALLOW_FACTORY_RESET);
            Admin.dpm(c).addUserRestriction(Admin.component(c), UserManager.DISALLOW_SAFE_BOOT);
        } catch (Exception ignored) {}
    }

    /** Après un code de déblocage valide : on rend la main à l'utilisateur. */
    @SuppressWarnings("deprecation")
    static void release(Context c) {
        if (!Admin.isDeviceOwner(c)) return;
        try {
            Admin.dpm(c).setUninstallBlocked(Admin.component(c), c.getPackageName(), false);
            Admin.dpm(c).clearUserRestriction(Admin.component(c), UserManager.DISALLOW_FACTORY_RESET);
            Admin.dpm(c).clearUserRestriction(Admin.component(c), UserManager.DISALLOW_SAFE_BOOT);
            Admin.dpm(c).clearDeviceOwnerApp(c.getPackageName());
        } catch (Exception ignored) {}
    }
}
