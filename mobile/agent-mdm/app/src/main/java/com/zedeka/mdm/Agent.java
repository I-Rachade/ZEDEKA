package com.zedeka.mdm;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;

/**
 * Protocole de l'agent (identique au simulateur mdm/agent/simulator.mjs) :
 *   1. POST /agent/enroll                 { enrollment_token, device }  → device_token
 *   2. POST /agent/checkin                inventaire (+ position si demandée) → commandes + politiques
 *   3. POST /agent/commands/:id/result    résultat de chaque commande
 *   4. POST /agent/unenroll               l'utilisateur quitte la gestion (droit d'opposition)
 */
final class Agent {
    private static final Object LOCK = new Object();

    private Agent() {}

    static void enroll(Context c, String server, String enrollmentToken, String name) throws Exception {
        server = normalizeServer(server);
        JSONObject body = new JSONObject()
                .put("enrollment_token", enrollmentToken.trim())
                .put("device", Inventory.identity(c, name));
        JSONObject res = Api.post(server, "/agent/enroll", body, null);
        Prefs.sp(c).edit()
                .putString("server", server)
                .putString("device_id", res.getString("device_id"))
                .putString("device_token", res.getString("device_token"))
                .putInt("interval", res.optInt("checkin_interval_seconds", 900))
                .putLong("enrolled_at", System.currentTimeMillis())
                .remove("pending_server").remove("pending_token")
                .commit();
        Provisioning.prepareResetToken(c);
        Scheduler.schedule(c, Prefs.interval(c));
        checkin(c);
    }

    static String normalizeServer(String s) {
        String v = s == null ? "" : s.trim();
        if (v.isEmpty()) v = Prefs.DEFAULT_SERVER;
        if (!v.startsWith("http")) v = "https://" + v;
        while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
        if (!v.startsWith("https://")) throw new IllegalArgumentException("Le serveur doit utiliser https://");
        return v;
    }

    /** Tente l'enrôlement laissé en attente par le provisionnement d'entreprise. */
    static void enrollPending(Context c) {
        String token = Prefs.sp(c).getString("pending_token", null);
        if (token == null || Prefs.isEnrolled(c)) return;
        try {
            enroll(c, Prefs.sp(c).getString("pending_server", Prefs.DEFAULT_SERVER), token, null);
        } catch (Exception e) {
            Log.w("AgentMDM", "Enrôlement automatique impossible : " + e.getMessage());
        }
    }

    static void checkin(Context c) throws Exception {
        synchronized (LOCK) {
            if (!Prefs.isEnrolled(c)) {
                enrollPending(c);
                return;
            }
            String server = Prefs.server(c);
            String token = Prefs.token(c);

            JSONObject body = new JSONObject();
            JSONObject inventory = Inventory.inventory(c);
            JSONArray apps = Inventory.apps(c);
            body.put("inventory", inventory);
            body.put("apps", apps);
            boolean sentLocation = false;
            if (Prefs.reportLocation(c)) {
                JSONObject loc = Locator.current(c, 20_000);
                if (loc != null) { body.put("location", loc); sentLocation = true; }
            }

            JSONObject res;
            try {
                res = Api.post(server, "/agent/checkin", body, token);
            } catch (Api.ApiException e) {
                if (e.code == 401) forget(c, "Appareil retiré de la gestion par l'administrateur");
                Prefs.sp(c).edit().putString("last_error", e.getMessage()).apply();
                throw e;
            } catch (IOException e) {
                Prefs.sp(c).edit().putString("last_error", "Serveur injoignable").apply();
                throw e;
            }

            // Transparence : on garde une copie de ce qui a été envoyé, visible dans l'application.
            JSONObject sent = new JSONObject().put("inventory", inventory).put("apps_count", apps.length()).put("location", sentLocation);
            JSONObject policies = res.optJSONObject("policies");
            Prefs.sp(c).edit()
                    .putLong("last_checkin", System.currentTimeMillis())
                    .remove("last_error")
                    .putString("last_sent", sent.toString())
                    .putString("policies", policies == null ? "{}" : policies.toString())
                    .putString("compliance", String.valueOf(res.optJSONObject("compliance")))
                    .putBoolean("report_location", res.optBoolean("report_location", false))
                    .putString("ownership", res.optString("ownership", Prefs.ownership(c)))
                    .apply();

            boolean lost = res.optBoolean("lost_mode", false);
            if (lost && !Prefs.lostMode(c)) LostMode.on(c, null, null);
            if (!lost && Prefs.lostMode(c)) LostMode.off(c);

            Policies.apply(c, policies);

            JSONArray cmds = res.optJSONArray("commands");
            if (cmds != null) {
                for (int i = 0; i < cmds.length(); i++) {
                    JSONObject cmd = cmds.optJSONObject(i);
                    if (cmd == null) continue;
                    runCommand(c, server, token, cmd, policies);
                    if (!Prefs.isEnrolled(c)) return; // effacement des données de l'entreprise : on s'arrête là
                }
            }

            int next = res.optInt("next_checkin_seconds", Prefs.interval(c));
            if (next < 15 * 60) Scheduler.once(c, next); // mode perdu : synchronisations rapprochées
        }
    }

