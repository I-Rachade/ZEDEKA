"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { askConfirm } from "@/components/AlertDialog";
import { cancelOrder, placedHere } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

// Annulation par le client lui-même, sans frais : seulement sur le téléphone qui a commandé, pendant le délai
// d'annulation gratuite et tant que le repas n'est pas en préparation (le serveur vérifie les mêmes règles).
// Le bouton disparaît à la fin du délai ; ensuite, l'aide WhatsApp reste en dessous.
export default function CancelButton({ code, createdAt, minutes }: { code: string; createdAt: string; minutes: number }) {
  const t = useT();
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMine(placedHere(code));
    const end = new Date(createdAt).getTime() + minutes * 60_000;
    const tick = () => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [code, createdAt, minutes]);

  if (!mine || !left) return null;

  async function cancel() {
    if (!(await askConfirm(t("Annuler cette commande ?"), t("Annuler la commande"), { destructive: true, cancelLabel: t("Garder") }))) return;
    setBusy(true);
    setError("");
    try {
      await cancelOrder(code);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <section className="card-gloss rounded-[12px] bg-surface px-5 py-4">
      <button type="button" onClick={cancel} disabled={busy} className="w-full text-left font-semibold text-red-600 disabled:opacity-60">
        {busy ? t("Annulation…") : t("Annuler sans frais")}
      </button>
      <p className="text-sm text-stone-500">{t("Encore {time} pour annuler gratuitement.", { time: clock })}</p>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </section>
  );
}
