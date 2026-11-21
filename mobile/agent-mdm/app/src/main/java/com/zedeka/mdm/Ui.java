package com.zedeka.mdm;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Petits composants d'interface construits en code (pas de dépendance AndroidX). */
final class Ui {
    static final int GREEN = Color.parseColor("#0E7C4A");
    static final int GREEN_LIGHT = Color.parseColor("#E7F4EC");
    static final int RED = Color.parseColor("#B42318");
    static final int RED_LIGHT = Color.parseColor("#FDECEA");
    static final int AMBER_LIGHT = Color.parseColor("#FFF4E0");
    static final int TEXT = Color.parseColor("#1D2939");
    static final int MUTED = Color.parseColor("#667085");
    static final int BORDER = Color.parseColor("#E4E7EC");

    private Ui() {}

    static int dp(Context c, int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static TextView text(Context c, String s, int sp, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(TEXT);
        t.setLineSpacing(0, 1.15f);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    static TextView muted(Context c, String s) {
        TextView t = text(c, s, 14, false);
        t.setTextColor(MUTED);
        return t;
    }

    static Button button(Context c, String label, boolean primary) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTextColor(primary ? Color.WHITE : GREEN);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(c, 12));
        if (primary) bg.setColor(GREEN);
        else { bg.setColor(Color.WHITE); bg.setStroke(dp(c, 1), GREEN); }
        b.setBackground(bg);
        b.setMinHeight(dp(c, 48));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(c, 10);
        b.setLayoutParams(lp);
        return b;
    }

    static LinearLayout card(Context c, int color) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        int p = dp(c, 16);
        l.setPadding(p, p, p, p);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(c, 14));
        bg.setColor(color);
        if (color == Color.WHITE) bg.setStroke(dp(c, 1), BORDER);
        l.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(c, 12);
        l.setLayoutParams(lp);
        return l;
    }

    /** Puce de liste : « • texte ». */
    static TextView bullet(Context c, String s) {
        TextView t = text(c, "•  " + s, 15, false);
        t.setPadding(0, dp(c, 3), 0, dp(c, 3));
        return t;
    }

    static TextView heading(Context c, String s) {
        TextView t = text(c, s, 17, true);
        t.setPadding(0, dp(c, 14), 0, dp(c, 4));
        return t;
    }
}
