"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { button, buttonGhost, Card, ErrorNote, input } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import { restaurantFetch, type Menu, type RestaurantOrder } from "@/lib/restaurant";

const REASONS = ["Plat épuisé", "Ingrédient manquant", "Boisson en rupture", "Portion indisponible"];

type Quote = { changes: { name: string; from: number; to: number; replacement?: string }[]; oldTotal: number; total: number; refund: number };

// Modifier une commande avant « Prête » : retirer un article, baisser une quantité, proposer un plat équivalent
// au même prix ou moins cher. Le serveur recalcule tout ; le client voit la modification dans son suivi.
export default function OrderEditor({ order, onSaved }: { order: RestaurantOrder; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [repl, setRepl] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !menu) restaurantFetch<Menu>("/menu").then(setMenu, (e: Error) => setError(e.message));
  }, [open, menu]);

  const changes = useMemo(
    () =>
      order.items
        .filter((i) => qty[i.id] !== undefined && qty[i.id] !== i.quantity)
        .map((i) => ({ itemId: i.id, quantity: qty[i.id], ...(repl[i.id] ? { replacementId: repl[i.id] } : {}) })),
    [order.items, qty, repl],
  );

  // Devis recalculé par le serveur à chaque changement.
  useEffect(() => {
    if (!changes.length || reason.trim().length < 3) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      restaurantFetch<Quote>(`/orders/${order.id}/edit/quote`, { method: "POST", body: { reason, changes } }).then(
        (q) => {
          setQuote(q);
          setError(null);
        },
        (e: Error) => {
          setQuote(null);
          setError(e.message);
        },
      );
    }, 250);
    return () => clearTimeout(t);
  }, [changes, reason, order.id]);

  async function save() {
    if (!quote || !window.confirm(`Enregistrer ? Nouveau total ${fcfa(quote.total)}${quote.refund ? `, ${fcfa(quote.refund)} à rembourser au client` : ""}.`)) return;
    setBusy(true);
    try {
      await restaurantFetch(`/orders/${order.id}/edit`, { method: "POST", body: { reason, changes } });
      setOpen(false);
      setQty({});
      setRepl({});
      setReason("");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const editable = ["PENDING", "CONFIRMED", "PREPARING"].includes(order.status);
  if (!editable && order.edits.length === 0) return null;

  return (
    <Card title="Modifications" icon="edit">
      {order.edits.map((e) => (
        <div key={e.id} className="mb-3 rounded-lg bg-stone-50 p-2 text-sm">
          <p className="font-medium">
            {e.reason} <span className="font-normal text-stone-500">· {formatTime(e.createdAt)}</span>
          </p>
          <ul className="text-stone-700">
            {e.changes.map((c, i) => (
              <li key={i}>
                {c.name} : {c.from} → {c.to}
                {c.replacement && `, remplacé par ${c.replacement}`}
              </li>
            ))}
          </ul>
          <p className="text-stone-600">
            {fcfa(e.oldTotal)} → {fcfa(e.newTotal)}
            {e.refund > 0 && ` · ${fcfa(e.refund)} à rembourser`}
          </p>
        </div>
      ))}

      {editable && !open && (
        <button onClick={() => setOpen(true)} className={`${buttonGhost} w-full`}>
          <Icon name="edit" className="h-4 w-4" /> Article manquant ? Modifier
        </button>
      )}

      {editable && open && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {order.items.map((i) => {
              const q = qty[i.id] ?? i.quantity;
              const options = (menu?.menuItems ?? []).filter((m) => m.available && m.id !== i.menuItemId && m.price <= i.unitPrice);
              return (
                <li key={i.id} className="rounded-lg border border-stone-200 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">
                      {i.name}
                      {i.variantName && <span className="text-stone-500"> ({i.variantName})</span>}
                    </span>
                    <button type="button" aria-label={`Moins de ${i.name}`} disabled={q === 0} onClick={() => setQty({ ...qty, [i.id]: q - 1 })} className="h-8 w-8 rounded-full border border-stone-300 disabled:opacity-40">
                      −
                    </button>
                    <span className={`w-6 text-center font-semibold ${q < i.quantity ? "text-red-700" : ""}`}>{q}</span>
                    <button type="button" aria-label={`Plus de ${i.name}`} disabled={q >= i.quantity} onClick={() => setQty({ ...qty, [i.id]: q + 1 })} className="h-8 w-8 rounded-full border border-stone-300 disabled:opacity-40">
                      +
                    </button>
                  </div>
                  {q < i.quantity && (
                    <select value={repl[i.id] ?? ""} onChange={(e) => setRepl({ ...repl, [i.id]: e.target.value })} aria-label={`Remplacement pour ${i.name}`} className={`${input} mt-2`}>
                      <option value="">Sans remplacement</option>
                      {options.map((m) => (
                        <option key={m.id} value={m.id}>
                          Remplacer par {m.name} ({fcfa(m.price)})
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              );
            })}
          </ul>
          <input value={reason} onChange={(e) => setReason(e.target.value)} list="motifs-modif" placeholder="Raison (le client la verra)" aria-label="Raison de la modification" className={input} />
          <datalist id="motifs-modif">
            {REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {quote && (
            <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">
              Total client : {fcfa(quote.oldTotal)} → <strong>{fcfa(quote.total)}</strong>
              {quote.refund > 0 && <> · {fcfa(quote.refund)} à rembourser (mobile money)</>}
            </p>
          )}
          <ErrorNote message={error} />
          <div className="flex gap-2">
            <button onClick={save} disabled={!quote || busy} className={button}>
              Enregistrer
            </button>
            <button onClick={() => setOpen(false)} className={buttonGhost}>
              Annuler
            </button>
          </div>
          <p className="text-xs text-stone-500">Prévenez le client par téléphone si possible. S&apos;il ne reste plus rien, refusez plutôt la commande.</p>
        </div>
      )}
    </Card>
  );
}
