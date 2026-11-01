"use client";

import Link from "next/link";
import { fcfa } from "@/lib/api";
import { adminFetch } from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { useT } from "@/lib/i18n/client";

type Category = { id: string; name: string; surcharge: number; perKgFee: number; active: boolean };

export default function ParcelCategoriesPage() {
  const { data, error, reload } = useAdmin<Category[]>("/parcel-categories");
  const action = useAction();
  const t = useT();

  const patch = (id: string, body: Partial<Category>) =>
    action.run(async () => {
      await adminFetch(`/parcel-categories/${id}`, { method: "PATCH", body });
      await reload();
    });

  return (
    <div className="space-y-4">
      <PageHeader
        icon="box"
        title="Colis"
        description="Catégories de colis et leur tarif."
        actions={
          <Link href="/admin/commandes" className="text-sm text-emerald-700">
            {t("Voir les commandes de colis")}
          </Link>
        }
      />
      <p className="text-sm text-stone-600">
        {t("Prix d'un colis = tarif au km (Réglages) + supplément de la catégorie + prix au kg. Le formulaire public est sur")}{" "}
        <Link href="/colis" className="text-emerald-700 underline">
          /colis
        </Link>
        .
      </p>
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <Card title="Catégories">
          <ul className="divide-y divide-stone-100">
            {data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className={c.active ? "" : "opacity-50"}>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-stone-500">
                    + {fcfa(c.surcharge)}
                    {c.perKgFee > 0 && `, + ${fcfa(c.perKgFee)}/kg`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      const surcharge = prompt(t("Supplément fixe pour {name} (FCFA)", { name: c.name }), String(c.surcharge));
                      if (surcharge === null) return;
                      const perKg = prompt(t("Prix par kg pour {name} (FCFA)", { name: c.name }), String(c.perKgFee));
                      if (perKg === null) return;
                      patch(c.id, { surcharge: Number(surcharge), perKgFee: Number(perKg) });
                    }}
                    className={buttonGhost}
                  >
                    {t("Tarif")}
                  </button>
                  <button onClick={() => patch(c.id, { active: !c.active })} className={buttonGhost}>
                    {c.active ? t("Désactiver") : t("Activer")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const ok = await action.run(async () => {
                await adminFetch("/parcel-categories", {
                  method: "POST",
                  body: { name: f.get("name"), surcharge: Number(f.get("surcharge")), perKgFee: Number(f.get("perKgFee")) },
                });
                await reload();
              });
              if (ok) form.reset();
            }}
            className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-4"
          >
            <input name="name" required placeholder={t("Catégorie (ex. Électronique)")} className={`${input} sm:col-span-2`} />
            <input name="surcharge" type="number" min={0} step={50} defaultValue={0} aria-label={t("Supplément")} className={input} />
            <input name="perKgFee" type="number" min={0} step={10} defaultValue={0} aria-label={t("Prix par kg")} className={input} />
            <button className={`${button} sm:col-span-4`}>{t("Ajouter la catégorie")}</button>
          </form>
        </Card>
      )}
    </div>
  );
}
