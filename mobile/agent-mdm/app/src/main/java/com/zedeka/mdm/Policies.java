package com.zedeka.mdm;

import android.app.KeyguardManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.UserManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Applique les politiques reçues au check-in (code de verrouillage, restrictions, applications obligatoires / interdites).
 * En mode propriétaire de l'appareil tout est imposé ; sinon l'agent impose ce qu'Android permet à un administrateur
 * et invite l'utilisateur à faire le reste (notification).
 */
final class Policies {
    private Policies() {}

    static JSONObject apply(Context c, JSONObject policies) {
        JSONObject report = new JSONObject();
        if (policies == null) return report;
        try {
            report.put("passcode", applyPasscode(c, policies.optJSONObject("passcode")));
            report.put("restrictions", applyRestrictions(c, policies.optJSONObject("restrictions")));
            report.put("blocked_apps", applyBlocked(c, policies.optJSONArray("blocked_apps")));
            report.put("mandatory_apps", applyMandatory(c, policies.optJSONArray("mandatory_apps")));
        } catch (JSONException ignored) {}
        return report;
    }

    // ------------------------------------------------------------------ code de verrouillage
    @SuppressWarnings("deprecation")
    static JSONObject applyPasscode(Context c, JSONObject p) throws JSONException {
        JSONObject r = new JSONObject();
        if (p == null) return r;
        DevicePolicyManager dpm = Admin.dpm(c);
        ComponentName admin = Admin.component(c);
        int minLength = p.optInt("min_length", 0);
        boolean alpha = p.optBoolean("require_alphanumeric", false);

        if (Admin.isDeviceOwner(c)) {
            try {
                dpm.setPasswordQuality(admin, alpha ? DevicePolicyManager.PASSWORD_QUALITY_ALPHANUMERIC
                        : DevicePolicyManager.PASSWORD_QUALITY_NUMERIC_COMPLEX);
                if (minLength > 0) dpm.setPasswordMinimumLength(admin, minLength);
                dpm.setPasswordHistoryLength(admin, p.optInt("history", 0));
                dpm.setPasswordExpirationTimeout(admin, p.optInt("max_age_days", 0) * 86_400_000L);
                dpm.setKeyguardDisabledFeatures(admin, p.optBoolean("biometrics_allowed", true) ? 0
                        : DevicePolicyManager.KEYGUARD_DISABLE_FINGERPRINT | DevicePolicyManager.KEYGUARD_DISABLE_FACE
                        | DevicePolicyManager.KEYGUARD_DISABLE_IRIS);
                r.put("imposé", true);
            } catch (Exception e) {
                r.put("erreur", e.getMessage());
            }
        }
        if (Admin.isAdmin(c)) {
            // Autorisé aussi à un simple administrateur : effacement après N échecs, verrouillage automatique.
            try { dpm.setMaximumFailedPasswordsForWipe(admin, p.optInt("max_failed_attempts", 0)); } catch (Exception ignored) {}
            try {
                int minutes = p.optInt("auto_lock_minutes", 0);
                dpm.setMaximumTimeToLock(admin, minutes > 0 ? minutes * 60_000L : 0);
            } catch (Exception ignored) {}
        }

        boolean ok = passcodeCompliant(c, minLength, alpha);
        r.put("conforme", ok);
        if (ok) {
            Notifier.cancel(c, Notifier.ID_PASSCODE);
        } else {
            Intent set = new Intent(DevicePolicyManager.ACTION_SET_NEW_PASSWORD);
            if (Build.VERSION.SDK_INT >= 29) set.putExtra(DevicePolicyManager.EXTRA_PASSWORD_COMPLEXITY, requiredComplexity(minLength, alpha));
            Notifier.show(c, Notifier.ID_PASSCODE, Notifier.CH_ACTION, "Code de verrouillage à renforcer",
                    "Votre entreprise demande un code d'au moins " + Math.max(minLength, 4) + (alpha ? " caractères avec lettres et chiffres." : " chiffres.")
                            + " Touchez pour le définir.", Notifier.activity(c, set, 2));
        }
        return r;
    }

    static int requiredComplexity(int minLength, boolean alpha) {
        // HIGH : code d'au moins 8 chiffres ou mot de passe de 6 caractères ; MEDIUM : 4 chiffres non répétitifs.
        return (alpha || minLength >= 8) ? DevicePolicyManager.PASSWORD_COMPLEXITY_HIGH : DevicePolicyManager.PASSWORD_COMPLEXITY_MEDIUM;
    }

