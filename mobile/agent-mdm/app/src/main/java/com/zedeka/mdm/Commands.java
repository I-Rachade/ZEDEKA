package com.zedeka.mdm;

import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

/** Exécution des commandes envoyées depuis la console (une par une, résultat renvoyé au serveur). */
final class Commands {
    private Commands() {}

    static final class Outcome {
        boolean ok = true;
        final JSONObject result = new JSONObject();
        JSONObject location;
        /** Action lancée APRÈS l'envoi du résultat (effacement, redémarrage). */
        Runnable after;

        static Outcome fail(String why) {
            Outcome o = new Outcome();
            o.ok = false;
            put(o, "erreur", why);
            return o;
        }

        Outcome with(String key, Object value) { put(this, key, value); return this; }

        private static void put(Outcome o, String k, Object v) {
            try { o.result.put(k, v); } catch (JSONException ignored) {}
        }
    }

    static Outcome execute(Context c, String type, JSONObject p, JSONObject policies) {
        DevicePolicyManager dpm = Admin.dpm(c);
        boolean owner = Admin.isDeviceOwner(c);
        boolean admin = Admin.isAdmin(c);
        switch (type) {
            case "locate": {
                JSONObject loc = Locator.current(c, 30_000);
                if (loc == null) {
                    return Outcome.fail(Locator.permitted(c)
                            ? "Position indisponible (localisation désactivée ou autorisation « toujours » refusée)"
                            : "L'utilisateur n'a pas autorisé la localisation");
                }
                Outcome o = new Outcome().with("localisé", true);
                o.location = loc;
                Notifier.show(c, Notifier.ID_INFO, Notifier.CH_INFO, "Position envoyée à votre entreprise",
                        "Votre entreprise a demandé la position de ce téléphone. La demande est inscrite à son journal d'audit.", null);
                return o;
            }
            case "ring":
                ring(c, 30);
                return new Outcome().with("sonnerie", "30 s");
            case "lock":
                if (!admin) return Outcome.fail("Administration de l'appareil non activée par l'utilisateur");
                dpm.lockNow();
                return new Outcome().with("verrouillé", true);
            case "lost_mode_on": {
                LostMode.on(c, p.optString("message", ""), p.optString("phone", ""));
                Outcome o = new Outcome().with("mode_perdu", true).with("verrouillé", admin);
                o.location = Locator.current(c, 30_000);
                return o;
            }
            case "lost_mode_off":
                LostMode.off(c);
                return new Outcome().with("mode_perdu", false);
            case "reset_passcode":
                return resetPasscode(c, p);
            case "restart":
                if (!owner) return Outcome.fail("Redémarrage à distance réservé aux téléphones d'entreprise provisionnés");
                Outcome r = new Outcome().with("redémarrage", true);
                r.after = () -> dpm.reboot(Admin.component(c));
                return r;
            case "sync_policy":
                return new Outcome().with("politiques", Policies.apply(c, policies));
            case "install_app": {
                String pkg = p.optString("identifier");
                if (pkg.isEmpty()) return Outcome.fail("Identifiant d'application manquant");
                if (Inventory.isInstalled(c, pkg)) return new Outcome().with("installation", "déjà installée");
                return new Outcome().with("installation", Installer.offerOrInstall(c, pkg, p.optString("name", pkg), p.optString("download_url", "")));
            }
            case "remove_app": {
                String pkg = p.optString("identifier");
                if (pkg.isEmpty()) return Outcome.fail("Identifiant d'application manquant");
                if (pkg.equals(c.getPackageName())) return Outcome.fail("L'agent ne peut pas se désinstaller lui-même");
                return new Outcome().with("désinstallation", Installer.uninstall(c, pkg));
            }
            case "wipe_corporate": {
                Outcome o = new Outcome().with("effacé", "données de l'entreprise (agent, jeton, politiques) et administration retirées");
                o.after = () -> Agent.forget(c, "Effacement des données de l'entreprise demandé par l'administrateur");
                return o;
            }
            case "wipe_full": {
                if ("personnel".equals(Prefs.ownership(c)))
                    return Outcome.fail("Effacement complet refusé : téléphone personnel (seules les données de l'entreprise peuvent être effacées)");
                if (!admin) return Outcome.fail("Administration de l'appareil non activée par l'utilisateur");
                Outcome o = new Outcome().with("effacement", "lancé");
                o.after = () -> wipe(c);
                return o;
            }
            default:
                return Outcome.fail("Commande non prise en charge par l'agent Android : " + type);
        }
    }

    @SuppressWarnings("deprecation")
    private static void wipe(Context c) {
        DevicePolicyManager dpm = Admin.dpm(c);
        try {
            if (Build.VERSION.SDK_INT >= 34) dpm.wipeDevice(0);
            else dpm.wipeData(0);
        } catch (Exception e) {
            try { dpm.wipeData(0); } catch (Exception ignored) {}
        }
    }

    private static Outcome resetPasscode(Context c, JSONObject p) {
        String code = p.optString("new_passcode", "");
        String token = Prefs.sp(c).getString("reset_token", null);
        if (Admin.isDeviceOwner(c) && token != null && !code.isEmpty()) {
            try {
                boolean done = Admin.dpm(c).resetPasswordWithToken(Admin.component(c), code, Base64.decode(token, Base64.NO_WRAP), 0);
                if (done) return new Outcome().with("code", "réinitialisé");
            } catch (Exception e) {
                return Outcome.fail("Réinitialisation refusée par Android : " + e.getMessage());
            }
        }
        // Sinon : Android interdit à une appli de changer le code. On invite l'utilisateur à le faire.
        Notifier.show(c, Notifier.ID_PASSCODE, Notifier.CH_ACTION, "Changez votre code de verrouillage",
                "Votre entreprise vous demande de définir un nouveau code. Touchez pour le faire.",
                Notifier.activity(c, new Intent(DevicePolicyManager.ACTION_SET_NEW_PASSWORD), 3));
        return Outcome.fail(Admin.isDeviceOwner(c) && code.isEmpty() ? "Nouveau code non fourni ; l'utilisateur a été invité à le changer"
                : "Réinitialisation à distance réservée aux téléphones d'entreprise ; l'utilisateur a été invité à changer son code");
    }

    /** Fait sonner le téléphone à plein volume (même en silencieux si Android le permet). */
    static void ring(Context c, int seconds) {
        AudioManager am = c.getSystemService(AudioManager.class);
        int previous = -1;
        try {
            if (am != null) {
                previous = am.getStreamVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            }
        } catch (Exception ignored) {}
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        Ringtone tone = RingtoneManager.getRingtone(c, uri);
        Notifier.show(c, Notifier.ID_RING, Notifier.CH_ACTION, "Votre téléphone sonne",
                "Sonnerie déclenchée à distance pour retrouver l'appareil.", null);
        if (tone != null) {
            tone.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            if (Build.VERSION.SDK_INT >= 28) tone.setLooping(true);
            tone.play();
            try { Thread.sleep(seconds * 1000L); } catch (InterruptedException ignored) {}
            tone.stop();
        }
        try {
            if (am != null && previous >= 0) am.setStreamVolume(AudioManager.STREAM_ALARM, previous, 0);
        } catch (Exception ignored) {}
        Notifier.cancel(c, Notifier.ID_RING);
    }
}
