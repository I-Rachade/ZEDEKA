package com.zedeka.mdm;

import android.app.Application;

/** Démarrage de l'application : canaux de notification et synchronisation planifiée. */
public class AgentApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        Notifier.createChannels(this);
        if (Prefs.isEnrolled(this)) Scheduler.schedule(this, Prefs.interval(this));
    }
}
