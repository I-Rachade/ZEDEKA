"use client";

import { useState } from "react";
import { adminFetch, type AdminRestaurant } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, DirectorEdits, Empty, ErrorNote, Loading, PageHeader, StatTile } from "../ui";
import { useAdmin } from "../useAdmin";

type Promo = {
  id: string;
  code: string;
  title: string | null;
  label: string;
  kind: "PERCENT" | "AMOUNT" | "FREE_DELIVERY";
  value: number;
  payer: "ZEDEKA" | "RESTAURANT";
  restaurant: { id: string; name: string } | null;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  perCustomer: number;
  showOnHome: boolean;
  active: boolean;
  uses: number;
  cost: number;
};
type Data = { summary: { active: number; uses30: number; zedekaCost30: number; share30: number }; promos: Promo[] };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : null);

// Promotions (planche 4) : codes, offre, où, qui paie, période, utilisations et statut ; création dans un panneau.
export default function PromotionsPage() {
  const t = useT();
  const { data, error, reload } = useAdmin<Data>("/promos");
  const restaurants = useAdmin<AdminRestaurant[]>("/restaurants");
  const [open, setOpen] = useState(false);

  async function toggle(p: Promo, patch: Partial<Pick<Promo, "active" | "showOnHome">>) {
    await adminFetch(`/promos/${p.id}`, { method: "PATCH", body: patch });
    await reload();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon="tag"
        title="Promotions"
        description="Codes promo de l'accueil et de la caisse. Le coût apparaît dans le rapport, et sur le relevé du restaurant quand c'est lui qui paie."
        actions={
          <button type="button" onClick={() => setOpen((o) => !o)} className={button}>
            {open ? t("Fermer") : `+ ${t("Nouvelle promotion")}`}
          </button>
        }
      />
      <ErrorNote message={error} />
      {!data ? (
        <Loading />
      ) : (
        <DirectorEdits>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t("actives")} value={data.summary.active} />
            <StatTile label={t("utilisations · 30 j")} value={data.summary.uses30} />
            <StatTile label={t("coût pour Zedeka · 30 j")} value={fcfa(data.summary.zedekaCost30)} />
            <StatTile label={t("des commandes · 30 j")} value={`${data.summary.share30} %`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <Card className={open ? "" : "lg:col-span-2"}>
              {data.promos.length === 0 ? (
                <Empty>{t("Aucune promotion pour le moment.")}</Empty>
              ) : (
                <div className="-mx-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-stone-50 text-[12px] uppercase tracking-wide text-stone-500">
                      <tr>
                        {["Code", "Offre", "Où", "Qui paie", "Période", "Utilisations", "Statut", ""].map((h) => (
                          <th key={h} className="px-4 py-2 font-semibold">
                            {h && t(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.promos.map((p) => (
                        <tr key={p.id} className="border-t border-stone-100 align-top">
                          <td className="px-4 py-3 font-mono font-bold">{p.code}</td>
                          <td className="px-4 py-3">
                            {p.title || p.label}
                            {p.showOnHome && <span className="mt-0.5 block text-[12px] text-emerald-700">{t("Sur l'accueil")}</span>}
                          </td>
                          <td className="px-4 py-3">{p.restaurant?.name ?? t("Tous les restaurants")}</td>
                          <td className="px-4 py-3">{p.payer === "RESTAURANT" ? t("Restaurant") : "Zedeka"}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {day(p.startsAt) || day(p.endsAt) ? `${day(p.startsAt) ?? "…"} → ${day(p.endsAt) ?? "…"}` : t("Sans fin")}
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {p.uses}
                            {p.maxUses ? ` / ${p.maxUses}` : ""}
                            <span className="block text-[12px] text-stone-500">{fcfa(p.cost)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${p.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${p.active ? "bg-emerald-600" : "bg-stone-400"}`} />
                              {p.active ? t("Active") : t("Arrêtée")}
                            </span>
                          </td>
                          <td className="space-x-1 px-4 py-3 text-right whitespace-nowrap">
                            <button type="button" onClick={() => toggle(p, { showOnHome: !p.showOnHome })} className={buttonGhost}>
                              {p.showOnHome ? t("Retirer de l'accueil") : t("Sur l'accueil")}
                            </button>
                            <button type="button" onClick={() => toggle(p, { active: !p.active })} className={buttonGhost}>
                              {p.active ? t("Arrêter") : t("Réactiver")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {open && (
              <NewPromo
                restaurants={restaurants.data ?? []}
                onCreated={async () => {
                  setOpen(false);
                  await reload();
                }}
              />
            )}
          </div>
        </DirectorEdits>
      )}
    </div>
  );
}

function NewPromo({ restaurants, onCreated }: { restaurants: AdminRestaurant[]; onCreated: () => Promise<void> }) {
  const t = useT();
  const [f, setF] = useState({
    code: "",
    title: "",
    kind: "PERCENT" as Promo["kind"],
    value: "20",
    maxDiscount: "2000",
    minSubtotal: "3000",
    restaurantId: "",
    payer: "ZEDEKA" as Promo["payer"],
    endsAt: "",
    maxUses: "",
    perCustomer: "1",
    showOnHome: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v.trim() ? Number(v) : null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/promos", {
        method: "POST",
        body: {
          code: f.code,
          title: f.title || null,
          kind: f.kind,
          value: f.kind === "FREE_DELIVERY" ? 0 : Number(f.value || 0),
          maxDiscount: f.kind === "PERCENT" ? num(f.maxDiscount) : null,
          minSubtotal: Number(f.minSubtotal || 0),
          restaurantId: f.restaurantId || null,
          payer: f.restaurantId ? f.payer : "ZEDEKA",
          endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : null,
          maxUses: num(f.maxUses),
          perCustomer: Number(f.perCustomer || 0),
          showOnHome: f.showOnHome,
        },
      });
      await onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const row = "flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-3 py-2";
  return (
    <Card title="Nouvelle promotion" className="h-fit shadow-[0_20px_50px_-20px_rgb(0_0_0/0.25)]">
      <form onSubmit={create} className="space-y-2 text-sm">
        <label className={row}>
          {t("Code")}
          <input value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required placeholder="NOEL25" className="w-36 text-right font-mono font-bold outline-none" />
        </label>
        <label className={row}>
          {t("Titre sur l'accueil")}
          <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder={t("ex. -25 % pour Noël")} className="w-44 text-right outline-none" />
        </label>
        <label className={row}>
          {t("Type")}
          <select value={f.kind} onChange={(e) => set("kind", e.target.value as Promo["kind"])} className="text-right outline-none">
            <option value="PERCENT">{t("Pourcentage")}</option>
            <option value="AMOUNT">{t("Montant fixe")}</option>
            <option value="FREE_DELIVERY">{t("Livraison offerte")}</option>
          </select>
        </label>
        {f.kind !== "FREE_DELIVERY" && (
          <label className={row}>
            {f.kind === "PERCENT" ? t("Pourcentage") : t("Montant (FCFA)")}
            <input value={f.value} onChange={(e) => set("value", e.target.value)} inputMode="numeric" className="w-24 text-right outline-none" />
          </label>
        )}
        {f.kind === "PERCENT" && (
          <label className={row}>
            {t("Plafond (FCFA)")}
            <input value={f.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} inputMode="numeric" className="w-24 text-right outline-none" />
          </label>
        )}
        <label className={row}>
          {t("Minimum de commande (FCFA)")}
          <input value={f.minSubtotal} onChange={(e) => set("minSubtotal", e.target.value)} inputMode="numeric" className="w-24 text-right outline-none" />
        </label>
        <label className={row}>
          {t("Où")}
          <select value={f.restaurantId} onChange={(e) => set("restaurantId", e.target.value)} className="max-w-[60%] text-right outline-none">
            <option value="">{t("Tous les restaurants")}</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {f.restaurantId && (
          <label className={row}>
            {t("Qui paie")}
            <select value={f.payer} onChange={(e) => set("payer", e.target.value as Promo["payer"])} className="text-right outline-none">
              <option value="ZEDEKA">Zedeka</option>
              <option value="RESTAURANT">{t("Le restaurant")}</option>
            </select>
          </label>
        )}
        <label className={row}>
          {t("Jusqu'au")}
          <input type="date" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} className="text-right outline-none" />
        </label>
        <label className={row}>
          {t("Utilisations au plus")}
          <input value={f.maxUses} onChange={(e) => set("maxUses", e.target.value)} inputMode="numeric" placeholder={t("sans limite")} className="w-28 text-right outline-none" />
        </label>
        <label className={row}>
          {t("Par client")}
          <input value={f.perCustomer} onChange={(e) => set("perCustomer", e.target.value)} inputMode="numeric" className="w-16 text-right outline-none" />
        </label>
        <label className={row}>
          {t("Afficher sur l'accueil")}
          <input type="checkbox" checked={f.showOnHome} onChange={(e) => set("showOnHome", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
        </label>
        <ErrorNote message={error} />
        <button type="submit" disabled={busy} className={`${button} w-full py-3 text-base`}>
          {busy ? "…" : t("Créer")}
        </button>
      </form>
    </Card>
  );
}
