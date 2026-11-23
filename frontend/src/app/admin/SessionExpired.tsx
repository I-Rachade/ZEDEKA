"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { button } from "./ui";

// Adresse de reconnexion : le chargement complet passe d'abord par Cloudflare Access (double authentification),
// puis la page de connexion rappelle pourquoi la session s'est fermée.
export const RELOGIN_URL = "/admin/connexion?raison=inactivite";
const SECONDS = 20;

// Écran plein qui remplace l'admin quand la session a expiré : plus aucune donnée affichée, un message clair,
// et le départ vers la connexion (tout de suite au clic, sinon au bout de 20 secondes).
export default function SessionExpired() {
  const t = useT();
  const [left, setLeft] = useState(SECONDS);

  useEffect(() => {
    const previous = document.title;
    document.title = t("Session expirée") + " – Zedeka";
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearInterval(timer);
      document.title = previous;
    };
  }, [t]);

  useEffect(() => {
    if (left === 0) window.location.assign(RELOGIN_URL);
  }, [left]);

  return (
    <div role="alertdialog" aria-labelledby="session-expired-title" className="fixed inset-0 z-[1000] flex items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl" aria-hidden>
          🔒
        </div>
        <h1 id="session-expired-title" className="text-xl font-semibold text-stone-900">
          {t("Vous avez été déconnecté")}
        </h1>
        <p className="mt-2 text-sm text-stone-600">{t("Pour protéger les données, la session admin s'est fermée après une période d'inactivité. Reconnectez-vous pour continuer.")}</p>
        <button type="button" className={`${button} mt-5 w-full`} onClick={() => window.location.assign(RELOGIN_URL)}>
          {t("Se reconnecter")}
        </button>
        <p className="mt-3 text-xs text-stone-500">{t("Redirection vers la connexion dans {n} s", { n: String(left) })}</p>
      </div>
    </div>
  );
}
