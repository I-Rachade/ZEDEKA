"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader } from "@/components/panel/ui";
import { Icon } from "@/components/panel/icons";
import { getRestaurantName, restaurantFetch } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

type Table = { id: string; number: number; token: string };

// Tables numérotées et leurs QR codes. Le client scanne le code posé sur sa table, commande sur place, et la
// commande arrive ici avec le numéro de la table : le restaurant l'apporte, sans livreur.
export default function RestaurantTablesPage() {
  const { data, error, reload } = useRestaurant<Table[]>("/tables");
  const action = useRestaurantAction();
  const [count, setCount] = useState("");
  const [origin, setOrigin] = useState("");
  const [name, setName] = useState("");
  const t = useT();
  useEffect(() => {
    setOrigin(window.location.origin);
    setName(getRestaurantName() ?? "");
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const add = (n: number) =>
    action.run(async () => {
      await restaurantFetch("/tables", { method: "POST", body: { count: n } });
      setCount("");
      await reload();
    });

  return (
    <div className="space-y-4">
      <PageHeader
        icon="qr"
        title="Tables et QR codes"
        count={data.length}
        description="Posez sur chaque table son QR code. Le client le scanne, commande sur place, et la commande arrive ici avec le numéro de la table : apportez-la, sans livreur."
        actions={
          data.length > 0 && (
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> {t("Imprimer tous les QR codes")}
            </button>
          )
        }
      />
      <div className="print:hidden">
        <ErrorNote message={action.error} />
      </div>

      <Card title="Ajouter des tables" icon="plus" className="print:hidden">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(Number(count) || 1);
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="text-sm">
            {t("Nombre de tables")}
            <input type="number" min={1} max={50} required value={count} onChange={(e) => setCount(e.target.value)} placeholder="10" className={`${input} mt-1 w-28`} />
          </label>
          <button className={button}>{t("Ajouter")}</button>
          <p className="w-full text-xs text-stone-500">
            {data.length
              ? t("Les nouvelles tables sont numérotées à la suite (à partir de la table {n}).", { n: Math.max(...data.map((x) => x.number)) + 1 })
              : t("Les tables sont numérotées 1, 2, 3…")}
          </p>
        </form>
      </Card>

      {data.length === 0 ? (
        <Empty>{t("Aucune table pour le moment.")}</Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-6">
          {data.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              url={origin ? `${origin}/t/${table.token}` : ""}
              restaurant={name}
              onRenew={() =>
                window.confirm(t("Créer un nouveau QR code pour la table {number} ? L'ancien ne marchera plus.", { number: table.number })) &&
                action.run(async () => {
                  await restaurantFetch(`/tables/${table.id}/renew`, { method: "POST" });
                  await reload();
                })
              }
              onDelete={() =>
                window.confirm(t("Supprimer la table {number} ? Son QR code ne marchera plus.", { number: table.number })) &&
                action.run(async () => {
                  await restaurantFetch(`/tables/${table.id}`, { method: "DELETE" });
                  await reload();
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TableCard({ table, url, restaurant, onRenew, onDelete }: { table: Table; url: string; restaurant: string; onRenew: () => void; onDelete: () => void }) {
  const [png, setPng] = useState("");
  const t = useT();
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { width: 600, margin: 2 }).then(setPng);
  }, [url]);

  return (
    // Une carte par table, prête à imprimer et à poser sur la table.
    <li className="flex break-inside-avoid flex-col items-center rounded-xl border border-stone-200 bg-white p-4 text-center print:border-2 print:border-stone-800">
      {restaurant && <p className="text-sm font-medium text-stone-600">{restaurant}</p>}
      <p className="text-3xl font-extrabold">{t("Table {number}", { number: table.number })}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- image générée localement (data URL) */}
      {png ? <img src={png} alt={t("QR code de la table {number}", { number: table.number })} className="my-2 h-48 w-48" /> : <div className="my-2 h-48 w-48 animate-pulse rounded bg-stone-100" />}
      <p className="text-sm font-semibold">{t("Scannez pour commander")}</p>
      <p className="text-xs text-stone-500">{t("Nous vous servons à table.")}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2 print:hidden">
        {png && (
          <a href={png} download={`qr-table-${table.number}.png`} className={buttonGhost}>
            <Icon name="download" className="h-4 w-4" /> {t("Télécharger")}
          </a>
        )}
        <button onClick={onRenew} className={buttonGhost} title={t("Nouveau QR code")}>
          <Icon name="refresh" className="h-4 w-4" />
          <span className="sr-only">{t("Nouveau QR code")}</span>
        </button>
        <button onClick={onDelete} className={`${buttonGhost} text-red-700`} title={t("Supprimer la table")}>
          <Icon name="trash" className="h-4 w-4" />
          <span className="sr-only">{t("Supprimer la table")}</span>
        </button>
      </div>
      <p className="mt-2 break-all text-[10px] text-stone-400 print:hidden">{url}</p>
    </li>
  );
}
