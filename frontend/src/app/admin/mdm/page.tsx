"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, Card, ErrorNote, PageHeader } from "../ui";

// Parc mobile (MDM) : console de gestion des téléphones et tablettes de l'équipe (Worker zedeka-mdm, dossier mdm/).
// L'admin demande un jeton d'une minute à l'API, puis ouvre la console déjà connectée, dans un nouvel onglet.
export default function MdmPage() {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setError(null);
    setBusy(true);
    // L'onglet s'ouvre tout de suite (sinon le navigateur le bloque), puis reçoit l'adresse signée.
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await adminFetch<{ url: string }>("/mdm/session", { method: "POST" });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon="phone" title={t("Parc mobile")} description={t("Téléphones et tablettes de l'équipe : localisation, verrouillage, effacement, applications et sécurité.")} />
      <Card>
        <div className="space-y-3 text-sm">
          <p>{t("La console du parc mobile s'ouvre dans un nouvel onglet, déjà connectée avec votre compte.")}</p>
          <ul className="list-disc space-y-1 pl-5 text-stone-600">
            <li>{t("Enrôler un téléphone : QR code ou connexion au Wi-Fi de Zedeka.")}</li>
            <li>{t("Téléphone perdu ou volé : mode perdu, localisation, puis effacement si besoin.")}</li>
            <li>{t("Applications obligatoires ou interdites, politique de mot de passe, alertes.")}</li>
          </ul>
          <button className={button} onClick={open} disabled={busy}>
            {busy ? t("Ouverture…") : t("Ouvrir la console du parc mobile")}
          </button>
          <ErrorNote message={error} />
        </div>
      </Card>
    </div>
  );
}
