"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { Empty } from "./ui";

export type Column<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "right";
  // Sur mobile : « title » en gras en haut de la carte, « badge » à droite, « meta » en dessous, « hide » masqué.
  mobile?: "title" | "badge" | "meta" | "hide";
};

// Tableau sur grand écran, cartes empilées sur mobile.
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty = "Aucun élément.",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  empty?: string;
}) {
  const router = useRouter();
  const t = useT();
  if (rows.length === 0) return <Empty>{empty}</Empty>;

  const title = columns.filter((c) => c.mobile === "title");
  const badge = columns.filter((c) => c.mobile === "badge");
  const meta = columns.filter((c) => !c.mobile || c.mobile === "meta");

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
              {columns.map((c) => (
                <th key={c.header} className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>
                  {t(c.header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={rowHref ? () => router.push(rowHref(row)) : undefined}
                className={`border-b border-stone-100 last:border-0 ${rowHref ? "cursor-pointer hover:bg-stone-50" : ""}`}
              >
                {columns.map((c) => (
                  <td key={c.header} className={`px-3 py-2.5 align-top ${c.align === "right" ? "text-right" : ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            onClick={rowHref ? () => router.push(rowHref(row)) : undefined}
            className={`rounded-lg border border-stone-200 p-3 text-sm ${rowHref ? "cursor-pointer active:bg-stone-50" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{title.map((c) => <div key={c.header}>{c.cell(row)}</div>)}</div>
              <div className="text-right">{badge.map((c) => <div key={c.header}>{c.cell(row)}</div>)}</div>
            </div>
            <dl className="mt-1 space-y-0.5 text-stone-600">
              {meta.map((c) => (
                <div key={c.header} className="flex justify-between gap-2">
                  <dt className="text-stone-500">{t(c.header)}</dt>
                  <dd className="text-right">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
