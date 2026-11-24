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

    /**
     * Android laisse toujours l'utilisateur désactiver l'administration : on verrouille l'écran (il faut le code du
     * téléphone pour continuer) et on prévient que l'entreprise sera alertée. Pour quitter proprement : code de déblocage.
     */
    @Override
    public CharSequence onDisableRequested(Context c, Intent intent) {
        if (Prefs.isEnrolled(c)) {
            try { Admin.dpm(c).lockNow(); } catch (Exception ignored) {}
            Notifier.show(c, Notifier.ID_INFO, Notifier.CH_ACTION, "Protection de l'entreprise",
                    "Pour retirer l'agent MDM, ouvrez l'application et saisissez le code de déblocage donné par votre administrateur.", null);
        }
        return "Ce téléphone est géré par votre entreprise. Pour retirer l'agent MDM, utilisez « Quitter la gestion » dans "
                + "l'application avec le code de déblocage de votre administrateur. Si vous désactivez la protection ici, "
                + "votre administrateur est alerté immédiatement et le téléphone est signalé comme non protégé.";
    }

    /** Protection désactivée sans code : la console est prévenue tout de suite (alerte critique). */
    @Override
    public void onDisabled(Context c, Intent intent) {
        if (!Prefs.isEnrolled(c)) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try { Agent.checkin(c.getApplicationContext()); } catch (Exception e) { Scheduler.once(c, 0); }
            pending.finish();
        }, "admin-disabled").start();
    }

    /** Provisionnement « propriétaire de l'appareil » terminé (anciennes versions d'Android). */
    @Override
    public void onProfileProvisioningComplete(Context c, Intent intent) {
        Provisioning.onProvisioned(c, intent.getParcelableExtra(android.app.admin.DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE));
    }
}
