"use client";

import Link from "next/link";
import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { button, Card, Empty, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

export type Company = {
  id: string;
  name: string;
  kind: "OFFICE" | "SCHOOL";
  contactName: string;
  phone: string;
  email: string | null;
  address: string;
  taxId: string | null;
  monthlyLimit: number;
  active: boolean;
  members?: number;
  spentThisMonth: number;
};

// Comptes entreprise (bureaux, écoles) : leurs membres commandent « facturé à l'entreprise », une facture par mois.
export default function CompaniesPage() {
  const t = useT();
  const { data, error, reload } = useAdmin<Company[]>("/companies");
  const action = useAction();
  const [form, setForm] = useState({ name: "", kind: "OFFICE", contactName: "", phone: "", email: "", address: "", monthlyLimit: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const ok = await action.run(() => adminFetch("/companies", { method: "POST", body: { ...form, monthlyLimit: Number(form.monthlyLimit || 0) } }));
    if (ok) {
      setForm({ name: "", kind: "OFFICE", contactName: "", phone: "", email: "", address: "", monthlyLimit: "" });
      void reload();
    }
  }

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader icon="team" title="Entreprises" count={data?.length} description="Bureaux et écoles : leurs membres commandent sans payer à la livraison, la facture tombe chaque mois." />
      <ErrorNote message={error ?? action.error} />
      <Card title="Comptes" icon="team">
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty>{t("Aucune entreprise pour l'instant")}</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/entreprises/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span>
                    <span className="font-semibold">
                      {c.kind === "SCHOOL" ? "🏫" : "🏢"} {c.name}
                    </span>
                    {!c.active && <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs">{t("Désactivée")}</span>}
                    <span className="block text-sm text-stone-600">
                      {t("{n} membres", { n: c.members ?? 0 })} · {c.contactName} {c.phone}
                    </span>
                  </span>
                  <span className="text-sm">
                    {t("Ce mois : {amount}", { amount: fcfa(c.spentThisMonth) })}
                    {c.monthlyLimit > 0 && <span className="text-stone-500"> / {fcfa(c.monthlyLimit)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Nouvelle entreprise" icon="plus">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          <input required value={form.name} onChange={set("name")} placeholder={t("Nom (ex. Ecobank Lomé, École Les Rosiers)")} className={input} />
          <select value={form.kind} onChange={set("kind")} className={input} aria-label={t("Type")}>
            <option value="OFFICE">{t("Bureau")}</option>
            <option value="SCHOOL">{t("École")}</option>
          </select>
          <input value={form.contactName} onChange={set("contactName")} placeholder={t("Contact (nom)")} className={input} />
          <input value={form.phone} onChange={set("phone")} placeholder={t("Téléphone du contact")} className={input} />
          <input type="email" value={form.email} onChange={set("email")} placeholder={t("E-mail pour la facture")} className={input} />
          <input value={form.address} onChange={set("address")} placeholder={t("Adresse")} className={input} />
          <input inputMode="numeric" value={form.monthlyLimit} onChange={set("monthlyLimit")} placeholder={t("Plafond mensuel en FCFA (vide : aucun)")} className={input} />
          <button type="submit" className={button}>
            {t("Créer")}
          </button>
        </form>
      </Card>
    </div>
  );
}
