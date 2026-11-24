package com.zedeka.mdm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Service permanent (notification discrète « Agent MDM actif ») : interroge le serveur chaque minute
 * pour savoir s'il y a des commandes en attente, et synchronise aussitôt si c'est le cas.
 * Sans lui, Android ne réveille l'agent que toutes les 15 minutes (souvent plus sur Xiaomi, Oppo, Samsung…).
 */
public class AgentService extends Service {
    static final String CH_SERVICE = "service";
    private static final int ID_SERVICE = 1;
    private static final long PING_SECONDS = 60;

    private ScheduledExecutorService loop;
    private int lastPing = 0;

    static void start(Context c) {
        if (!Prefs.isEnrolled(c)) return;
        try {
            c.startForegroundService(new Intent(c, AgentService.class));
        } catch (Exception e) {
            // Android refuse parfois de démarrer un service depuis l'arrière-plan : la tâche planifiée prend le relais.
            Log.w("AgentMDM", "Service non démarré : " + e.getMessage());
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, AgentService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CH_SERVICE, "Agent actif", NotificationManager.IMPORTANCE_MIN);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
        Notification n = new Notification.Builder(this, CH_SERVICE)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle("Agent MDM actif")
                .setContentText("Téléphone protégé par votre entreprise")
                .setOngoing(true)
                .setContentIntent(Notifier.openApp(this))
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID_SERVICE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(ID_SERVICE, n);
        } catch (Exception e) {
            Log.w("AgentMDM", "Premier plan refusé : " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Prefs.isEnrolled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (loop == null) {
            loop = Executors.newSingleThreadScheduledExecutor();
            loop.scheduleWithFixedDelay(this::tick, 2, PING_SECONDS, TimeUnit.SECONDS);
        }
        return START_STICKY;
    }

    private void tick() {
        Context c = getApplicationContext();
        if (!Prefs.isEnrolled(c)) {
            stopSelf();
            return;
        }
        try {
            JSONObject r = Api.post(Prefs.server(c), "/agent/ping", new JSONObject(), Prefs.token(c));
            boolean lost = r.optBoolean("lost_mode", false);
            long last = Prefs.sp(c).getLong("last_checkin", 0);
            boolean due = System.currentTimeMillis() - last > Prefs.interval(c) * 1000L;
            if (r.optInt("pending", 0) > 0 || lost != Prefs.lostMode(c) || due || (lost && ++lastPing % 2 == 0)) {
                Agent.checkin(c);
            }
        } catch (Api.ApiException e) {
            if (e.code == 401) {
                try { Agent.checkin(c); } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            Log.w("AgentMDM", "Sonde : " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        if (loop != null) loop.shutdownNow();
        loop = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
