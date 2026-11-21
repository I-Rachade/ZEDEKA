package com.zedeka.mdm;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;

/**
 * Niveau de contrôle dont dispose l'agent sur ce téléphone :
 *  - propriétaire de l'appareil (Device Owner) : téléphone d'entreprise provisionné par QR code après réinitialisation,
 *    contrôle complet (installation silencieuse, restrictions, redémarrage, mode perdu bloquant) ;
 *  - administrateur : activé par l'utilisateur, verrouillage et effacement à distance ;
 *  - limité : inventaire et localisation seulement.
 */
final class Admin {
    private Admin() {}

    static DevicePolicyManager dpm(Context c) {
        return (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    static ComponentName component(Context c) { return new ComponentName(c, AdminReceiver.class); }

    static boolean isAdmin(Context c) { return dpm(c).isAdminActive(component(c)); }

    static boolean isDeviceOwner(Context c) { return dpm(c).isDeviceOwnerApp(c.getPackageName()); }

    static String level(Context c) {
        if (isDeviceOwner(c)) return "Contrôle complet (téléphone d'entreprise)";
        if (isAdmin(c)) return "Administrateur de l'appareil";
        return "Limité (administration non activée)";
    }
}
