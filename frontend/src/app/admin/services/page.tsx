"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { Icon } from "@/components/panel/icons";
import { useModuleText, type ModuleCode } from "@/lib/services";
import { buttonGhost, Card, DirectorEdits, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Modules du bouton « Services » de l'appli client. Chaque module se règle seul : Ouvert (proposé aux clients),
// Bientôt (tuile grisée, non cliquable) ou Caché. Les cinq services à la demande ont aussi leur tarif ici.
// La course Zed suit le réglage « Mode Zed » ; couper le colis bloque aussi les nouveaux colis dans l'API.

type State = "ON" | "SOON" | "OFF";
type Price = { base: number; unit: number; unitLabel: string | null };
type Module = { code: ModuleCode; family: "DELIVERY" | "ERRAND" | "HOME"; emoji: string; label: string; hint: string; built: boolean; state: State; sortOrder: number; price: Price | null };

// Tarif d'un service : base + prix par unité (article, sac, heure). Enregistré au clic.
function PriceEditor({ m, onSave }: { m: Module & { price: Price }; onSave: (base: number, unit: number) => Promise<unknown> }) {
  const t = useT();
  const [base, setBase] = useState(String(m.price.base));
  const [unit, setUnit] = useState(String(m.price.unit));
  const changed = Number(base) !== m.price.base || Number(unit) !== m.price.unit;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Number(base) || 0, Number(unit) || 0);
      }}
      className="flex w-full flex-wrap items-center gap-2 pl-14 text-sm"
      aria-label={t("Tarif de {name}", { name: m.label })}
    >
      <span className="text-stone-500">{t("Tarif")}</span>
      <input aria-label={t("Base")} type="number" min={0} max={100000} step={100} value={base} onChange={(e) => setBase(e.target.value)} className={`${input} w-28`} />
      {m.price.unitLabel && (
        <>
          <span className="text-stone-500">+</span>
          <input aria-label={t("Prix par {unit}", { unit: m.price.unitLabel })} type="number" min={0} max={100000} step={100} value={unit} onChange={(e) => setUnit(e.target.value)} className={`${input} w-28`} />
          <span className="text-stone-500">/ {t(m.price.unitLabel)}</span>
        </>
      )}
      <span className="text-stone-500">FCFA</span>
      {changed ? (
        <button type="submit" className={buttonGhost}>
          {t("Enregistrer")}
        </button>
      ) : (
        <span className="text-[12px] text-stone-400">{m.price.unitLabel ? t("ex. 2 × : {total}", { total: fcfa(m.price.base + 2 * m.price.unit) }) : null}</span>
      )}
    </form>
  );
}

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
  const savePrice = (m: Module, basePrice: number, unitPrice: number) =>
    action.run(() => adminFetch(`/services/${m.code}`, { method: "PATCH", body: { basePrice, unitPrice } })).then((ok) => {
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
      <PageHeader
        icon="grid"
        title="Services"
        description="Ce que le client voit sous le bouton du milieu. Chaque module s'ouvre ou se coupe sans toucher aux autres."
        actions={
          <Link href="/admin/services/demandes" className={buttonGhost}>
            {t("Demandes et prestataires")}
          </Link>
        }
      />
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
                            {m.code === "RIDE" ? t("Suit le réglage « Mode Zed ».") : m.code === "PARCEL" ? t("Coupé, l'appli et l'API refusent les nouveaux colis.") : `${text(m).hint} ${t("Coupé, les nouvelles demandes sont refusées.")}`}
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
                        {m.price && <PriceEditor key={`${m.price.base}-${m.price.unit}`} m={m as Module & { price: Price }} onSave={(base, unit) => savePrice(m, base, unit)} />}
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
