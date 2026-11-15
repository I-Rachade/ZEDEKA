"use client";

import FavoriteLinks from "../FavoriteLinks";
import { askConfirm } from "@/components/AlertDialog";
import { useEffect, useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, roleOf, telLink, useStaff, whatsappLink } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, ErrorNote, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { STORE_STATUS_LABEL, type StoresList, type StoreStatus } from "./store";

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
  const [tab, setTab] = useState<"boutiques" | "vente" | "reversements">("boutiques");
  // Lien « /admin/marchands?onglet=vente » (notification, retour de la fiche d'une boutique).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("onglet") === "vente") setTab("vente");
  }, []);
  const stores = useAdmin<StoresList>("/stores");
  const toValidate = stores.data?.stores.filter((s) => s.status === "PENDING").length ?? 0;
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
            { value: "vente" as const, label: toValidate ? `${t("Vente en ligne")} · ${toValidate} ${t("à valider")}` : "Vente en ligne", count: stores.data?.stores.length },
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
        {tab === "vente" && <OnlineStores list={stores.data} error={stores.error} />}
        {tab === "reversements" && <Payouts />}
      </Card>
      <div className="mt-4">
        <FavoriteLinks query="" kind="MERCHANT" title="Livreurs favoris des boutiques" />
      </div>
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

// Boutiques qui ont demandé la vente en ligne : à valider d'abord, puis en ligne, refusées et suspendues.
function OnlineStores({ list, error }: { list: StoresList | null; error: string | null }) {
  const t = useT();
  if (!list) return error ? <ErrorNote message={error} /> : <Loading />;
  const order: StoreStatus[] = ["PENDING", "ONLINE", "REJECTED", "SUSPENDED"];
  const rows = [...list.stores].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return (
    <DataTable
      rows={rows}
      rowKey={(s) => s.id}
      empty="Aucune demande pour l'instant. Les marchands demandent la mise en ligne depuis l'appli marchand, une fois le module « Boutiques » ouvert dans Services."
      columns={[
        {
          header: "Boutique",
          mobile: "title",
          cell: (s) => (
            <a href={`/admin/marchands/${s.id}`} className="block">
              <span className="font-semibold text-emerald-800 underline-offset-2 hover:underline">{s.shopName}</span>
              <span className="block text-xs text-stone-500">
                {s.owner ?? "–"} · {s.phone}
              </span>
            </a>
          ),
        },
        {
          header: "État",
          mobile: "badge",
          cell: (s) => <span className={`rounded-full px-2 py-1 text-xs font-medium ${STORE_STATUS_LABEL[s.status][1]}`}>{t(STORE_STATUS_LABEL[s.status][0])}</span>,
        },
        {
          header: "Catégorie",
          cell: (s) => {
            const c = list.categories.find((x) => x.key === s.category);
            return c ? `${c.emoji} ${t(c.label)}` : "–";
          },
        },
        { header: "Produits", align: "right", cell: (s) => `${s.products}${s.toReview ? ` · ${s.toReview} ${t("à vérifier")}` : ""}` },
        {
          header: "Facturation",
          cell: (s) => (s.billing.mode === "SUBSCRIPTION" ? `${t("Abonnement")} ${fcfa(s.billing.fee ?? 0)}${t("/mois")}` : `${t("Commission")} ${s.billing.rate} %`),
        },
        {
          header: "",
          cell: (s) => (
            <a className={button} href={`/admin/marchands/${s.id}`}>
              {s.status === "PENDING" ? t("Examiner") : t("Ouvrir")}
            </a>
          ),
        },
      ]}
    />
  );
}
