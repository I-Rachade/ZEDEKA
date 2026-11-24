package com.zedeka.mdm;

import android.content.Context;
import android.widget.LinearLayout;

/** Notice d'information RGPD (art. 13) : affichée avant l'enrôlement et consultable à tout moment. */
final class Notice {
    private Notice() {}

    static void fill(Context c, LinearLayout box, String org, boolean continuousLocation) {
        String who = org == null || org.isEmpty() ? "votre entreprise" : org;
        box.addView(Ui.text(c, "Agent MDM permet à " + who + " de protéger ce téléphone professionnel et ses données "
                + "(intérêt légitime, art. 6.1.f du RGPD).", 15, false));

        box.addView(Ui.heading(c, "Ce qui est envoyé"));
        box.addView(Ui.bullet(c, "Nom et modèle du téléphone, version d'Android"));
        box.addView(Ui.bullet(c, "État de sécurité : chiffrement, présence d'un code de verrouillage (jamais le code lui-même), téléphone modifié (« rooté ») ou non"));
        box.addView(Ui.bullet(c, "Niveau de batterie et espace de stockage utilisé"));
        box.addView(Ui.bullet(c, "Liste des applications que vous avez installées (nom et version, pas leur contenu)"));

        box.addView(Ui.heading(c, "Localisation"));
        box.addView(Ui.text(c, continuousLocation
                ? "Relevée périodiquement, selon la politique de " + who + ". Vous pouvez refuser l'autorisation dans Android."
                : "Jamais en continu. Seulement quand un administrateur la demande avec un motif (inscrit au journal d'audit), "
                + "ou quand le téléphone est déclaré perdu ou volé. Une notification vous prévient. L'autorisation est facultative.", 15, false));

        box.addView(Ui.heading(c, "Ce qui n'est jamais lu"));
        box.addView(Ui.text(c, "Messages, appels, contacts, photos, fichiers, historique de navigation, contenu des applications, mots de passe.", 15, false));

        box.addView(Ui.heading(c, "Ce que l'entreprise peut faire à distance"));
        box.addView(Ui.bullet(c, "Verrouiller le téléphone, le faire sonner, afficher un message s'il est perdu"));
        box.addView(Ui.bullet(c, "Demander d'installer ou de désinstaller une application professionnelle"));
        box.addView(Ui.bullet(c, "Exiger un code de verrouillage suffisant"));
        box.addView(Ui.bullet(c, "Empêcher le retrait de l'agent : pour quitter la gestion, il faut un code donné par l'administrateur"));
        box.addView(Ui.bullet(c, "Effacer : sur un téléphone personnel, uniquement les données de l'entreprise ; l'effacement complet est réservé aux téléphones de l'entreprise"));

        box.addView(Ui.heading(c, "Vos droits"));
        box.addView(Ui.text(c, "Accès, rectification, effacement et opposition. Pour quitter la gestion, demandez le code de déblocage à votre administrateur. "
                + "Vous pouvez télécharger vos données depuis la console (rubrique Confidentialité). Les positions sont chiffrées et supprimées "
                + "automatiquement après la durée de conservation.", 15, false));
    }
}
