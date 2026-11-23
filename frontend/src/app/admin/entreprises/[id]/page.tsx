"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import type { Company } from "../page";

type Member = { id: string; phone: string; name: string; active: boolean };
type Detail = Company & { members: Member[]; invoices: { month: string; total: number; orders: number; paidAt: string | null }[]; currentMonth: string };
type Invoice = {
  number: string;
  month: string;
  closed: boolean;
  paidAt: string | null;
  paidNote: string | null;
  count: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  company: Company;
  orders: { code: string; deliveredAt: string; customerName: string; customerPhone: string; total: number; restaurant: { name: string } | null; items: { name: string; quantity: number }[] }[];
};

const lastMonths = (from: string, n = 12) => {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
};

// Fiche entreprise : coordonnées, membres (numéros autorisés à facturer), factures mensuelles imprimables.
export default function CompanyPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useAdmin<Detail>(`/companies/${id}`);
  const action = useAction();
  const [phone, setPhone] = useState("");
  const [memberName, setMemberName] = useState("");
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? data?.currentMonth ?? null;
  const invoice = useAdmin<Invoice>(shown ? `/companies/${id}/invoices/${shown}` : `/companies/${id}/invoices/0000-01`);

  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  const patch = (body: unknown) => action.run(() => adminFetch(`/companies/${id}`, { method: "PATCH", body })).then((ok) => void (ok && reload()));
  const inv = shown && invoice.data?.month === shown ? invoice.data : null;

  return (
    <div className="max-w-5xl space-y-4">
      <div className="print:hidden">
        <Link href="/admin/entreprises" className="text-sm text-emerald-700">
          ← {t("Entreprises")}
        </Link>
        <PageHeader
          icon="team"
          title={data.name}
          description={`${data.contactName} · ${data.phone} · ${data.email ?? ""} · ${data.address}`}
          actions={
            <button type="button" className={buttonGhost} onClick={() => patch({ active: !data.active })}>
              {data.active ? t("Désactiver") : t("Réactiver")}
            </button>
          }
        />
        <ErrorNote message={action.error} />
        <p className="mb-3 text-sm">
          {t("Ce mois : {amount}", { amount: fcfa(data.spentThisMonth) })}
          {data.monthlyLimit > 0 && ` / ${fcfa(data.monthlyLimit)}`}{" "}
          <button
            type="button"
            className="text-emerald-700 underline"
            onClick={() => {
              const v = window.prompt(t("Plafond mensuel en FCFA (0 : aucun)"), String(data.monthlyLimit));
              if (v !== null && /^\d+$/.test(v.trim())) void patch({ monthlyLimit: Number(v.trim()) });
            }}
          >
            {t("Modifier le plafond")}
          </button>
        </p>

        <Card title="Membres" icon="user">
          <form
            className="mb-3 flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await action.run(() => adminFetch(`/companies/${id}/members`, { method: "POST", body: { phone, name: memberName } }));
              if (ok) {
                setPhone("");
                setMemberName("");
                void reload();
              }
            }}
          >
            <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("Numéro (8 chiffres)")} className={`${input} w-44`} />
            <input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder={t("Nom")} className={`${input} w-56`} />
            <button type="submit" className={button}>
              {t("Ajouter")}
            </button>
          </form>
          {data.members.length === 0 ? (
            <Empty>{t("Ajoutez les numéros autorisés à commander pour l'entreprise.")}</Empty>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {data.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <span className={m.active ? "" : "text-stone-400 line-through"}>
                    {m.name || t("Sans nom")} · {m.phone}
                  </span>
                  <button
                    type="button"
                    className={buttonGhost}
                    onClick={() => action.run(() => adminFetch(`/companies/${id}/members/${m.id}`, { method: "PATCH", body: { active: !m.active } })).then((ok) => void (ok && reload()))}
                  >
                    {m.active ? t("Retirer") : t("Réactiver")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Facture mensuelle" icon="receipt">
        <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          <select value={shown ?? ""} onChange={(e) => setMonth(e.target.value)} className={`${input} w-40`} aria-label={t("Mois")}>
            {lastMonths(data.currentMonth).map((m) => (
              <option key={m} value={m}>
                {m}
                {data.invoices.find((i) => i.month === m)?.paidAt ? ` ✓ ${t("payée")}` : ""}
              </option>
            ))}
          </select>
          <button type="button" className={buttonGhost} onClick={() => window.print()}>
            {t("Imprimer")}
          </button>
          {inv && inv.closed && (
            <button
              type="button"
              className={buttonGhost}
              onClick={() =>
                action
                  .run(() => adminFetch(`/companies/${id}/invoices/${inv.month}/paid`, { method: "POST", body: { paid: !inv.paidAt } }))
                  .then((ok) => void (ok && (invoice.reload(), reload())))
              }
            >
              {inv.paidAt ? t("Marquer non payée") : t("Marquer payée")}
            </button>
          )}
        </div>
        {!inv ? (
          <Loading />
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <p className="text-lg font-bold">Zedeka</p>
                <p>{t("Facture {number}", { number: inv.number })}</p>
                <p>{t("Période : {month}", { month: inv.month })}</p>
                {!inv.closed && <p className="text-amber-700">{t("Mois en cours : montant provisoire")}</p>}
                {inv.paidAt && <p className="font-semibold text-emerald-700">✓ {t("Payée le {date}", { date: new Date(inv.paidAt).toLocaleDateString("fr-FR") })}</p>}
              </div>
              <div className="text-right">
                <p className="font-semibold">{inv.company.name}</p>
                <p>{inv.company.address}</p>
                {inv.company.taxId && <p>NIF {inv.company.taxId}</p>}
                <p>{inv.company.email}</p>
              </div>
            </div>
            {inv.orders.length === 0 ? (
              <Empty>{t("Aucune commande livrée ce mois")}</Empty>
            ) : (
              <table className="w-full text-left">
                <thead className="text-stone-500">
                  <tr>
                    <th className="py-1">{t("Date")}</th>
                    <th>{t("Commande")}</th>
                    <th>{t("Pour")}</th>
                    <th>{t("Détail")}</th>
                    <th className="text-right">{t("Montant")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {inv.orders.map((o) => (
                    <tr key={o.code}>
                      <td className="py-1.5">{new Date(o.deliveredAt).toLocaleDateString("fr-FR")}</td>
                      <td>{o.code}</td>
                      <td>{o.customerName}</td>
                      <td>
                        {o.restaurant?.name} · {o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}
                      </td>
                      <td className="text-right">{fcfa(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="ml-auto max-w-xs space-y-1">
              <p className="flex justify-between">
                <span>{t("Repas")}</span>
                <span>{fcfa(inv.subtotal)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t("Livraisons")}</span>
                <span>{fcfa(inv.deliveryFee)}</span>
              </p>
              <p className="flex justify-between text-base font-bold">
                <span>{t("Total ({n} commandes)", { n: inv.count })}</span>
                <span>{fcfa(inv.total)}</span>
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
