package com.zedeka.mdm;

import android.net.Uri;

import org.json.JSONObject;

/**
 * Comprend toutes les formes d'invitation :
 *  - QR code de la page d'enrôlement : {"server":"https://…","token":"…"}
 *  - lien d'invitation : https://serveur/enroll?t=…
 *  - lien « Ouvrir dans Agent MDM » : zedekamdm://enroll?server=https://…&t=…
 *  - code seul (serveur par défaut ou saisi à la main)
 */
final class EnrollLink {
    final String server;
    final String token;

    EnrollLink(String server, String token) {
        this.server = server;
        this.token = token;
    }

    static EnrollLink parse(String raw, String fallbackServer) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        try {
            if (s.startsWith("{")) {
                JSONObject o = new JSONObject(s);
                String t = o.optString("token", o.optString("enrollment_token", ""));
                return t.isEmpty() ? null : new EnrollLink(o.optString("server", fallbackServer), t);
            }
            if (s.startsWith("zedekamdm:") || s.startsWith("https://") || s.startsWith("http://")) {
                Uri u = Uri.parse(s);
                String t = u.getQueryParameter("t");
                if (t == null || t.isEmpty()) return null;
                String server = u.getQueryParameter("server");
                if (server == null && u.getScheme() != null && u.getScheme().startsWith("http"))
                    server = u.getScheme() + "://" + u.getAuthority();
                return new EnrollLink(server == null ? fallbackServer : server, t);
            }
        } catch (Exception ignored) {
            return null;
        }
        String t = s.replaceAll("[^A-Za-z0-9_-]", "");
        return t.isEmpty() ? null : new EnrollLink(fallbackServer, t);
    }
}
