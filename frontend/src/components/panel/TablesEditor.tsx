"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { button, buttonGhost, Card, Empty, input } from "@/components/panel/ui";
import { Icon } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";

export type Table = { id: string; number: number; token: string };
type Run = (fn: () => Promise<unknown>) => Promise<boolean>;
type Fetcher = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;

// Ajout des tables et leurs QR codes, partagé par l'espace restaurant (base "") et l'admin
// (base "/restaurants/<id>") : les routes /tables sont les mêmes des deux côtés.
export default function TablesEditor({
  tables,
  fetcher,
  base = "",
  run,
  reload,
  restaurant,
}: {
  tables: Table[];
  fetcher: Fetcher;
  base?: string;
  run: Run;
  reload: () => Promise<unknown> | void;
  restaurant: string;
}) {
  const [count, setCount] = useState("");
  const [origin, setOrigin] = useState("");
  const t = useT();
  useEffect(() => setOrigin(window.location.origin), []);

  const add = (n: number) =>
    run(async () => {
      await fetcher(`${base}/tables`, { method: "POST", body: { count: n } });
      setCount("");
      await reload();
    });

  return (
    <>
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
            {tables.length
              ? t("Les nouvelles tables sont numérotées à la suite (à partir de la table {n}).", { n: Math.max(...tables.map((x) => x.number)) + 1 })
              : t("Les tables sont numérotées 1, 2, 3…")}
          </p>
        </form>
      </Card>

      {tables.length === 0 ? (
        <Empty>{t("Aucune table pour le moment.")}</Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-6">
          {tables.map((table) => (
            <TableCard
              key={table.id}
              table={table}
              url={origin ? `${origin}/t/${table.token}` : ""}
              restaurant={restaurant}
              onRenew={() =>
                window.confirm(t("Créer un nouveau QR code pour la table {number} ? L'ancien ne marchera plus.", { number: table.number })) &&
                run(async () => {
                  await fetcher(`${base}/tables/${table.id}/renew`, { method: "POST" });
                  await reload();
                })
              }
              onDelete={() =>
                window.confirm(t("Supprimer la table {number} ? Son QR code ne marchera plus.", { number: table.number })) &&
                run(async () => {
                  await fetcher(`${base}/tables/${table.id}`, { method: "DELETE" });
                  await reload();
                })
              }
            />
          ))}
        </ul>
      )}
    </>
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
      <p className="mt-2 break-all text-[11px] text-stone-400 print:hidden">{url}</p>
    </li>
  );
}
