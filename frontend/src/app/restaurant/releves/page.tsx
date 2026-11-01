"use client";

import DataTable from "@/components/panel/DataTable";
import { Card, ErrorNote, Loading, PageHeader, StatTile } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import type { Settlement } from "@/lib/restaurant";
import { useRestaurant } from "../useRestaurant";
import { currentLang, dateLocale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

type Movement = { kind: "DEPOSIT" | "ORDER"; id: string; at: string; amount: number; note: string | null; code: string | null };
type Deposit = { active: boolean; deposited: number; consumed: number; balance: number; low: boolean; threshold: number; movements: Movement[] };
type Data = {
  settlements: Settlement[];
  pending: { orders: number; sales: number; commission: number; amountDue: number };
  subscriptionFee?: number | null;
  deposit?: Deposit;
};

const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(currentLang()), { timeZone: "UTC" });

export default function RestaurantSettlementsPage() {
  const { data, error } = useRestaurant<Data>("/settlements");
  const t = useT();
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader icon="wallet" title="Relevés" count={data.settlements.length} description="Ce que Zedeka vous doit pour les commandes livrées, et les versements déjà faits. Les retraits payés au comptoir n'y figurent pas : vous les avez encaissés." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Commandes à régler" value={data.pending.orders} hint="livrées, pas encore versées" />
        <StatTile label="Ventes" value={fcfa(data.pending.sales)} />
        {data.pending.commission > 0 || !data.subscriptionFee ? (
          <StatTile label="Commission Zedeka" value={fcfa(data.pending.commission)} />
        ) : (
          <StatTile label="Abonnement Zedeka" value={`${fcfa(data.subscriptionFee)}/${t("mois")}`} hint="aucune commission sur vos ventes" />
        )}
        <StatTile label="À vous verser" value={fcfa(data.pending.amountDue)} />
      </div>

      {data.deposit?.active && <DepositCard deposit={data.deposit} />}

      <Card title="Historique des relevés" icon="receipt">
        <DataTable
          rows={data.settlements}
          rowKey={(s) => s.id}
          empty="Aucun relevé pour le moment. Zedeka établit les relevés depuis son espace finances."
          columns={[
            { header: "Période", mobile: "title", cell: (s) => t("{from} au {to}", { from: day(s.periodStart), to: day(s.periodEnd) }) },
            {
              header: "Statut",
              mobile: "badge",
              cell: (s) =>
                s.paidAt ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">{t("Versé le {date}", { date: day(s.paidAt) })}</span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{t("À verser")}</span>
                ),
            },
            { header: "Commandes", cell: (s) => s.orderCount },
            { header: "Ventes", align: "right", cell: (s) => fcfa(s.orderTotal) },
            { header: "Commission", align: "right", cell: (s) => fcfa(s.commission) },
            { header: "Montant", align: "right", cell: (s) => <span className="font-semibold">{fcfa(s.amountDue)}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

// Dépôt Zedeka : l'argent laissé par Zedeka, sur lequel le restaurant se paie les plats des commandes livrées.
function DepositCard({ deposit }: { deposit: Deposit }) {
  const t = useT();
  return (
    <Card title="Dépôt Zedeka" icon="wallet">
      <p className={`text-2xl font-bold ${deposit.low ? "text-red-700" : ""}`}>{fcfa(deposit.balance)}</p>
      <p className="mb-3 text-sm text-stone-600">
        {deposit.low
          ? t("Solde bas : Zedeka va recharger votre dépôt.")
          : t("Pour chaque commande livrée, prenez le prix des plats sur cette somme. Zedeka la recharge.")}
      </p>
      <ul className="divide-y divide-stone-100 text-sm">
        {deposit.movements.map((m) => (
          <li key={`${m.kind}-${m.id}`} className="flex justify-between gap-2 py-1.5">
            <span>
              {day(m.at)} · {m.kind === "ORDER" ? t("Commande {code}", { code: m.code ?? "" }) : (m.note ?? (m.amount >= 0 ? t("Dépôt Zedeka") : t("Correction")))}
            </span>
            <span className={m.amount < 0 ? "" : "font-semibold text-emerald-700"}>
              {m.amount > 0 ? "+" : ""}
              {fcfa(m.amount)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
