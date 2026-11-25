package com.zedeka.mdm;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Écran « appareil perdu ». Sur un téléphone d'entreprise, il reste épinglé (impossible d'en sortir). */
public class LostModeActivity extends Activity {
    static final String ACTION_CLOSE = "com.zedeka.mdm.LOST_MODE_OFF";

    private final BroadcastReceiver close = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { leave(); }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        if (!Prefs.lostMode(this)) { finish(); return; }

        int pad = Ui.dp(this, 28);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(pad, pad, pad, pad);
        root.setBackgroundColor(Color.parseColor("#B42318"));

        TextView title = Ui.text(this, "Appareil perdu", 28, true);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        TextView msg = Ui.text(this, Prefs.sp(this).getString("lost_message", LostMode.DEFAULT_MESSAGE), 18, false);
        msg.setTextColor(Color.WHITE);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(0, Ui.dp(this, 16), 0, Ui.dp(this, 24));
        root.addView(msg);

        String phone = Prefs.sp(this).getString("lost_phone", "");
        if (phone != null && !phone.isEmpty()) {
            Button call = Ui.button(this, "Appeler " + phone, true);
            call.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + phone))));
            root.addView(call);
        }
        setContentView(root);

        IntentFilter f = new IntentFilter(ACTION_CLOSE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(close, f, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(close, f);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!Prefs.lostMode(this)) { leave(); return; }
        if (Admin.isDeviceOwner(this)) {
            try { startLockTask(); } catch (Exception ignored) {}
        }
    }

    private void leave() {
        try { stopLockTask(); } catch (Exception ignored) {}
        finish();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (!Admin.isDeviceOwner(this)) super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(close); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
