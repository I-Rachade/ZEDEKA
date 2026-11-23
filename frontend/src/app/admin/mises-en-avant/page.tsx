"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Publicité dans l'appli : un restaurant ou une boutique paie pour être mis en avant (en tête des listes, badge
// « Sponsorisé »), à la semaine. L'équipe encaisse puis active ici ; la mise en avant s'arrête seule à la date de fin.

type Commerce = { id: string; name: string; slug: string; kind: string; logoUrl: string | null; sponsoredUntil: string | null; sponsored: boolean };
type Payment = { id: string; amount: number; weeks: number; endsAt: string; createdBy: string | null; createdAt: string; restaurant: { name: string } };
type Data = { weekFee: number; commerces: Commerce[]; payments: Payment[] };

function Extend({ c, weekFee, onDone }: { c: Commerce; weekFee: number; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const action = useAction();
  const [weeks, setWeeks] = useState(1);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await action.run(async () => {
          await adminFetch(`/sponsors/${c.id}`, { method: "POST", body: { weeks } });
          await onDone();
        });
      }}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <label>
        <span className="block text-stone-600">{t("Semaines")}</span>
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className={`${input} w-20`}>
          {[1, 2, 4, 8, 12].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button className={button}>{t("Encaisser {amount} et mettre en avant", { amount: fcfa(weekFee * weeks) })}</button>
      <ErrorNote message={action.error} />
    </form>
  );
}

export default function SponsorsPage() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useAdmin<Data>("/sponsors");
  const action = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const live = data.commerces.filter((c) => c.sponsored);
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const others = data.commerces.filter((c) => !c.sponsored && (!q || fold(c.name).includes(fold(q))));
  const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const cashed = data.payments.filter((p) => new Date(p.createdAt) >= month).reduce((s, p) => s + p.amount, 0);

  const row = (c: Commerce) => (
    <li key={c.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-semibold">{c.name}</span> <span className="text-xs text-stone-500">· {c.kind === "SHOP" ? t("Boutique") : t("Restaurant")}</span>
          {c.sponsored && c.sponsoredUntil && <span className="block text-xs text-emerald-700">{t("En avant jusqu'au {date}", { date: new Date(c.sponsoredUntil).toLocaleDateString(locale) })}</span>}
        </span>
        <span className="flex gap-2">
          <button type="button" className={buttonGhost} onClick={() => setOpen(open === c.id ? null : c.id)}>
            {c.sponsored ? t("Prolonger") : t("Mettre en avant")}
          </button>
          {c.sponsored && (
            <button
              type="button"
              className={buttonGhost}
              onClick={() =>
                action.run(async () => {
                  await adminFetch(`/sponsors/${c.id}/stop`, { method: "POST" });
                  await reload();
                })
              }
            >
              {t("Arrêter")}
            </button>
          )}
        </span>
      </div>
      {open === c.id && (
        <Extend
          c={c}
          weekFee={data.weekFee}
          onDone={async () => {
            setOpen(null);
            await reload();
          }}
        />
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon="globe"
        title="Mises en avant"
        description="Publicité payée par les commerces : en tête de la liste des restaurants ou des boutiques, avec le badge « Sponsorisé ». Prix à la semaine, réglable dans les réglages."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Commerces mis en avant" value={live.length} />
        <StatTile label="Encaissé ce mois" value={fcfa(cashed)} />
        <StatTile label="Prix d'une semaine" value={fcfa(data.weekFee)} />
      </div>
      <ErrorNote message={action.error} />
      <Card title="En avant maintenant">{live.length === 0 ? <Empty>Aucun commerce mis en avant.</Empty> : <ul className="divide-y divide-stone-100">{live.map(row)}</ul>}</Card>
      <Card title="Autres commerces">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Chercher un commerce")} className={input} />
        <ul className="divide-y divide-stone-100">{others.slice(0, 50).map(row)}</ul>
      </Card>
      <Card title="Derniers paiements">
        {data.payments.length === 0 ? (
          <Empty>Aucun paiement.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {data.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 py-2">
                <span>
                  {p.restaurant.name} · {t("{n} semaine(s)", { n: p.weeks })}
                  <span className="block text-xs text-stone-500">
                    {new Date(p.createdAt).toLocaleDateString(locale)} · {p.createdBy ?? ""} · {t("jusqu'au {date}", { date: new Date(p.endsAt).toLocaleDateString(locale) })}
                  </span>
                </span>
                <span className="font-semibold">{fcfa(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
