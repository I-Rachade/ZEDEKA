package com.zedeka.mdm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Après un redémarrage ou une mise à jour de l'agent : reprise de la synchronisation et du mode perdu. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (!Prefs.isEnrolled(c)) return;
        Scheduler.schedule(c, Prefs.interval(c));
        Scheduler.once(c, 0);
        AgentService.start(c);
        if (Prefs.lostMode(c)) LostMode.showScreen(c);
    }
}
