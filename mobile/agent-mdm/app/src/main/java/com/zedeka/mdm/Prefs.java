package com.zedeka.mdm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/** État local de l'agent (stockage privé de l'application, exclu des sauvegardes). */
final class Prefs {
    static final String DEFAULT_SERVER = "https://zedeka-mdm.poinderecharge.com";

    private Prefs() {}

    static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences("agent", Context.MODE_PRIVATE);
    }

    static boolean isEnrolled(Context c) { return sp(c).getString("device_token", null) != null; }
    static String server(Context c) { return sp(c).getString("server", DEFAULT_SERVER); }
    static String token(Context c) { return sp(c).getString("device_token", null); }
    static String deviceId(Context c) { return sp(c).getString("device_id", null); }
    static int interval(Context c) { return sp(c).getInt("interval", 900); }
    static boolean consent(Context c) { return sp(c).getLong("consent_at", 0) > 0; }
    static boolean lostMode(Context c) { return sp(c).getBoolean("lost_mode", false); }
    static boolean reportLocation(Context c) { return sp(c).getBoolean("report_location", false); }
    static String ownership(Context c) { return sp(c).getString("ownership", ""); }

    static JSONObject json(Context c, String key) {
        String s = sp(c).getString(key, null);
        if (s == null) return new JSONObject();
        try { return new JSONObject(s); } catch (JSONException e) { return new JSONObject(); }
    }

    static void putJson(Context c, String key, JSONObject value) {
        sp(c).edit().putString(key, value == null ? null : value.toString()).apply();
    }

    static void clearEnrollment(Context c) {
        // On garde le consentement et le serveur, on oublie tout le reste (jeton, politiques, état).
        SharedPreferences p = sp(c);
        long consent = p.getLong("consent_at", 0);
        String server = p.getString("server", DEFAULT_SERVER);
        p.edit().clear().putLong("consent_at", consent).putString("server", server).commit();
    }
}
