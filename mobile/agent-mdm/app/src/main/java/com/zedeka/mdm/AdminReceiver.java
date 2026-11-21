package com.zedeka.mdm;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

/** Récepteur d'administration de l'appareil (activation par l'utilisateur ou provisionnement d'entreprise). */
public class AdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context c, Intent intent) {
        if (Prefs.isEnrolled(c)) Scheduler.once(c, 0);
    }

    @Override
    public CharSequence onDisableRequested(Context c, Intent intent) {
        return "Sans l'administration, votre entreprise ne pourra plus verrouiller ni effacer ce téléphone s'il est perdu. "
                + "L'appareil sera signalé comme non protégé.";
    }

    @Override
    public void onDisabled(Context c, Intent intent) {
        if (Prefs.isEnrolled(c)) Scheduler.once(c, 0);
    }

    /** Provisionnement « propriétaire de l'appareil » terminé (anciennes versions d'Android). */
    @Override
    public void onProfileProvisioningComplete(Context c, Intent intent) {
        Provisioning.onProvisioned(c, intent.getParcelableExtra(android.app.admin.DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE));
    }
}
