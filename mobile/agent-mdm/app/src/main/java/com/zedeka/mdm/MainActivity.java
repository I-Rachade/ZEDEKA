package com.zedeka.mdm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.text.format.DateUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Écran unique : notice RGPD → enrôlement (QR code ou code) → tableau de bord de l'appareil. */
public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 1;
    private static final int REQ_BACKGROUND = 2;
    private static final int REQ_NOTIF = 3;
    private static final int REQ_ADMIN = 4;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private LinearLayout content;
    private String org = "Zedeka";
    private boolean continuousLocation = false;
    private String prefillCode = "";
    private String prefillServer = null;
    private boolean busy = false;
    private String status = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(root);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setBackgroundColor(Ui.GREEN);
        int p = Ui.dp(this, 20);
        header.setPadding(p, Ui.dp(this, 28), p, p);
        TextView title = Ui.text(this, "Agent MDM", 24, true);
        title.setTextColor(Color.WHITE);
        header.addView(title);
        TextView sub = Ui.text(this, "Gestion du téléphone professionnel · Zedeka", 14, false);
        sub.setTextColor(Color.parseColor("#D1FADF"));
        header.addView(sub);
        root.addView(header);

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(p, Ui.dp(this, 4), p, Ui.dp(this, 32));
        root.addView(content);
        setContentView(scroll);

        handleLink(getIntent());
        loadServerInfo();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleLink(intent);
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
        if (Prefs.isEnrolled(this)) Provisioning.prepareResetToken(this);
    }

    @Override
    protected void onDestroy() {
        io.shutdown();
        super.onDestroy();
    }

    private void handleLink(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null) return;
        EnrollLink link = EnrollLink.parse(data.toString(), Prefs.server(this));
        if (link != null) {
            prefillCode = link.token;
            prefillServer = link.server;
        }
    }

    /** Nom de l'organisation et mode de localisation, pour une notice exacte. */
    private void loadServerInfo() {
        String server = prefillServer != null ? prefillServer : Prefs.server(this);
        io.execute(() -> {
            try {
                JSONObject h = Api.get(Agent.normalizeServer(server), "/api/health");
                org = h.optString("org", org);
                continuousLocation = "continuous".equals(h.optString("location_mode"));
                runOnUiThread(this::render);
            } catch (Exception ignored) {}
        });
    }

    // ------------------------------------------------------------------ rendu
    private void render() {
        content.removeAllViews();
        if (!Prefs.consent(this)) renderNotice();
        else if (!Prefs.isEnrolled(this)) renderEnroll();
        else renderDashboard();
    }

    private void renderNotice() {
        content.addView(Ui.heading(this, "Avant de commencer"));
        LinearLayout box = Ui.card(this, Ui.GREEN_LIGHT);
        Notice.fill(this, box, org, continuousLocation);
        content.addView(box);
        CheckBox ok = new CheckBox(this);
        ok.setText("J'ai lu ces informations");
        ok.setTextSize(16);
        ok.setPadding(0, Ui.dp(this, 12), 0, 0);
        content.addView(ok);
        Button next = Ui.button(this, "Continuer", true);
        next.setEnabled(false);
        next.setAlpha(0.5f);
        ok.setOnCheckedChangeListener((v, checked) -> { next.setEnabled(checked); next.setAlpha(checked ? 1f : 0.5f); });
        next.setOnClickListener(v -> {
            Prefs.sp(this).edit().putLong("consent_at", System.currentTimeMillis()).apply();
            render();
        });
        content.addView(next);
    }

    private void renderEnroll() {
        String pending = Prefs.sp(this).getString("pending_token", null);
        if (pending != null) {
            content.addView(Ui.heading(this, "Téléphone d'entreprise"));
            content.addView(Ui.muted(this, "Ce téléphone a été préparé par votre service informatique. L'enrôlement se termine automatiquement."));
            Button retry = Ui.button(this, busy ? "Enrôlement…" : "Terminer l'enrôlement", true);
            retry.setEnabled(!busy);
            retry.setOnClickListener(v -> runEnroll(Prefs.sp(this).getString("pending_server", Prefs.DEFAULT_SERVER), pending));
            content.addView(retry);
            showStatus();
            return;
        }

        content.addView(Ui.heading(this, "Enrôler ce téléphone"));
        content.addView(Ui.muted(this, "Ouvrez la page d'enrôlement envoyée par votre service informatique, puis scannez le QR code ou saisissez le code."));

        Button scan = Ui.button(this, "Scanner le QR code", true);
        scan.setEnabled(!busy);
        scan.setOnClickListener(v -> QrScanner.scan(this, new QrScanner.Callback() {
            @Override public void onResult(String text) {
                EnrollLink link = EnrollLink.parse(text, Prefs.server(MainActivity.this));
                if (link == null) { status = "Ce QR code n'est pas un code d'enrôlement."; render(); return; }
                runEnroll(link.server, link.token);
            }
            @Override public void onError(String message) {
                if (message != null) { status = message; render(); }
            }
        }));
        content.addView(scan);

        TextView or = Ui.muted(this, "ou");
        or.setGravity(Gravity.CENTER);
        or.setPadding(0, Ui.dp(this, 14), 0, Ui.dp(this, 4));
        content.addView(or);

        EditText code = new EditText(this);
        code.setHint("Code d'enrôlement");
        code.setText(prefillCode);
        code.setSingleLine(true);
        code.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        content.addView(code);

        EditText server = new EditText(this);
        server.setHint("Serveur");
        server.setText(prefillServer != null ? prefillServer : Prefs.server(this));
        server.setSingleLine(true);
        server.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        server.setTextSize(13);
        server.setTextColor(Ui.MUTED);
        content.addView(server);

        Button go = Ui.button(this, busy ? "Enrôlement…" : "Enrôler avec ce code", false);
        go.setEnabled(!busy);
        go.setOnClickListener(v -> {
            EnrollLink link = EnrollLink.parse(code.getText().toString(), server.getText().toString());
            if (link == null) { status = "Saisissez le code affiché sur la page d'enrôlement."; render(); return; }
            runEnroll(link.server, link.token);
        });
        content.addView(go);
        showStatus();

        TextView notice = Ui.muted(this, "Revoir ce qui est collecté");
        notice.setTextColor(Ui.GREEN);
        notice.setPadding(0, Ui.dp(this, 20), 0, 0);
        notice.setOnClickListener(v -> showNotice());
        content.addView(notice);
    }

    private void showStatus() {
        if (status == null) return;
        LinearLayout box = Ui.card(this, Ui.AMBER_LIGHT);
        box.addView(Ui.text(this, status, 15, false));
        content.addView(box);
    }

    private void runEnroll(String server, String token) {
        busy = true;
        status = null;
        render();
        io.execute(() -> {
            String err = null;
            try {
                Agent.enroll(getApplicationContext(), server, token, null);
            } catch (Api.ApiException e) {
                err = e.getMessage();
            } catch (IllegalArgumentException e) {
                err = e.getMessage();
            } catch (java.io.IOException e) {
                err = "Serveur injoignable. Vérifiez la connexion Internet.";
            } catch (Exception e) {
                err = Prefs.isEnrolled(this) ? null : "Enrôlement impossible : " + e.getMessage();
            }
            String finalErr = err;
            runOnUiThread(() -> {
                busy = false;
                status = finalErr;
                prefillCode = "";
                render();
                if (finalErr == null && Prefs.isEnrolled(this) && !Admin.isAdmin(this)) askAdmin();
            });
        });
    }

    private void renderDashboard() {
        android.content.Context ctx = this;
        boolean lost = Prefs.lostMode(this);
        if (lost) {
            LinearLayout l = Ui.card(this, Ui.RED_LIGHT);
            l.addView(Ui.text(this, "Ce téléphone est déclaré perdu", 17, true));
            l.addView(Ui.muted(this, "Sa position est envoyée à votre entreprise jusqu'à ce qu'il soit retrouvé."));
            content.addView(l);
        }

        // État général
        JSONObject compliance = Agent.compliance(this);
        boolean compliant = compliance.optBoolean("compliant", true);
        LinearLayout st = Ui.card(this, compliant ? Ui.GREEN_LIGHT : Ui.AMBER_LIGHT);
        st.addView(Ui.text(this, compliant ? "Téléphone protégé" : "Action nécessaire", 18, true));
        JSONArray issues = compliance.optJSONArray("issues");
        if (issues != null) for (int i = 0; i < issues.length(); i++) {
            JSONObject is = issues.optJSONObject(i);
            if (is != null) st.addView(Ui.bullet(this, is.optString("label", is.optString("code"))));
        }
        long last = Prefs.sp(this).getLong("last_checkin", 0);
        String err = Prefs.sp(this).getString("last_error", null);
        st.addView(Ui.muted(this, last == 0 ? "Pas encore synchronisé"
                : "Dernière synchronisation " + DateUtils.getRelativeTimeSpanString(last, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)));
        if (err != null) st.addView(Ui.muted(this, "Dernière tentative : " + err));
        st.addView(Ui.muted(this, "Niveau de contrôle : " + Admin.level(this)));
        content.addView(st);

        // Réglages à faire
        boolean notifOk = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        if (!Admin.isAdmin(this) || !notifOk || !Locator.backgroundPermitted(this)) {
            content.addView(Ui.heading(this, "À régler"));
            if (!Admin.isAdmin(this)) {
                LinearLayout a = Ui.card(this, Color.WHITE);
                a.addView(Ui.text(this, "Protection contre la perte et le vol", 16, true));
                a.addView(Ui.muted(this, "Permet à votre entreprise de verrouiller ou d'effacer le téléphone à distance s'il est perdu, "
                        + "et d'exiger un code de verrouillage."));
                Button b = Ui.button(this, "Activer", true);
                b.setOnClickListener(v -> askAdmin());
                a.addView(b);
                content.addView(a);
            }
            if (!notifOk) {
                LinearLayout a = Ui.card(this, Color.WHITE);
                a.addView(Ui.text(this, "Notifications", 16, true));
                a.addView(Ui.muted(this, "Pour être prévenu de chaque action de votre entreprise (localisation, sonnerie, mode perdu)."));
                Button b = Ui.button(this, "Autoriser", false);
                b.setOnClickListener(v -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF));
                a.addView(b);
                content.addView(a);
            }
            if (!Locator.backgroundPermitted(this)) {
                LinearLayout a = Ui.card(this, Color.WHITE);
                a.addView(Ui.text(this, "Localisation (facultative)", 16, true));
                a.addView(Ui.muted(this, continuousLocation ? "Relevée périodiquement selon la politique de l'entreprise."
                        : "Utilisée seulement sur demande motivée d'un administrateur ou si le téléphone est déclaré perdu. "
                        + "Choisissez « Toujours autoriser » pour que cela marche aussi téléphone en poche."));
                Button b = Ui.button(this, Locator.permitted(this) ? "Autoriser « Toujours »" : "Autoriser", false);
                b.setOnClickListener(v -> askLocation());
                a.addView(b);
                content.addView(a);
            }
        }

        Button sync = Ui.button(this, busy ? "Synchronisation…" : "Synchroniser maintenant", true);
        sync.setEnabled(!busy);
        sync.setOnClickListener(v -> syncNow());
        content.addView(sync);

        Button sent = Ui.button(this, "Voir les données envoyées", false);
        sent.setOnClickListener(v -> showSent());
        content.addView(sent);

        Button notice = Ui.button(this, "Notice de confidentialité", false);
        notice.setOnClickListener(v -> showNotice());
        content.addView(notice);

        if (Admin.isDeviceOwner(this)) {
            TextView t = Ui.muted(this, "Téléphone de l'entreprise : pour le retirer de la gestion, contactez votre service informatique.");
            t.setPadding(0, Ui.dp(this, 16), 0, 0);
            content.addView(t);
        } else {
            Button quit = Ui.button(this, "Quitter la gestion", false);
            quit.setTextColor(Ui.RED);
            quit.setOnClickListener(v -> confirmQuit());
            content.addView(quit);
        }
        showStatus();

        TextView foot = Ui.muted(this, "Serveur : " + Prefs.server(ctx) + "\nAppareil : " + Prefs.deviceId(ctx));
        foot.setTextSize(12);
        foot.setPadding(0, Ui.dp(this, 20), 0, 0);
        content.addView(foot);
    }

    // ------------------------------------------------------------------ actions
    private void syncNow() {
        busy = true;
        status = null;
        render();
        io.execute(() -> {
            String err = null;
            try { Agent.checkin(getApplicationContext()); }
            catch (Exception e) { err = Prefs.sp(this).getString("last_error", e.getMessage()); }
            String finalErr = err;
            runOnUiThread(() -> { busy = false; status = finalErr; render(); });
        });
    }

    private void askAdmin() {
        Intent i = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
        i.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, Admin.component(this));
        i.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, getString(R.string.admin_description));
        try { startActivityForResult(i, REQ_ADMIN); } catch (Exception ignored) {}
    }

    private void askLocation() {
        if (!Locator.permitted(this)) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
        } else if (Build.VERSION.SDK_INT >= 29) {
            // Android 11+ : ouvre la page d'autorisation où l'utilisateur choisit « Toujours autoriser »
            requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, REQ_BACKGROUND);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        render();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_ADMIN && Admin.isAdmin(this)) syncNow();
        else render();
    }

    private void confirmQuit() {
        new AlertDialog.Builder(this)
                .setTitle("Quitter la gestion ?")
                .setMessage("Ce téléphone ne sera plus protégé par votre entreprise et n'enverra plus aucune donnée. "
                        + "L'administrateur en sera informé. Vous pourrez peut-être perdre l'accès aux outils de l'entreprise.")
                .setNegativeButton("Annuler", null)
                .setPositiveButton("Quitter", (d, w) -> {
                    busy = true;
                    render();
                    io.execute(() -> {
                        String err = null;
                        try { Agent.unenroll(getApplicationContext()); }
                        catch (Exception e) { err = "Impossible de prévenir le serveur : " + e.getMessage() + ". Réessayez avec une connexion Internet."; }
                        String finalErr = err;
                        runOnUiThread(() -> { busy = false; status = finalErr; render(); });
                    });
                })
                .show();
    }

    private void showNotice() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = Ui.dp(this, 20);
        box.setPadding(p, p / 2, p, 0);
        Notice.fill(this, box, org, continuousLocation);
        ScrollView sv = new ScrollView(this);
        sv.addView(box);
        new AlertDialog.Builder(this).setTitle("Notice de confidentialité").setView(sv).setPositiveButton("Fermer", null).show();
    }

    private void showSent() {
        String text;
        try {
            JSONObject sent = new JSONObject(Prefs.sp(this).getString("last_sent", "{}"));
            JSONObject inv = sent.optJSONObject("inventory");
            StringBuilder b = new StringBuilder();
            if (inv == null) b.append("Rien n'a encore été envoyé.");
            else {
                b.append("Modèle : ").append(inv.optString("model")).append('\n');
                b.append("Android : ").append(inv.optString("os_version")).append('\n');
                if (inv.has("battery")) b.append("Batterie : ").append(inv.optInt("battery")).append(" %\n");
                if (inv.has("storage_used_pct")) b.append("Stockage utilisé : ").append(inv.optInt("storage_used_pct")).append(" %\n");
                b.append("Chiffré : ").append(yes(inv.optBoolean("encrypted"))).append('\n');
                b.append("Code de verrouillage : ").append(yes(inv.optBoolean("passcode_set"))).append('\n');
                b.append("Téléphone rooté : ").append(yes(inv.optBoolean("rooted"))).append('\n');
                b.append("Applications installées : ").append(sent.optInt("apps_count")).append(" (nom et version)\n");
                b.append("Position envoyée : ").append(sent.optBoolean("location") ? "oui (demandée par l'administrateur ou mode perdu)" : "non");
            }
            text = b.toString();
        } catch (Exception e) {
            text = "Rien n'a encore été envoyé.";
        }
        new AlertDialog.Builder(this).setTitle("Dernier envoi").setMessage(text).setPositiveButton("Fermer", null).show();
    }

    private static String yes(boolean v) { return v ? "oui" : "non"; }

}
