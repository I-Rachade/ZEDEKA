"use client";

import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime } from "@/lib/admin";
import { button, buttonGhost, Card, input, Loading } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { useT } from "@/lib/i18n/client";

type Row = { id: string; name: string; active: boolean; deposited: number; consumed: number; balance: number; low: boolean; lastDepositAt: string | null };
type Deposits = { amount: number; threshold: number; restaurants: Row[] };
type Movement = { kind: "DEPOSIT" | "ORDER"; id: string; at: string; amount: number; note: string | null; code: string | null };

// Dépôt de Zedeka chez chaque restaurant : le restaurant se paie les plats des commandes livrées (payées à Zedeka) sur
// cette somme. On recharge pour revenir au montant habituel ; une correction (négative) demande un motif.
export function DepositsCard() {
  const data = useAdmin<Deposits>("/finance/deposits");
  const action = useAction();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(0); // recharge enregistrée : relit les mouvements

  if (!data.data) return <Card title="Dépôts chez les restaurants">{data.error ? <p className="text-sm text-red-700">{data.error}</p> : <Loading />}</Card>;
  const { restaurants, threshold } = data.data;
  // Montant proposé : de quoi revenir au dépôt habituel (le dépôt complet pour un premier versement).
  const suggested = (r: Row) => (r.active ? Math.max(data.data!.amount - r.balance, 0) : data.data!.amount);

  const toggle = (r: Row) => {
    setOpen(open === r.id ? null : r.id);
    setAmount(String(suggested(r) || ""));
    setNote("");
  };

  const save = (r: Row) =>
    action.run(async () => {
      await adminFetch("/finance/deposits", { method: "POST", body: { restaurantId: r.id, amount: Number(amount), note: note.trim() || undefined } });
      await data.reload();
      setSaved((n) => n + 1);
      setAmount("");
      setNote("");
    });

  return (
    <Card title="Dépôts chez les restaurants">
      <p className="mb-3 text-sm text-stone-600">
        {t("Le restaurant se paie les plats des commandes livrées sur l'argent laissé par Zedeka. Alerte sous {threshold}.", { threshold: fcfa(threshold) })}
      </p>
      {action.error && <p className="mb-2 text-sm text-red-700">{action.error}</p>}
      {restaurants.length === 0 ? (
        <p className="text-sm text-stone-500">{t("Aucun restaurant actif.")}</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {restaurants.map((r) => (
            <li key={r.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-stone-500">
                    {r.active
                      ? t("Déposé {deposited} · utilisé {consumed}", { deposited: fcfa(r.deposited), consumed: fcfa(r.consumed) })
                      : t("Pas encore de dépôt : réglé par relevés")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.active && <span className={`font-semibold ${r.low ? "text-red-700" : ""}`}>{fcfa(r.balance)}</span>}
                  <button onClick={() => toggle(r)} className={r.low || !r.active ? button : buttonGhost} aria-expanded={open === r.id}>
                    {r.active ? t("Recharger") : t("Premier dépôt")}
                  </button>
                </div>
              </div>
              {open === r.id && (
                <div className="mt-2 space-y-2 rounded-xl bg-stone-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      aria-label={t("Montant (FCFA, négatif pour une correction)")}
                      placeholder={t("Montant (FCFA, négatif pour une correction)")}
                      className={`${input} w-40`}
                    />
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      aria-label={t("Note (qui a déposé, motif d'une correction)")}
                      placeholder={t("Note (qui a déposé, motif d'une correction)")}
                      className={`${input} min-w-0 flex-1`}
                    />
                    <button onClick={() => save(r)} disabled={!Number(amount)} className={button}>
                      {t("Enregistrer")}
                    </button>
                  </div>
                  <Movements key={saved} restaurantId={r.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Movements({ restaurantId }: { restaurantId: string }) {
  const movements = useAdmin<Movement[]>(`/finance/deposits/${restaurantId}`);
  const t = useT();
  return (
    <>
      {!movements.data ? (
        <Loading />
      ) : movements.data.length === 0 ? (
        <p className="text-stone-500">{t("Aucun mouvement.")}</p>
      ) : (
        <ul className="space-y-1">
          {movements.data.map((m) => (
            <li key={`${m.kind}-${m.id}`} className="flex justify-between gap-2">
              <span>
                {formatTime(m.at)} · {m.kind === "ORDER" ? t("Commande {code}", { code: m.code ?? "" }) : (m.note ?? (m.amount >= 0 ? t("Dépôt Zedeka") : t("Correction")))}
              </span>
              <span className={m.amount < 0 ? "text-stone-700" : "text-emerald-700"}>
                {m.amount > 0 ? "+" : ""}
                {fcfa(m.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
