"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import ItemDialog from "@/app/r/[slug]/ItemDialog";
import { apiGet, fcfa, soldOut, type MenuItem, type Restaurant } from "@/lib/api";
import { customerFetch, useContact, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { addGroupPart, fetchGroup, myPartKeys, rememberPartKey, removeMyPart, type GroupItem, type GroupView } from "@/lib/groupOrders";
import { useT } from "@/lib/i18n/client";

type Pick = GroupItem & { key: string; name: string; unit: number };

// Commande groupée : chacun choisit ses plats et ajoute sa part avec son prénom ; l'organisateur voit tout et envoie
// une seule commande au restaurant.
export default function GroupOrderPage() {
  const t = useT();
  const { code } = useParams<{ code: string }>();
  const hydrated = useHydrated();
  const session = useSession();
  const contact = useContact();
  const [group, setGroup] = useState<GroupView | null | undefined>(undefined);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [host, setHost] = useState(false);
  const [opened, setOpened] = useState<MenuItem | null>(null);
  const [mine, setMine] = useState<Pick[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ orderCode: string; total: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => fetchGroup(code).then((g) => setGroup(g ?? null), () => setGroup(null)), [code]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (group?.restaurant && !restaurant) apiGet<Restaurant>(`/api/restaurants/${encodeURIComponent(group.restaurant.slug)}`).then(setRestaurant, () => {});
  }, [group, restaurant]);
  useEffect(() => {
    if (!session) return;
    setName((n) => n || (session.name ?? "").split(" ")[0]);
    customerFetch<{ code: string }[]>("/group-orders").then((list) => setHost(list.some((g) => g.code === group?.code)), () => {});
  }, [session, group?.code]);
  useEffect(() => {
    if (!session && contact?.name) setName((n) => n || contact.name.split(" ")[0]);
  }, [session, contact]);

  const categories = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of restaurant?.menuItems ?? []) map.set(item.category, [...(map.get(item.category) ?? []), item]);
    return [...map.entries()];
  }, [restaurant]);

  if (!hydrated || group === undefined) return null;
  if (group === null)
    return (
      <main className="mx-auto max-w-xl px-4 pt-10 text-center">
        <p className="text-[17px] font-semibold">{t("Commande groupée introuvable")}</p>
        <Link href="/app" className="mt-4 inline-block text-emerald-700">
          {t("Retour à l'accueil")}
        </Link>
      </main>
    );

  const open = group.status === "OPEN" && (!group.deadline || new Date(group.deadline) > new Date());
  const keys = myPartKeys();
  const mySubtotal = mine.reduce((s, p) => s + p.unit * p.quantity, 0);
  const link = typeof window !== "undefined" ? window.location.href : "";

  async function addPart() {
    if (name.trim().length < 2) return setError(t("Indiquez votre prénom"));
    setBusy(true);
    setError(null);
    try {
      const r = await addGroupPart(code, name.trim(), mine.map((p) => ({ menuItemId: p.menuItemId, quantity: p.quantity, variantId: p.variantId, addonIds: p.addonIds, choices: p.choices })));
      rememberPartKey(r.id, r.editKey);
      setMine([]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function hostAction(path: "submit" | "cancel") {
    if (path === "cancel" && !window.confirm(t("Annuler la commande groupée ?"))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await customerFetch<{ orderCode?: string; total?: number }>(`/group-orders/${group!.code}/${path}`, { method: "POST" });
      if (r.orderCode) setSent({ orderCode: r.orderCode, total: r.total ?? 0 });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(id: string) {
    setError(null);
    try {
      if (keys[id]) await removeMyPart(group!.code, id);
      else await customerFetch(`/group-orders/${group!.code}/lines/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 pb-32 pt-4">
      <header className="space-y-1">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-emerald-700">👥 {t("Commande groupée")}</p>
        <h1 className="text-[24px] font-bold leading-tight">{group.restaurant?.name}</h1>
        <p className="text-[14px] text-stone-600">
          {t("Organisée par {name}", { name: group.hostName })} · 📍 {group.address}
          {group.deadline && ` · ${t("jusqu'à {heure}", { heure: group.deadline.slice(11, 16) })}`}
        </p>
        {group.company && <p className="text-[14px] text-sky-800">{t("Facturée à {name}", { name: group.company })}</p>}
      </header>

      {(sent || group.status === "SUBMITTED") && (
        <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold">✓ {t("Commande envoyée au restaurant")}</p>
          {(sent?.orderCode ?? group.orderCode) && (
            <Link href={`/commande/${sent?.orderCode ?? group.orderCode}`} className="mt-2 inline-block font-semibold underline">
              {t("Suivre la commande {code}", { code: sent?.orderCode ?? group.orderCode ?? "" })}
            </Link>
          )}
        </div>
      )}
      {group.status === "CANCELLED" && <p className="rounded-2xl bg-stone-100 p-4">{t("Cette commande groupée a été annulée.")}</p>}

      {host && open && (
        <section className="space-y-2 rounded-2xl bg-sun-soft p-4 text-amber-950">
          <p className="text-[14px] font-semibold">{t("Partagez ce lien pour que chacun ajoute ses plats :")}</p>
          <div className="flex gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(`${t("Commande groupée chez {name} : ajoutez vos plats ici", { name: group.restaurant?.name ?? "" })} ${link}`)}`} target="_blank" rel="noreferrer" className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-center text-[14px] font-semibold text-white">
              WhatsApp
            </a>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {})}
              className="flex-1 rounded-xl border border-amber-900/20 bg-white px-3 py-2.5 text-[14px] font-semibold"
            >
              {copied ? t("Lien copié") : t("Copier le lien")}
            </button>
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="text-[17px] font-semibold">{t("{n} parts", { n: group.lines.length })} · {fcfa(group.subtotal)}</h2>
        {group.lines.length === 0 && <p className="text-sm text-stone-500">{t("Personne n'a encore ajouté de plat.")}</p>}
        <ul className="divide-y divide-stone-100">
          {group.lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 py-2 text-[14px]">
              <span>
                <span className="font-semibold">{l.participant}</span> · {l.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {fcfa(l.subtotal)}
                {open && (keys[l.id] || host) && (
                  <button type="button" onClick={() => removeLine(l.id)} className="text-red-700" aria-label={t("Retirer")}>
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {group.restaurant && group.subtotal < group.restaurant.minOrderAmount && (
          <p className="text-[13px] text-amber-800">{t("Commande minimum du restaurant : {min}", { min: fcfa(group.restaurant.minOrderAmount) })}</p>
        )}
        {host && open && (
          <div className="flex gap-2 pt-2">
            <button type="button" disabled={busy || group.lines.length === 0} onClick={() => hostAction("submit")} className="flex-1 rounded-xl bg-emerald-600 px-3 py-3 font-semibold text-white disabled:opacity-50">
              {t("Envoyer la commande")}
            </button>
            <button type="button" disabled={busy} onClick={() => hostAction("cancel")} className="rounded-xl border border-red-200 px-3 py-3 font-semibold text-red-700">
              {t("Annuler")}
            </button>
          </div>
        )}
      </section>

      {open && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-semibold">{t("Ajouter ma part")}</h2>
          {!restaurant ? (
            <p className="text-sm text-stone-500">{t("Chargement de la carte…")}</p>
          ) : (
            categories.map(([cat, items]) => (
              <div key={cat} className="space-y-1">
                <h3 className="px-1 text-[13px] uppercase tracking-wide text-stone-500">{cat}</h3>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={soldOut(item)}
                    onClick={() => setOpened(item)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl bg-surface px-3 py-3 text-left disabled:opacity-50"
                  >
                    <span className="text-[15px] font-medium">{item.name}</span>
                    <span className="shrink-0 text-[14px]">{fcfa(item.variants.length ? Math.min(...item.variants.map((v) => v.price)) : item.price)}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </section>
      )}

      {opened && (
        <ItemDialog
          key={opened.id}
          item={opened}
          open
          onClose={() => setOpened(null)}
          onAdd={(variantId, addonIds, quantity, choices) => {
            const unit = (opened.variants.find((v) => v.id === variantId)?.price ?? opened.price) + opened.addons.filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price, 0);
            setMine((list) => [...list, { key: `${opened.id}-${list.length}-${Date.now()}`, name: opened.name, unit, menuItemId: opened.id, quantity, variantId, addonIds, ...(choices.length ? { choices } : {}) }]);
            setOpened(null);
          }}
        />
      )}

      {open && mine.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-stone-200 bg-surface p-4 shadow-lg">
          <ul className="max-h-32 overflow-y-auto text-[14px]">
            {mine.map((p) => (
              <li key={p.key} className="flex justify-between gap-2">
                <span>
                  {p.quantity} × {p.name}
                </span>
                <button type="button" onClick={() => setMine((l) => l.filter((x) => x.key !== p.key))} className="text-red-700" aria-label={t("Retirer")}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Votre prénom")} maxLength={40} className="min-w-0 flex-1 rounded-xl border border-stone-200 px-3 py-2.5" />
            <button type="button" disabled={busy} onClick={addPart} className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
              {t("Ajouter · {amount}", { amount: fcfa(mySubtotal) })}
            </button>
          </div>
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
    </main>
  );
}
