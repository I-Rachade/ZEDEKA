"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Zedeka+ : abonnement des clients (livraison des repas offerte ou réduite pour un prix fixe par mois).
// Le client demande l'abonnement dans l'appli, l'équipe l'appelle, encaisse (mobile money ou espèces) et l'active ici.

type Member = { id: string; name: string | null; phone: string; plusUntil: string | null; plusRequestedAt: string | null; active?: boolean };
type Payment = { id: string; amount: number; months: number; method: string; reference: string | null; endsAt: string; createdBy: string | null; createdAt: string; customer: { name: string | null; phone: string } };
type Data = {
  settings: { plusEnabled: boolean; plusMonthlyFee: number; plusDeliveryDiscount: number; plusMinSubtotal: number };
  requests: Member[];
  members: Member[];
  found: Member[];
  payments: Payment[];
  stats: { members: number; cashedThisMonth: number; ordersThisMonth: number; discountThisMonth: number };
};
const METHOD: Record<string, string> = { CASH: "Espèces", FLOOZ: "Flooz", TMONEY: "T-Money" };

function Activate({ m, fee, onDone }: { m: Member; fee: number; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const action = useAction();
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await action.run(async () => {
          await adminFetch(`/plus/${m.id}/payments`, { method: "POST", body: { months, method, reference: reference || undefined } });
          await onDone();
        });
      }}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <label>
        <span className="block text-stone-600">{t("Mois")}</span>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className={`${input} w-20`}>
          {[1, 2, 3, 6, 12].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="block text-stone-600">{t("Paiement")}</span>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${input} w-32`}>
          {Object.entries(METHOD).map(([k, v]) => (
            <option key={k} value={k}>
              {t(v)}
            </option>
          ))}
        </select>
      </label>
      {method !== "CASH" && (
        <label>
          <span className="block text-stone-600">{t("Référence")}</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} className={`${input} w-36`} />
        </label>
      )}
      <button className={button}>{t("Encaisser {amount} et activer", { amount: fcfa(fee * months) })}</button>
      <ErrorNote message={action.error} />
    </form>
  );
}

function Row({ m, fee, onDone, children }: { m: Member; fee: number; onDone: () => Promise<void>; children?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-semibold">{m.name ?? t("Client")}</span> · <a href={`tel:${m.phone}`}>{m.phone}</a>
          {m.plusUntil && new Date(m.plusUntil) > new Date() && (
            <span className="block text-xs text-emerald-700">{t("Abonné jusqu'au {date}", { date: new Date(m.plusUntil).toLocaleDateString(locale) })}</span>
          )}
          {m.plusRequestedAt && <span className="block text-xs text-amber-700">{t("Demande du {date}", { date: new Date(m.plusRequestedAt).toLocaleDateString(locale) })}</span>}
        </span>
        <span className="flex gap-2">
          <a href={`https://wa.me/${m.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className={buttonGhost}>
            WhatsApp
          </a>
          <button type="button" onClick={() => setOpen((o) => !o)} className={buttonGhost}>
            {m.plusUntil && new Date(m.plusUntil) > new Date() ? t("Prolonger") : t("Activer")}
          </button>
          {children}
        </span>
      </div>
      {open && (
        <Activate
          m={m}
          fee={fee}
          onDone={async () => {
            setOpen(false);
            await onDone();
          }}
        />
      )}
    </li>
  );
}

export default function PlusPage() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data, error, reload } = useAdmin<Data>(`/plus${search ? `?q=${encodeURIComponent(search)}` : ""}`);
  const action = useAction();
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  const fee = data.settings.plusMonthlyFee;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="tag"
        title="Zedeka+"
        description="Abonnement des clients : livraison des repas offerte ou réduite pour un prix fixe par mois. Le client demande dans l'appli ; l'équipe encaisse puis active ici."
      />
      {!data.settings.plusEnabled && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Zedeka+ est coupé dans les réglages : les clients ne le voient pas.")}</p>}
      <p className="text-sm text-stone-600">
        {data.settings.plusDeliveryDiscount >= 100
          ? t("Offre actuelle : {fee} par mois, livraison offerte dès {min} de panier.", { fee: fcfa(fee), min: fcfa(data.settings.plusMinSubtotal) })
          : t("Offre actuelle : {fee} par mois, livraison à -{pct} % dès {min} de panier.", { fee: fcfa(fee), pct: data.settings.plusDeliveryDiscount, min: fcfa(data.settings.plusMinSubtotal) })}{" "}
        <Link href="/admin/reglages#fidelite" className="underline">
          {t("Modifier dans les réglages")}
        </Link>
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Abonnés" value={data.stats.members} />
        <StatTile label="Encaissé ce mois" value={fcfa(data.stats.cashedThisMonth)} />
        <StatTile label="Commandes avec Zedeka+ ce mois" value={data.stats.ordersThisMonth} />
        <StatTile label="Remises Zedeka+ ce mois" value={fcfa(data.stats.discountThisMonth)} />
      </div>

      <Card title="Demandes à rappeler">
        {data.requests.length === 0 ? (
          <Empty>Aucune demande en attente.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.requests.map((m) => (
              <Row key={m.id} m={m} fee={fee} onDone={reload}>
                <button
                  type="button"
                  className={buttonGhost}
                  onClick={() =>
                    action.run(async () => {
                      await adminFetch(`/plus/${m.id}/request`, { method: "DELETE" });
                      await reload();
                    })
                  }
                >
                  {t("Écarter")}
                </button>
              </Row>
            ))}
          </ul>
        )}
        <ErrorNote message={action.error} />
      </Card>

      <Card title="Abonner un client">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
          className="flex gap-2"
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Téléphone ou nom (3 caractères au moins)")} className={input} />
          <button className={button}>{t("Chercher")}</button>
        </form>
        {search && data.found.length === 0 && <Empty>Aucun client trouvé.</Empty>}
        <ul className="divide-y divide-stone-100">
          {data.found.map((m) => (
            <Row key={m.id} m={m} fee={fee} onDone={reload} />
          ))}
        </ul>
      </Card>

      <Card title="Abonnés">
        {data.members.length === 0 ? (
          <Empty>Aucun abonné pour le moment.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.members.map((m) => (
              <Row key={m.id} m={m} fee={fee} onDone={reload}>
                <button
                  type="button"
                  className={buttonGhost}
                  onClick={() =>
                    action.run(async () => {
                      await adminFetch(`/plus/${m.id}/stop`, { method: "POST" });
                      await reload();
                    })
                  }
                >
                  {t("Arrêter")}
                </button>
              </Row>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Derniers paiements">
        {data.payments.length === 0 ? (
          <Empty>Aucun paiement.</Empty>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {data.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {p.customer.name ?? p.customer.phone} · {t("{n} mois", { n: p.months })} · {t(METHOD[p.method] ?? p.method)}
                  {p.reference ? ` (${p.reference})` : ""}
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
