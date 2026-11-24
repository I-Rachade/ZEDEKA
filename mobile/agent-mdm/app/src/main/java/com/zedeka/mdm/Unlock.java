package com.zedeka.mdm;

import android.content.Context;
import android.util.Base64;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Code de déblocage donné par l'administrateur (console > appareil > « Code de déblocage »).
 * Même calcul que mdm/src/lib/unlock.ts : HMAC-SHA256(secret, "unlock:<heure>") → 8 chiffres.
 * Vérifiable sans réseau ; valable environ 2 heures.
 */
final class Unlock {
    private Unlock() {}

    static boolean hasSecret(Context c) { return Prefs.sp(c).getString("unlock_secret", null) != null; }

    static String code(String secretB64, long counter) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(Base64.decode(secretB64, Base64.DEFAULT), "HmacSHA256"));
        byte[] sig = mac.doFinal(("unlock:" + counter).getBytes("UTF-8"));
        long n = ((sig[0] & 0xffL) << 24) | ((sig[1] & 0xffL) << 16) | ((sig[2] & 0xffL) << 8) | (sig[3] & 0xffL);
        return String.format(java.util.Locale.ROOT, "%08d", n % 100_000_000L);
    }

    static boolean verify(Context c, String input) {
        String secret = Prefs.sp(c).getString("unlock_secret", null);
        String clean = input == null ? "" : input.replaceAll("\\D", "");
        if (secret == null || clean.length() != 8) return false;
        long now = System.currentTimeMillis() / 3_600_000L;
        try {
            for (long k = now + 1; k >= now - 2; k--) if (code(secret, k).equals(clean)) return true;
        } catch (Exception ignored) {}
        return false;
    }
}
