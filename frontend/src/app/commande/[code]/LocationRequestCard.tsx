"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { input, secondary } from "@/app/app/ui";
import LocationLinkCard from "@/components/LocationLinkCard";
import MapPicker, { type Point } from "@/components/MapPicker";
import { Icon } from "@/components/panel/icons";
import { requestLocationLink, setDeliveryPoint, type LocationLink, type LocationStatus } from "@/lib/api";
import { useContact, useSession } from "@/lib/customer";

const STATE: Record<LocationStatus, { title: string; sub: string }> = {
  PENDING: { title: "En attente de la position du destinataire", sub: "Le prix sera fixé et un livreur partira dès sa réponse." },
  SHARED: { title: "Position du destinataire reçue", sub: "Le livreur ira directement à ce point." },
  DECLINED: { title: "Le destinataire n'a pas partagé sa position", sub: "Placez le point de livraison vous-même pour que le colis parte." },
  EXPIRED: { title: "Lien de position expiré", sub: "Envoyez un nouveau lien, ou placez le point vous-même." },
};

type Action = "link" | "point";

// Suivi d'un colis : état de la position demandée au destinataire. Tant qu'aucun livreur n'est parti, l'expéditeur
// peut renvoyer un lien (l'ancien cesse de marcher) ou placer lui-même le point de livraison.
export default function LocationRequestCard({ code, status, open }: { code: string; status: LocationStatus; open: boolean }) {
  const router = useRouter();
  const session = useSession();
  const contact = useContact();
  const [action, setAction] = useState<Action | null>(null);
  const [askPhone, setAskPhone] = useState(false);
  const [phone, setPhone] = useState("");
  const [point, setPoint] = useState<Point | null>(null);
  const [link, setLink] = useState<LocationLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = session?.phone ?? contact?.phone ?? "";

  async function run(a: Action, withPhone: string, p: Point | null = point) {
    setBusy(true);
    setError(null);
    try {
      if (a === "link") setLink(await requestLocationLink(code, withPhone || undefined));
      else if (p) {
        await setDeliveryPoint(code, p, withPhone || undefined);
        router.refresh();
      }
      setAskPhone(false);
    } catch (e) {
      setError((e as Error).message);
      setAction(a);
      setAskPhone(true);
    } finally {
      setBusy(false);
    }
  }

  // Avec un compte ou un numéro déjà connu sur l'appareil, on essaie sans le redemander.
  function start(a: Action, p: Point | null = null) {
    setAction(a);
    if (known || session) run(a, known, p);
    else setAskPhone(true);
  }

  if (link) return <LocationLinkCard link={link} />;

  const s = STATE[status];
  return (
    <section className="space-y-3 rounded-[20px] bg-white p-4">
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${status === "SHARED" ? "bg-emerald-600/10 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
          <Icon name={status === "SHARED" ? "check" : "pin"} className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block font-semibold">{s.title}</span>
          <span className="block text-sm text-stone-500">{s.sub}</span>
        </span>
      </div>
      {open && status !== "SHARED" && !askPhone && (
        <div className="space-y-2">
          <button type="button" disabled={busy} onClick={() => start("link")} className={secondary}>
            {busy && action === "link" ? "…" : "Renvoyer le lien"}
          </button>
          <button type="button" disabled={busy} onClick={() => setAction("point")} className={secondary}>
            {busy && action === "point" ? "…" : "Placer le point moi-même"}
          </button>
        </div>
      )}
      {askPhone && action && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(action, phone);
          }}
        >
          <label className="block space-y-1">
            <span className="text-sm text-stone-600">Votre numéro (celui utilisé pour envoyer le colis)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" required className={input} />
          </label>
          <button type="submit" disabled={busy} className={secondary}>
            {busy ? "Envoi…" : "Confirmer"}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {action === "point" && !point && !askPhone && (
        <MapPicker
          title="Point de livraison"
          onClose={() => setAction(null)}
          onPick={(p) => {
            setPoint(p);
            start("point", p);
          }}
        />
      )}
    </section>
  );
}
