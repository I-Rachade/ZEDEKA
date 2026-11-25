package com.zedeka.mdm;

import android.app.Activity;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/** Lecture du QR code d'enrôlement par les services Google Play (aucune permission caméra pour l'agent). */
final class QrScanner {
    interface Callback {
        void onResult(String text);
        void onError(String message);
    }

    private QrScanner() {}

    static void scan(Activity activity, Callback cb) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(activity, options);
        scanner.startScan()
                .addOnSuccessListener(code -> cb.onResult(code.getRawValue()))
                .addOnCanceledListener(() -> cb.onError(null))
                .addOnFailureListener(e -> cb.onError("Lecteur de QR code indisponible sur ce téléphone. Saisissez le code à la main."));
    }
}
