package com.zedeka.mdm;

import android.content.Context;
import android.content.Intent;

/** Mode perdu : verrouillage, message à l'écran, position remontée plus souvent. */
final class LostMode {
    static final String DEFAULT_MESSAGE = "Ce téléphone a été déclaré perdu. Merci de contacter l'entreprise pour le rendre.";

    private LostMode() {}

    static void on(Context c, String message, String phone) {
        boolean already = Prefs.lostMode(c);
        Prefs.sp(c).edit()
                .putBoolean("lost_mode", true)
                .putString("lost_message", message == null || message.isEmpty() ? Prefs.sp(c).getString("lost_message", DEFAULT_MESSAGE) : message)
                .putString("lost_phone", phone == null ? Prefs.sp(c).getString("lost_phone", "") : phone)
                .apply();
        String msg = Prefs.sp(c).getString("lost_message", DEFAULT_MESSAGE);
        if (Admin.isDeviceOwner(c)) {
            try {
                Admin.dpm(c).setDeviceOwnerLockScreenInfo(Admin.component(c), msg);
                Admin.dpm(c).setLockTaskPackages(Admin.component(c), new String[]{c.getPackageName()});
            } catch (Exception ignored) {}
        }
        Notifier.showLost(c, msg);
        if (!already) {
            showScreen(c);
            if (Admin.isAdmin(c)) {
                try { Admin.dpm(c).lockNow(); } catch (Exception ignored) {}
            }
        }
    }

    static void off(Context c) {
        Prefs.sp(c).edit().putBoolean("lost_mode", false).remove("lost_message").remove("lost_phone").apply();
        if (Admin.isDeviceOwner(c)) {
            try {
                Admin.dpm(c).setDeviceOwnerLockScreenInfo(Admin.component(c), null);
                Admin.dpm(c).setLockTaskPackages(Admin.component(c), new String[0]);
            } catch (Exception ignored) {}
        }
        Notifier.cancel(c, Notifier.ID_LOST);
        c.sendBroadcast(new Intent(LostModeActivity.ACTION_CLOSE).setPackage(c.getPackageName()));
    }

    static void showScreen(Context c) {
        try {
            c.startActivity(new Intent(c, LostModeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) {
            // Android limite l'ouverture d'écrans depuis l'arrière-plan : la notification plein écran prend le relais.
        }
    }
}
