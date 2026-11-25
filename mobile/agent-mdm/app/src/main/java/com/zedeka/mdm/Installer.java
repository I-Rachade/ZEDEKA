package com.zedeka.mdm;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Installation / désinstallation : silencieuse en mode propriétaire, proposée à l'utilisateur sinon. */
final class Installer {
    private Installer() {}

    /** Retourne une phrase décrivant ce qui a été fait. */
    static String offerOrInstall(Context c, String pkg, String name, String url) {
        boolean https = url != null && url.startsWith("https://");
        if (Admin.isDeviceOwner(c) && https) {
            try {
                installSilently(c, url);
                return "installation lancée";
            } catch (Exception e) {
                // on retombe sur la proposition à l'utilisateur
            }
        }
        Intent open = https ? new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
        Notifier.show(c, ("install:" + pkg).hashCode(), Notifier.CH_ACTION, "Application demandée par votre entreprise",
                "Installez « " + name + " ». Touchez pour l'obtenir.", Notifier.activity(c, open, ("inst:" + pkg).hashCode()));
        return "proposée à l'utilisateur";
    }

    static String uninstall(Context c, String pkg) {
        if (!Inventory.isInstalled(c, pkg)) return "déjà absente";
        if (Admin.isDeviceOwner(c)) {
            c.getPackageManager().getPackageInstaller().uninstall(pkg, statusSender(c, pkg.hashCode()));
            return "désinstallation lancée";
        }
        Intent del = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
        Notifier.show(c, ("remove:" + pkg).hashCode(), Notifier.CH_ACTION, "Désinstallation demandée par votre entreprise",
                "Touchez pour désinstaller « " + Policies.appLabel(c, pkg) + " ».", Notifier.activity(c, del, ("rm:" + pkg).hashCode()));
        return "proposée à l'utilisateur";
    }

    private static void installSilently(Context c, String url) throws IOException {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int id = pi.createSession(params);
        try (PackageInstaller.Session session = pi.openSession(id)) {
            HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(15000);
            con.setReadTimeout(60000);
            try (InputStream in = con.getInputStream(); OutputStream out = session.openWrite("app.apk", 0, -1)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            } finally {
                con.disconnect();
            }
            session.commit(statusSender(c, id));
        }
    }

    private static android.content.IntentSender statusSender(Context c, int req) {
        Intent i = new Intent(c, InstallReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (android.os.Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(c, req, i, flags).getIntentSender();
    }
}
