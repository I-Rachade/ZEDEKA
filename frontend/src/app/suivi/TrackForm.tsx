"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { field } from "@/components/ContactFields";
import { apiPost } from "@/lib/api";
import { useStored, RECENT_KEY, type RecentOrder } from "@/lib/device";

const hrefFor = (kind: RecentOrder["kind"], code: string) => (kind === "RENTAL" ? `/reservation/${code}` : `/commande/${code}`);

// Suivi sans compte : le code seul ne suffit pas, il faut aussi le numéro de la commande.
export default function TrackForm() {
  const router = useRouter();
  const recent = useStored<RecentOrder[]>(RECENT_KEY) ?? [];
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const found = await apiPost<{ kind: RecentOrder["kind"]; code: string }>("/api/track", {
        code: String(f.get("code") ?? "").trim().toUpperCase(),
        phone: String(f.get("phone") ?? ""),
      });
      router.push(hrefFor(found.kind, found.code));
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <input name="code" aria-label="Code de la commande" required minLength={4} autoCapitalize="characters" placeholder="Code (ex. ZD-4F7Q)" className={`${field} uppercase`} />
        <input name="phone" aria-label="Téléphone" required type="tel" inputMode="tel" pattern="\+?[0-9 ]{8,15}" placeholder="Téléphone utilisé" className={field} />
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={submitting} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60">
          {submitting ? "Recherche…" : "Suivre"}
        </button>
      </form>
      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-600">Commandes passées sur cet appareil</h2>
          <ul className="divide-y divide-stone-100 rounded-2xl bg-white shadow-sm">
            {recent.map((o) => (
              <li key={o.code}>
                <Link href={hrefFor(o.kind, o.code)} className="flex justify-between p-3 text-sm">
                  <span className="font-medium">{o.code}</span>
                  <span className="text-stone-500">{o.kind === "FOOD" ? "Repas" : o.kind === "PARCEL" ? "Colis" : "Location"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
