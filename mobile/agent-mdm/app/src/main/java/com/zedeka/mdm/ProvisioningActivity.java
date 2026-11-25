package com.zedeka.mdm;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.Intent;
import android.os.Bundle;
import android.os.PersistableBundle;

/** Étapes demandées par Android 10+ pendant le provisionnement d'un téléphone d'entreprise. */
public class ProvisioningActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        String action = in == null ? "" : String.valueOf(in.getAction());
        if (DevicePolicyManager.ACTION_GET_PROVISIONING_MODE.equals(action)) {
            Intent result = new Intent();
            result.putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE);
            PersistableBundle extras = in.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
            if (extras != null) result.putExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, extras);
            setResult(RESULT_OK, result);
        } else {
            // ADMIN_POLICY_COMPLIANCE : l'agent est désormais propriétaire de l'appareil.
            PersistableBundle extras = in == null ? null : in.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
            Provisioning.onProvisioned(this, extras);
            setResult(RESULT_OK);
        }
        finish();
    }
}
