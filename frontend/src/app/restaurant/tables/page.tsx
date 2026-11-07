"use client";

import { useEffect, useState } from "react";
import { buttonGhost, ErrorNote, Loading, PageHeader } from "@/components/panel/ui";
import { Icon } from "@/components/panel/icons";
import TablesEditor, { type Table } from "@/components/panel/TablesEditor";
import { getRestaurantName, restaurantFetch, type Me, type TableCalls } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

// Tables numérotées et leurs QR codes. Le client scanne le code posé sur sa table, commande sur place, et la
// commande arrive ici avec le numéro de la table : le restaurant l'apporte, sans livreur.
export default function RestaurantTablesPage() {
  const { data, error, reload } = useRestaurant<Table[]>("/tables");
  const action = useRestaurantAction();
  const [name, setName] = useState("");
  const t = useT();
  useEffect(() => setName(getRestaurantName() ?? ""), []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="qr"
        title="Tables et QR codes"
        count={data.length}
        description="Posez sur chaque table son QR code. Le client le scanne, commande sur place, et la commande arrive ici avec le numéro de la table : apportez-la, sans livreur."
        actions={
          data.length > 0 && (
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> {t("Imprimer tous les QR codes")}
            </button>
          )
        }
      />
      <div className="print:hidden">
        <ErrorNote message={action.error} />
      </div>
      <TableCallsSetting />
      <TablesEditor tables={data} fetcher={restaurantFetch} run={action.run} reload={reload} restaurant={name} />
    </div>
  );
}

// Sonnerie de table : interrupteur du restaurant et temps moyen de réponse des 7 derniers jours.
function TableCallsSetting() {
  const me = useRestaurant<Me>("/me");
  const stats = useRestaurant<TableCalls>("/table-calls");
  const action = useRestaurantAction();
  const t = useT();
  if (!me.data) return null;
  const on = me.data.tableCallsEnabled !== false;
  const avg = stats.data?.stats.avgResponseSec ?? null;
  const toggle = () =>
    action.run(async () => {
      await restaurantFetch("/settings", { method: "PATCH", body: { tableCallsEnabled: !on } });
      await me.reload();
    });
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-stone-200 bg-surface p-4 print:hidden">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${on ? "bg-sun/40 text-ink-deep" : "bg-stone-100 text-stone-400"}`}>
        <Icon name="bell" className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{t("Sonnerie de table")}</p>
        <p className="text-sm text-stone-600">
          {on
            ? t("Le client appelle le serveur ou demande l'addition depuis le QR code : l'espace restaurant sonne jusqu'à ce que quelqu'un touche « J'arrive ».")
            : t("Coupée : les clients ne voient pas le bouton « Sonner » sur la carte de leur table.")}
        </p>
        {on && (
          <p className="mt-1 text-sm text-stone-500">
            {avg === null
              ? t("Pas encore d'appel cette semaine.")
              : t("Temps moyen de réponse sur 7 jours : {time} · {n} appel(s)", { time: duration(avg), n: stats.data!.stats.answered })}
          </p>
        )}
        <ErrorNote message={action.error} />
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={t("Sonnerie de table")}
        onClick={toggle}
        className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-stone-300"}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
      </button>
    </section>
  );
}

// 45 s, 2 min 05 (unités identiques en français et en anglais).
const duration = (sec: number) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, "0")}`); // i18n-ignore