    private static void runCommand(Context c, String server, String token, JSONObject cmd, JSONObject policies) {
        long id = cmd.optLong("id");
        String type = cmd.optString("type");
        JSONObject params = cmd.optJSONObject("params");
        Commands.Outcome o;
        try {
            o = Commands.execute(c, type, params == null ? new JSONObject() : params, policies);
        } catch (Exception e) {
            o = Commands.Outcome.fail(e.getMessage() == null ? e.toString() : e.getMessage());
        }
        try {
            JSONObject body = new JSONObject().put("status", o.ok ? "terminée" : "échec").put("result", o.result);
            if (o.location != null) body.put("location", o.location);
            Api.post(server, "/agent/commands/" + id + "/result", body, token);
        } catch (Exception e) {
            Log.w("AgentMDM", "Résultat de la commande " + id + " non envoyé : " + e.getMessage());
        }
        if (o.after != null) {
            try { o.after.run(); } catch (Exception e) { Log.w("AgentMDM", "Action " + type + " : " + e.getMessage()); }
        }
    }

    /** L'utilisateur quitte la gestion : le serveur est prévenu, puis tout est oublié localement. */
    static void unenroll(Context c) throws Exception {
        synchronized (LOCK) {
            if (Prefs.isEnrolled(c)) {
                try {
                    Api.post(Prefs.server(c), "/agent/unenroll", new JSONObject(), Prefs.token(c));
                } catch (Api.ApiException e) {
                    if (e.code != 401 && e.code != 404) throw e;
                }
            }
            forget(c, null);
        }
    }

    /** Efface tout ce que l'agent sait (jeton, politiques, positions) et retire l'administration. */
    static void forget(Context c, String reason) {
        Scheduler.cancel(c);
        if (Prefs.lostMode(c)) LostMode.off(c);
        Notifier.cancelAll(c);
        try {
            if (Admin.isDeviceOwner(c)) {
                for (String pkg : Prefs.sp(c).getStringSet("hidden_apps", new java.util.HashSet<>()))
                    Admin.dpm(c).setApplicationHidden(Admin.component(c), pkg, false);
            } else if (Admin.isAdmin(c)) {
                Admin.dpm(c).removeActiveAdmin(Admin.component(c));
            }
        } catch (Exception ignored) {}
        Prefs.clearEnrollment(c);
        if (reason != null) Notifier.show(c, Notifier.ID_INFO, Notifier.CH_INFO, "Téléphone retiré de la gestion", reason, null);
    }

    static JSONObject compliance(Context c) {
        try { return new JSONObject(Prefs.sp(c).getString("compliance", "{}")); } catch (JSONException e) { return new JSONObject(); }
    }
}
