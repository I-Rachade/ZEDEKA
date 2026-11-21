package com.zedeka.mdm;

import android.app.KeyguardManager;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.List;

/**
 * Ce que l'agent envoie au serveur. Liste volontairement courte (minimisation RGPD) :
 * aucune lecture de messages, photos, contacts, historique, ni du contenu des applications.
 */
final class Inventory {
    private Inventory() {}

    static String deviceName(Context c) {
        String n = null;
        try { n = Settings.Global.getString(c.getContentResolver(), Settings.Global.DEVICE_NAME); } catch (Exception ignored) {}
        return n != null && !n.trim().isEmpty() ? n.trim() : model();
    }

    static String model() {
        String m = Build.MODEL == null ? "" : Build.MODEL;
        String b = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        if (m.toLowerCase().startsWith(b.toLowerCase())) return m;
        return (b.isEmpty() ? "" : capitalize(b) + " ") + m;
    }

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    /** Identité envoyée une seule fois, à l'enrôlement. */
    static JSONObject identity(Context c, String name) throws JSONException {
        JSONObject d = new JSONObject();
        d.put("name", name == null || name.trim().isEmpty() ? deviceName(c) : name.trim());
        d.put("platform", "android");
        d.put("management", "agent");
        d.put("model", model());
        d.put("os_version", Build.VERSION.RELEASE);
        String mac = wifiMac(c);
        if (mac != null) d.put("wifi_mac", mac);
        return d;
    }

    /** État de sécurité et du matériel, envoyé à chaque synchronisation. */
    static JSONObject inventory(Context c) throws JSONException {
        JSONObject inv = new JSONObject();
        inv.put("os_version", Build.VERSION.RELEASE);
        inv.put("model", model());
        BatteryManager bm = (BatteryManager) c.getSystemService(Context.BATTERY_SERVICE);
        int battery = bm == null ? -1 : bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        if (battery >= 0 && battery <= 100) inv.put("battery", battery);
        try {
            StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
            long total = fs.getTotalBytes();
            if (total > 0) inv.put("storage_used_pct", Math.round(100.0 * (total - fs.getAvailableBytes()) / total));
        } catch (Exception ignored) {}
        inv.put("encrypted", encrypted(c));
        KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        if (km != null) inv.put("passcode_set", km.isDeviceSecure());
        inv.put("rooted", rooted());
        inv.put("supervised", Admin.isDeviceOwner(c));
        String mac = wifiMac(c);
        if (mac != null) inv.put("wifi_mac", mac);
        return inv;
    }

    static boolean encrypted(Context c) {
        int s = Admin.dpm(c).getStorageEncryptionStatus();
        return s == DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE
                || s == DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_PER_USER
                || s == DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_DEFAULT_KEY;
    }

    /** Indices classiques d'un téléphone « rooté » (contrôle de conformité, pas une preuve). */
    static boolean rooted() {
        if (Build.TAGS != null && Build.TAGS.contains("test-keys")) return true;
        String[] paths = {"/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/app/Superuser.apk",
                "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su", "/data/adb/magisk"};
        for (String p : paths) if (new File(p).exists()) return true;
        return false;
    }

    /** Adresse Wi-Fi réelle : lisible uniquement en mode propriétaire de l'appareil (sinon Android la masque). */
    static String wifiMac(Context c) {
        if (!Admin.isDeviceOwner(c)) return null;
        try {
            String mac = Admin.dpm(c).getWifiMacAddress(Admin.component(c));
            return mac == null ? null : mac.toLowerCase();
        } catch (Exception e) {
            return null;
        }
    }

    /** Applications installées par l'utilisateur (nom, identifiant, version). Les applis système sont ignorées. */
    static JSONArray apps(Context c) throws JSONException {
        PackageManager pm = c.getPackageManager();
        JSONArray out = new JSONArray();
        List<PackageInfo> list = pm.getInstalledPackages(0);
        for (PackageInfo p : list) {
            ApplicationInfo ai = p.applicationInfo;
            if (ai == null) continue;
            boolean system = (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0
                    && (ai.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0;
            if (system) continue;
            JSONObject a = new JSONObject();
            a.put("identifier", p.packageName);
            a.put("name", String.valueOf(pm.getApplicationLabel(ai)));
            if (p.versionName != null) a.put("version", p.versionName);
            out.put(a);
            if (out.length() >= 500) break;
        }
        return out;
    }

    static boolean isInstalled(Context c, String pkg) {
        try {
            c.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
