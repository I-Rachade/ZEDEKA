"use client";

import { useState } from "react";
import { type AdminRestaurant, type SupportRequest } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { ContactButtons } from "../ContactButtons";
import { Empty, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAdmin } from "../useAdmin";

// Restaurants et boutiques pour la managerin : coordonnées, appel ou WhatsApp en un geste, demandes en cours.
// Lecture seule : la fiche, la carte et l'abonnement restent au directeur (page Restaurants).
export default function PartnersPage() {
  const { data, error } = useAdmin<AdminRestaurant[]>("/restaurants");
  const requests = useAdmin<SupportRequest[]>("/requests?status=ACTIVE&source=RESTAURANT");
  const [q, setQ] = useState("");
  const t = useT();
  const needle = q.trim().toLowerCase();
  const rows = data?.filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.phone.replace(/\s/g, "").includes(needle.replace(/\s/g, "")));
  const openFor = (id: string) => requests.data?.filter((r) => r.restaurantId === id).length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="store"
        title="Restaurants et boutiques"
        description="Appelez un partenaire depuis votre téléphone ou par WhatsApp, et notez sa demande pour la suivre avec l'équipe."
      />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher (nom, téléphone)")} className={input} />
      <ErrorNote message={error} />
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{t("Aucun partenaire trouvé.")}</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {r.name} {!r.active && <span className="text-sm font-normal text-stone-500">{t("(inactif)")}</span>}
                  </p>
                  <p className="text-sm text-stone-500">
                    {r.address}
                    {r.zone ? ` · ${r.zone.name.split(" – ")[0]}` : ""} · {r.phone}
                  </p>
                </div>
                {openFor(r.id) > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{t("{n} demandes en cours", { n: openFor(r.id) })}</span>
                )}
              </div>
              <ContactButtons
                phone={r.phone}
                message={t("Bonjour {name}, ici Zedeka.", { name: r.name })}
                request={{ source: "RESTAURANT", name: r.name, restaurantId: r.id }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
