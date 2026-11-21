package com.zedeka.mdm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/** Notifications de l'agent : l'utilisateur voit toujours ce que l'entreprise fait sur son téléphone. */
final class Notifier {
    static final String CH_INFO = "info";
    static final String CH_ACTION = "action";
    static final String CH_LOST = "lost";

    static final int ID_LOST = 10;
    static final int ID_RING = 11;
    static final int ID_PASSCODE = 12;
    static final int ID_PROVISIONED = 13;
    static final int ID_INFO = 14;
    private static int nextId = 100;

    private Notifier() {}

    static void createChannels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CH_INFO, "Informations de gestion", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(CH_ACTION, "Actions demandées", NotificationManager.IMPORTANCE_HIGH));
        NotificationChannel lost = new NotificationChannel(CH_LOST, "Appareil perdu", NotificationManager.IMPORTANCE_HIGH);
        lost.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(lost);
    }

    static PendingIntent activity(Context c, Intent i, int req) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static PendingIntent openApp(Context c) {
        return activity(c, new Intent(c, MainActivity.class), 0);
    }

    static void show(Context c, int id, String channel, String title, String text, PendingIntent tap) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        Notification.Builder b = new Notification.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(tap != null ? tap : openApp(c));
        try { nm.notify(id, b.build()); } catch (SecurityException ignored) {}
    }

    static int newId() { return nextId++; }

    static void showLost(Context c, String message) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        PendingIntent pi = activity(c, new Intent(c, LostModeActivity.class), 1);
        Notification n = new Notification.Builder(c, CH_LOST)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle("Appareil déclaré perdu")
                .setContentText(message)
                .setStyle(new Notification.BigTextStyle().bigText(message))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .build();
        try { nm.notify(ID_LOST, n); } catch (SecurityException ignored) {}
    }

    static void cancel(Context c, int id) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(id);
    }

    static void cancelAll(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancelAll();
    }
}
