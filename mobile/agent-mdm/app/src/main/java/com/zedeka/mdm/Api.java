package com.zedeka.mdm;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Appels JSON vers le serveur MDM (même protocole que mdm/agent/simulator.mjs). */
final class Api {
    private Api() {}

    static final class ApiException extends Exception {
        final int code;
        ApiException(int code, String message) { super(message); this.code = code; }
    }

    static JSONObject post(String server, String path, JSONObject body, String token) throws IOException, ApiException {
        HttpURLConnection con = (HttpURLConnection) new URL(server + path).openConnection();
        try {
            con.setConnectTimeout(15000);
            con.setReadTimeout(30000);
            con.setRequestMethod("POST");
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("Accept", "application/json");
            if (token != null) con.setRequestProperty("Authorization", "Bearer " + token);
            byte[] bytes = (body == null ? "{}" : body.toString()).getBytes(StandardCharsets.UTF_8);
            con.setDoOutput(true);
            con.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = con.getOutputStream()) { out.write(bytes); }
            int code = con.getResponseCode();
            String text = read(code >= 400 ? con.getErrorStream() : con.getInputStream());
            JSONObject json;
            try { json = text.isEmpty() ? new JSONObject() : new JSONObject(text); }
            catch (JSONException e) { json = new JSONObject(); }
            if (code >= 400) throw new ApiException(code, json.optString("error", "Erreur du serveur (" + code + ")"));
            return json;
        } finally {
            con.disconnect();
        }
    }

    static JSONObject get(String server, String path) throws IOException, ApiException {
        HttpURLConnection con = (HttpURLConnection) new URL(server + path).openConnection();
        try {
            con.setConnectTimeout(15000);
            con.setReadTimeout(30000);
            int code = con.getResponseCode();
            String text = read(code >= 400 ? con.getErrorStream() : con.getInputStream());
            if (code >= 400) throw new ApiException(code, "Erreur du serveur (" + code + ")");
            try { return new JSONObject(text); } catch (JSONException e) { throw new ApiException(code, "Réponse illisible"); }
        } finally {
            con.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream is = in) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = is.read(b)) > 0) buf.write(b, 0, n);
            return buf.toString("UTF-8");
        }
    }
}
