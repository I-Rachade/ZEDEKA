package com.zedeka.mdm;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

/**
 * Synchronisation avec le serveur : toutes les 15 minutes au minimum (limite d'Android), plus vite en mode perdu.
 * Les commandes de la console arrivent donc au plus tard à la synchronisation suivante.
 */
final class Scheduler {
    private static final int JOB_PERIODIC = 1;
    private static final int JOB_ONCE = 2;

    private Scheduler() {}

    private static JobScheduler js(Context c) { return c.getSystemService(JobScheduler.class); }

    static void schedule(Context c, int intervalSeconds) {
        long ms = Math.max(15 * 60, intervalSeconds) * 1000L;
        JobInfo job = new JobInfo.Builder(JOB_PERIODIC, new ComponentName(c, CheckinJob.class))
                .setPeriodic(ms)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
        JobInfo existing = js(c).getPendingJob(JOB_PERIODIC);
        if (existing == null || existing.getIntervalMillis() != ms) js(c).schedule(job);
    }

    /** Synchronisation ponctuelle dans `delaySeconds` (0 = dès que le réseau est disponible). */
    static void once(Context c, int delaySeconds) {
        JobInfo.Builder b = new JobInfo.Builder(JOB_ONCE, new ComponentName(c, CheckinJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true);
        if (delaySeconds > 0) b.setMinimumLatency(delaySeconds * 1000L);
        js(c).schedule(b.build());
    }

    static void cancel(Context c) {
        js(c).cancel(JOB_PERIODIC);
        js(c).cancel(JOB_ONCE);
    }
}
