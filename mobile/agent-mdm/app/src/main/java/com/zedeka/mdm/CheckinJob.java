package com.zedeka.mdm;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.util.Log;

/** Tâche de fond : une synchronisation complète (inventaire, commandes, politiques). */
public class CheckinJob extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                Agent.checkin(getApplicationContext());
                AgentService.start(getApplicationContext()); // relancé s'il a été arrêté par le système
            } catch (Exception e) {
                Log.w("AgentMDM", "Synchronisation impossible : " + e.getMessage());
            }
            jobFinished(params, false);
        }, "checkin").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
