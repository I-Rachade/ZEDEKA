"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { Icon, type IconName } from "./icons";

// Les textes passés en français (titres, libellés, explications) sont traduits ici dans la langue choisie.

export const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm placeholder:text-stone-500 focus:border-emerald-600 focus:outline-none";
export const button = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60";
export const buttonGhost = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-60";
export const buttonDanger = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700";

// En-tête de page : icône, titre, compteur, phrase d'explication et actions.
export function PageHeader({
  icon,
  title,
  count,
  description,
  actions,
}: {
  icon: IconName;
  title: string;
  count?: number;
  description?: string;
  actions?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
          <Icon name={icon} />
        </span>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            {t(title)}
            {count !== undefined && <span className="rounded-full bg-stone-200 px-2 text-sm font-medium text-stone-700">{count}</span>}
          </h1>
          {description && <p className="text-sm text-stone-600">{t(description)}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  icon,
  children,
  action,
  className = "",
}: {
  title?: string;
  icon?: IconName;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h2 className="flex items-center gap-2 font-semibold">
              {icon && <Icon name={icon} className="h-4 w-4 text-stone-500" />}
              {t(title)}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint, icon, href }: { label: string; value: string | number; hint?: string; icon?: IconName; href?: string }) {
  const t = useT();
  const body = (
    <div className="flex items-start justify-between gap-2 rounded-xl border border-stone-200 bg-white p-4">
      <div>
        <p className="text-sm text-stone-600">{t(label)}</p>
        <p className="text-2xl font-bold">{value}</p>
        {hint && <p className="text-xs text-stone-500">{t(hint)}</p>}
      </div>
      {icon && <Icon name={icon} className="h-5 w-5 text-stone-500" />}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// Barre d'actions collée en bas d'un formulaire.
export function StickyActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-16 z-20 -mx-4 mt-4 flex justify-end gap-2 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0">
      {children}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const tr = useT();
  return (
    <div className="-mx-4 mb-3 flex gap-1 overflow-x-auto border-b border-stone-200 px-4">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${value === t.value ? "border-emerald-600 font-semibold text-emerald-700" : "border-transparent text-stone-600"}`}
        >
          {tr(t.label)}
          {t.count !== undefined && (
            <span className={`rounded-full px-1.5 text-xs ${value === t.value ? "bg-emerald-100" : "bg-stone-200"}`}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  const t = useT();
  if (!message) return null;
  return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{t(message)}</p>;
}

export function Loading() {
  const t = useT();
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">{t("Chargement…")}</span>
      <span className="skeleton block h-8 w-1/3 rounded-lg" />
      <span className="grid grid-cols-2 gap-3">
        <span className="skeleton block h-20 rounded-xl" />
        <span className="skeleton block h-20 rounded-xl" />
      </span>
      <span className="skeleton block h-32 rounded-xl" />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  const t = useT();
  return <p className="py-6 text-center text-sm text-stone-500">{typeof children === "string" ? t(children) : children}</p>;
}
