package com.zedeka.mdm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/** Retour du système après une installation / désinstallation lancée par l'agent. */
public class InstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Hors mode propriétaire : Android demande la confirmation de l'utilisateur.
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                Notifier.show(c, Notifier.newId(), Notifier.CH_ACTION, "Installation demandée par votre entreprise",
                        "Touchez pour confirmer.", Notifier.activity(c, confirm, Notifier.newId()));
            }
            return;
        }
        Log.i("AgentMDM", "Paquet " + intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME) + " : statut " + status
                + " " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        Scheduler.once(c, 5);
    }
}
