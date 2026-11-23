"use client";

import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { daysLabel, whenLabel, type PlannedMeal } from "@/lib/plannedMeals";
import { buttonGhost, Card, Empty, ErrorNote, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Repas planifiés et formules cantine en cours : prochaine livraison par restaurant (pour prévenir les cuisines des
// gros volumes de midi), dernière erreur, annulation. Les commandes elles-mêmes arrivent dans « Commandes » 60 min avant.
export default function AdminPlannedMeals() {
  const t = useT();
  const { data, error, reload } = useAdmin<{ plans: PlannedMeal[] }>("/planned-meals");
  const action = useAction();
  const plans = data?.plans ?? [];
  const weekly = plans.filter((p) => p.kind === "WEEKLY" && p.status === "ACTIVE").length;

  return (
    <div className="max-w-5xl">
      <PageHeader
        icon="clock"
        title="Repas planifiés"
        count={plans.length}
        description="Commandes à l'avance et formules cantine. Chaque commande est envoyée au restaurant 60 minutes avant l'heure de livraison."
      />
      <ErrorNote message={error ?? action.error} />
      <p className="mb-3 text-sm text-stone-600">{t("{n} formules cantine actives", { n: weekly })}</p>
      <Card title="À venir" icon="clock">
        {!data ? (
          <Loading />
        ) : plans.length === 0 ? (
          <Empty>{t("Aucun repas planifié")}</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">
                    {p.kind === "WEEKLY" ? `🍱 ${t("Formule cantine")}` : `🕒 ${t("Repas planifié")}`} · {p.restaurant?.name}
                    {p.status === "PAUSED" && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs">{t("En pause")}</span>}
                  </p>
                  <p className="text-stone-600">
                    {p.customerName} · {p.customerPhone} · 📍 {p.address}
                  </p>
                  <p className="text-stone-600">
                    {p.kind === "WEEKLY" ? t("{jours} à {heure}", { jours: daysLabel(p.days, t), heure: p.deliverTime }) : p.deliverAt ? whenLabel(p.deliverAt, "fr-FR") : ""}
                    {p.nextRunAt ? ` · ${t("Prochaine livraison : {quand}", { quand: whenLabel(p.nextRunAt, "fr-FR") })}` : ""} · {fcfa(p.estimate)}
                  </p>
                  <p className="text-stone-500">{p.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</p>
                  {p.lastError && <p className="text-amber-800">{p.lastError}</p>}
                </div>
                <button
                  type="button"
                  className={buttonGhost}
                  onClick={() => window.confirm(t("Annuler ce repas planifié ? Les livraisons à venir ne seront pas commandées.")) && action.run(() => adminFetch(`/planned-meals/${p.id}/cancel`, { method: "POST" })).then((ok) => void (ok && reload()))}
                >
                  {t("Annuler")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