    @SuppressWarnings("deprecation")
    static boolean passcodeCompliant(Context c, int minLength, boolean alpha) {
        KeyguardManager km = c.getSystemService(KeyguardManager.class);
        if (km == null || !km.isDeviceSecure()) return false;
        DevicePolicyManager dpm = Admin.dpm(c);
        if (Admin.isDeviceOwner(c)) {
            try { return dpm.isActivePasswordSufficient(); } catch (Exception ignored) {}
        }
        if (Build.VERSION.SDK_INT >= 29) {
            try { return dpm.getPasswordComplexity() >= requiredComplexity(minLength, alpha); } catch (Exception ignored) {}
        }
        return true; // Android 8-9 sans mode propriétaire : on ne peut vérifier que la présence d'un code
    }

    // ------------------------------------------------------------------ restrictions (mode propriétaire seulement)
    static JSONObject applyRestrictions(Context c, JSONObject r) throws JSONException {
        JSONObject out = new JSONObject();
        if (r == null) return out;
        if (!Admin.isDeviceOwner(c)) {
            out.put("imposé", false);
            out.put("raison", "Restrictions applicables seulement sur un téléphone d'entreprise provisionné");
            return out;
        }
        DevicePolicyManager dpm = Admin.dpm(c);
        ComponentName admin = Admin.component(c);
        try {
            dpm.setCameraDisabled(admin, !r.optBoolean("camera", true));
            dpm.setScreenCaptureDisabled(admin, !r.optBoolean("screen_capture", true));
            restrict(dpm, admin, UserManager.DISALLOW_USB_FILE_TRANSFER, !r.optBoolean("usb_file_transfer", true));
            restrict(dpm, admin, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES, !r.optBoolean("unknown_sources", true));
            if (Build.VERSION.SDK_INT >= 26) restrict(dpm, admin, UserManager.DISALLOW_BLUETOOTH, !r.optBoolean("bluetooth", true));
            out.put("imposé", true);
        } catch (Exception e) {
            out.put("erreur", e.getMessage());
        }
        return out;
    }

    private static void restrict(DevicePolicyManager dpm, ComponentName admin, String key, boolean on) {
        if (on) dpm.addUserRestriction(admin, key);
        else dpm.clearUserRestriction(admin, key);
    }

    // ------------------------------------------------------------------ applications interdites
    static JSONObject applyBlocked(Context c, JSONArray blocked) throws JSONException {
        JSONObject out = new JSONObject();
        Set<String> wanted = new HashSet<>();
        if (blocked != null) for (int i = 0; i < blocked.length(); i++) wanted.add(blocked.optString(i));
        JSONArray found = new JSONArray();
        Set<String> hidden = new HashSet<>(Prefs.sp(c).getStringSet("hidden_apps", new HashSet<>()));

        if (Admin.isDeviceOwner(c)) {
            DevicePolicyManager dpm = Admin.dpm(c);
            ComponentName admin = Admin.component(c);
            for (String pkg : wanted) {
                if (pkg.isEmpty() || pkg.equals(c.getPackageName())) continue;
                try {
                    if (Inventory.isInstalled(c, pkg) && dpm.setApplicationHidden(admin, pkg, true)) {
                        hidden.add(pkg);
                        found.put(pkg);
                    }
                } catch (Exception ignored) {}
            }
            // Applications qui ne sont plus interdites : on les rend à nouveau visibles
            for (String pkg : new HashSet<>(hidden)) {
                if (wanted.contains(pkg)) continue;
                try { dpm.setApplicationHidden(admin, pkg, false); } catch (Exception ignored) {}
                hidden.remove(pkg);
            }
            Prefs.sp(c).edit().putStringSet("hidden_apps", hidden).apply();
            out.put("masquées", found);
            return out;
        }

        for (String pkg : wanted) {
            if (!pkg.isEmpty() && Inventory.isInstalled(c, pkg)) {
                found.put(pkg);
                Intent del = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
                Notifier.show(c, ("blocked:" + pkg).hashCode(), Notifier.CH_ACTION, "Application interdite par votre entreprise",
                        appLabel(c, pkg) + " n'est pas autorisée sur ce téléphone. Touchez pour la désinstaller.",
                        Notifier.activity(c, del, ("del:" + pkg).hashCode()));
            }
        }
        out.put("signalées", found);
        return out;
    }

    // ------------------------------------------------------------------ applications obligatoires
    static JSONObject applyMandatory(Context c, JSONArray mandatory) throws JSONException {
        JSONObject out = new JSONObject();
        JSONArray missing = new JSONArray();
        if (mandatory == null) return out;
        for (int i = 0; i < mandatory.length(); i++) {
            JSONObject a = mandatory.optJSONObject(i);
            if (a == null) continue;
            String pkg = a.optString("identifier");
            if (pkg.isEmpty() || Inventory.isInstalled(c, pkg)) continue;
            missing.put(pkg);
            Installer.offerOrInstall(c, pkg, a.optString("name", pkg), a.optString("download_url", ""));
        }
        out.put("manquantes", missing);
        return out;
    }

    static String appLabel(Context c, String pkg) {
        try {
            return String.valueOf(c.getPackageManager().getApplicationLabel(c.getPackageManager().getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return pkg;
        }
    }
}
