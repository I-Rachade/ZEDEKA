"use client";

import { askConfirm } from "@/components/AlertDialog";
import { useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, roleOf, telLink, useStaff, whatsappLink } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, ErrorNote, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type MerchantRow = {
  id: string;
  shopName: string;
  phone: string;
  owner: string | null;
  email: string | null;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  pickupDays: number[];
  pickupTime: string | null;
  payoutPhone: string | null;
  active: boolean;
  pickupRequestedAt: string | null;
  createdAt: string;
  sent30d: number;
  open: number;
  balance: number;
  balanceCount: number;
};
type Payout = { id: string; amount: number; orderCount: number; note: string | null; paidBy: string | null; createdAt: string; merchant: { id: string; shopName: string } };

const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

// Boutiques e-commerce de l'appli marchand : envois, ramassage habituel, contre-remboursements à reverser.
export default function MerchantsAdminPage() {
  const t = useT();
  const staff = useStaff();
  const director = roleOf(staff) === "DIRECTOR";
  const [tab, setTab] = useState<"boutiques" | "reversements">("boutiques");
  const { data, error, reload } = useAdmin<MerchantRow[]>("/merchants");
  const { error: actionError, run } = useAction();

  const toPay = data?.filter((m) => m.balanceCount > 0) ?? [];
  const recentPickups = data?.filter((m) => m.pickupRequestedAt && Date.now() - new Date(m.pickupRequestedAt).getTime() < 6 * 3600_000) ?? [];

  async function payout(m: MerchantRow) {
    const sign = m.balance >= 0 ? t("à verser à la boutique") : t("à réclamer à la boutique");
    if (!(await askConfirm(`${m.shopName} : ${fcfa(Math.abs(m.balance))} ${sign} (${m.balanceCount} ${t("colis")}). ${t("Enregistrer le reversement ?")}`, t("Enregistrer")))) return;
    if (await run(() => adminFetch("/finance/merchant-payouts", { method: "POST", body: { merchantId: m.id } }))) reload();
  }
  async function toggle(m: MerchantRow) {
    if (await run(() => adminFetch(`/merchants/${m.id}`, { method: "PATCH", body: { active: !m.active } }))) reload();
  }

  return (
    <div>
      <PageHeader
        icon="bag"
        title="Marchands"
        count={data?.length}
        description="Boutiques en ligne qui envoient leurs colis avec l'appli marchand : contre-remboursement encaissé par le livreur, reversé ici."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Boutiques actives" value={data ? data.filter((m) => m.active).length : "–"} icon="store" />
        <StatTile label="Colis en cours" value={data ? data.reduce((s, m) => s + m.open, 0) : "–"} icon="box" />
        <StatTile label="Ramassages demandés" value={data ? recentPickups.length : "–"} hint="ces 6 dernières heures" icon="rider" />
        <StatTile label="À reverser" value={data ? fcfa(toPay.reduce((s, m) => s + m.balance, 0)) : "–"} hint={`${toPay.length} ${t("boutique(s)")}`} icon="wallet" />
      </div>
      <ErrorNote message={error ?? actionError} />
      <Card>
        <Tabs
          tabs={[
            { value: "boutiques" as const, label: "Boutiques", count: data?.length },
            { value: "reversements" as const, label: "Reversements" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "boutiques" &&
          (!data ? (
            <Loading />
          ) : (
            <DataTable
              rows={data}
              rowKey={(m) => m.id}
              empty="Aucune boutique pour l'instant. Les marchands s'inscrivent depuis l'appli marchand (/marchand)."
              columns={[
                {
                  header: "Boutique",
                  mobile: "title",
                  cell: (m) => (
                    <span>
                      <span className="font-semibold">{m.shopName}</span>
                      <span className="block text-xs text-stone-500">
                        {m.owner ?? "–"} · {m.phone}
                      </span>
                    </span>
                  ),
                },
                {
                  header: "Statut",
                  mobile: "badge",
                  cell: (m) =>
                    m.active ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">{t("Active")}</span>
                    ) : (
                      <span className="rounded-full bg-stone-200 px-2 py-1 text-xs font-medium text-stone-700">{t("Suspendue")}</span>
                    ),
                },
                {
                  header: "Ramassage",
                  cell: (m) => (
                    <span className="text-sm">
                      {m.pickupAddress}
                      <span className="block text-xs text-stone-500">
                        {m.pickupDays.length ? m.pickupDays.map((d) => t(DAYS[d])).join(", ") : t("À la demande")}
                        {m.pickupTime ? ` · ${m.pickupTime}` : ""}
                        {m.pickupRequestedAt && ` · ${t("demandé")} ${formatTime(m.pickupRequestedAt)}`}
                      </span>
                    </span>
                  ),
                },
                { header: "Colis (30 j)", align: "right", cell: (m) => `${m.sent30d} · ${m.open} ${t("en cours")}` },
                {
                  header: "À reverser",
                  align: "right",
                  cell: (m) => (
                    <span className={m.balance < 0 ? "text-red-700" : ""}>
                      {m.balanceCount ? fcfa(m.balance) : "–"}
                      {m.payoutPhone && <span className="block text-xs text-stone-500">{m.payoutPhone}</span>}
                    </span>
                  ),
                },
                {
                  header: "",
                  cell: (m) => (
                    <span className="flex flex-wrap justify-end gap-2">
                      <a className={buttonGhost} href={telLink(m.phone)}>
                        {t("Appeler")}
                      </a>
                      <a className={buttonGhost} href={whatsappLink(m.phone)} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                      <a className={buttonGhost} href={`/admin/commandes?q=${encodeURIComponent(m.shopName)}`}>
                        {t("Colis")}
                      </a>
                      {director && m.balanceCount > 0 && (
                        <button className={button} onClick={() => payout(m)}>
                          {t("Reverser")}
                        </button>
                      )}
                      <button className={buttonGhost} onClick={() => toggle(m)}>
                        {m.active ? t("Suspendre") : t("Réactiver")}
                      </button>
                    </span>
                  ),
                },
              ]}
            />
          ))}
        {tab === "reversements" && <Payouts />}
      </Card>
    </div>
  );
}

function Payouts() {
  const t = useT();
  const { data, error } = useAdmin<Payout[]>("/finance/merchant-payouts");
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <DataTable
      rows={data}
      rowKey={(p) => p.id}
      empty="Aucun reversement pour l'instant."
      columns={[
        { header: "Boutique", mobile: "title", cell: (p) => <span className="font-semibold">{p.merchant.shopName}</span> },
        { header: "Montant", mobile: "badge", align: "right", cell: (p) => <span className={p.amount < 0 ? "text-red-700" : "font-semibold"}>{fcfa(p.amount)}</span> },
        { header: "Colis", align: "right", cell: (p) => p.orderCount },
        { header: "Date", cell: (p) => formatTime(p.createdAt) },
        { header: "Par", cell: (p) => p.paidBy ?? t("Directeur") },
      ]}
    />
  );
}
