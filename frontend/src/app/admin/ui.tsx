import type { AdminOrderStatus } from "@/lib/admin";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/admin";

export const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm";
export const button = "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
export const buttonGhost = "rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm";

export function Card({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: AdminOrderStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>;
}

export function Loading() {
  return <p className="text-sm text-stone-500">Chargement…</p>;
}
