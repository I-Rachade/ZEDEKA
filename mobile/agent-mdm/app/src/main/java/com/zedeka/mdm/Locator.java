package com.zedeka.mdm;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Looper;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Position ponctuelle, demandée seulement quand le serveur l'exige (commande « Localiser » ou mode perdu). */
final class Locator {
    private Locator() {}

    static boolean permitted(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean backgroundPermitted(Context c) {
        if (Build.VERSION.SDK_INT < 29) return permitted(c);
        return c.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Bloque au plus timeoutMs. À appeler hors du fil principal. Retourne null si impossible. */
    @SuppressWarnings({"MissingPermission", "deprecation"})
    static JSONObject current(Context c, long timeoutMs) {
        if (!permitted(c)) return null;
        LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;
        String provider = null;
        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) provider = LocationManager.GPS_PROVIDER;
        else if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) provider = LocationManager.NETWORK_PROVIDER;
        if (provider == null) return null;

        AtomicReference<Location> ref = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                CancellationSignal cancel = new CancellationSignal();
                lm.getCurrentLocation(provider, cancel, Executors.newSingleThreadExecutor(), loc -> {
                    ref.set(loc);
                    latch.countDown();
                });
                if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) cancel.cancel();
            } else {
                LocationListener listener = new LocationListener() {
                    @Override public void onLocationChanged(Location loc) { ref.set(loc); latch.countDown(); }
                    @Override public void onStatusChanged(String p, int s, Bundle b) {}
                    @Override public void onProviderEnabled(String p) {}
                    @Override public void onProviderDisabled(String p) {}
                };
                lm.requestSingleUpdate(provider, listener, Looper.getMainLooper());
                if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) lm.removeUpdates(listener);
            }
        } catch (Exception ignored) {}

        Location loc = ref.get();
        if (loc == null) {
            try {
                Location last = lm.getLastKnownLocation(provider);
                // Dernière position connue acceptée si elle a moins de 10 minutes
                if (last != null && System.currentTimeMillis() - last.getTime() < 10 * 60_000L) loc = last;
            } catch (Exception ignored) {}
        }
        if (loc == null) return null;
        try {
            JSONObject o = new JSONObject();
            o.put("lat", loc.getLatitude());
            o.put("lon", loc.getLongitude());
            if (loc.hasAccuracy()) o.put("accuracy", Math.round(loc.getAccuracy()));
            o.put("source", LocationManager.GPS_PROVIDER.equals(loc.getProvider()) ? "gps" : "wifi");
            return o;
        } catch (JSONException e) {
            return null;
        }
    }
}
