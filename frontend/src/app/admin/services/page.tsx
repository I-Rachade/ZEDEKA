"use client";

import { adminFetch } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { Icon } from "@/components/panel/icons";
import { useModuleText, type ModuleCode } from "@/lib/services";
import { Card, DirectorEdits, ErrorNote, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Modules du bouton « Services » de l'appli client. Chaque module se règle seul : Ouvert (proposé aux clients),
// Bientôt (tuile grisée, non cliquable) ou Caché. Un service pas encore construit ne peut pas être ouvert.
// La course Zed suit le réglage « Mode Zed » ; couper le colis bloque aussi les nouveaux colis dans l'API.

type State = "ON" | "SOON" | "OFF";
type Module = { code: ModuleCode; family: "DELIVERY" | "ERRAND" | "HOME"; emoji: string; label: string; hint: string; built: boolean; state: State; sortOrder: number };

const FAMILIES = [
  { key: "DELIVERY", title: "Livraison et transport" },
  { key: "ERRAND", title: "Achat et livraison" },
  { key: "HOME", title: "Services à domicile" },
] as const;

export default function ServicesPage() {
  const t = useT();
  const text = useModuleText();
  const { data, error, reload } = useAdmin<Module[]>("/services");
  const action = useAction();

  const setState = (m: Module, state: State) => action.run(() => adminFetch(`/services/${m.code}`, { method: "PATCH", body: { state } })).then((ok) => {
      if (ok) reload();
    });
  const move = (m: Module, delta: -1 | 1) => {
    if (!data) return;
    const codes = data.map((x) => x.code);
    const i = codes.indexOf(m.code);
    const j = i + delta;
    if (j < 0 || j >= codes.length) return;
    [codes[i], codes[j]] = [codes[j], codes[i]];
    action.run(() => adminFetch("/services/order", { method: "PUT", body: { codes } })).then((ok) => {
      if (ok) reload();
    });
  };

  const STATES: { value: State; label: string }[] = [
    { value: "ON", label: t("Ouvert") },
    { value: "SOON", label: t("Bientôt") },
    { value: "OFF", label: t("Caché") },
  ];

  const visible = (data ?? []).filter((m) => m.state !== "OFF");

  return (
    <div className="max-w-4xl">
      <PageHeader icon="grid" title="Services" description="Ce que le client voit sous le bouton du milieu. Chaque module s'ouvre ou se coupe sans toucher aux autres." />
      <ErrorNote message={error ?? action.error} />
      {!data ? (
        <Loading />
      ) : (
        <DirectorEdits>
          <Card title="Ce que voient les clients" icon="user">
            {visible.length === 0 ? (
              <p className="text-sm text-stone-600">{t("Aucun module visible : le bouton du milieu disparaît, l'appli garde les repas.")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {visible.map((m) => (
                  <li key={m.code} className={`flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-sm font-medium ${m.state === "ON" ? "bg-emerald-50 text-emerald-900" : "bg-stone-100 text-stone-500"}`}>
                    <span aria-hidden="true">{m.emoji}</span>
                    {text(m).short}
                    {m.state === "SOON" && <span className="text-[11px] font-bold uppercase">· {t("Bientôt")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {FAMILIES.map((f) => {
            const rows = data.filter((m) => m.family === f.key);
            if (!rows.length) return null;
            return (
              <Card key={f.key} title={f.title}>
                <ul className="divide-y divide-stone-100">
                  {rows.map((m) => {
                    const index = data.indexOf(m);
                    return (
                      <li key={m.code} className="flex flex-wrap items-center gap-3 py-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-[22px]" aria-hidden="true">
                          {m.emoji}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {text(m).label}
                            {!m.built && <span className="ml-2 rounded-[6px] bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-900">{t("En préparation")}</span>}
                          </p>
                          <p className="text-sm text-stone-500">
                            {m.code === "RIDE" ? t("Suit le réglage « Mode Zed ».") : m.code === "PARCEL" ? t("Coupé, l'appli et l'API refusent les nouveaux colis.") : text(m).hint}
                          </p>
                        </div>
                        <div role="radiogroup" aria-label={t("État de {name}", { name: text(m).short })} className="flex gap-1 rounded-[10px] bg-stone-100 p-1">
                          {STATES.map((s) => {
                            const on = m.state === s.value;
                            const locked = s.value === "ON" && !m.built;
                            return (
                              <button
                                key={s.value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                disabled={locked}
                                title={locked ? t("Pas encore prêt") : undefined}
                                onClick={() => !on && setState(m, s.value)}
                                className={`min-h-9 rounded-[8px] px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                  on ? (s.value === "ON" ? "bg-emerald-600 text-white" : s.value === "SOON" ? "bg-surface text-amber-800 shadow-sm" : "bg-surface text-stone-700 shadow-sm") : "text-stone-500"
                                }`}
                              >
                                {s.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => move(m, -1)} disabled={index === 0} aria-label={t("Monter")} className="grid h-9 w-9 place-items-center rounded-[8px] border border-stone-200 text-stone-600 disabled:opacity-30">
                            <Icon name="chevron" className="h-4 w-4 -rotate-90" />
                          </button>
                          <button type="button" onClick={() => move(m, 1)} disabled={index === data.length - 1} aria-label={t("Descendre")} className="grid h-9 w-9 place-items-center rounded-[8px] border border-stone-200 text-stone-600 disabled:opacity-30">
                            <Icon name="chevron" className="h-4 w-4 rotate-90" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </DirectorEdits>
      )}
    </div>
  );
}
