"use client";

import { useState } from "react";
import { card, primary, secondary } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import type { LocationLink } from "@/lib/api";

const time = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lome",
  });

// Lien à faire suivre au destinataire d'un colis : copié, ou partagé avec un message, par le moyen de son choix.
export default function LocationLinkCard({ link, recipientFirstName }: { link: LocationLink; recipientFirstName?: string }) {
  const [copied, setCopied] = useState(false);
  const who = recipientFirstName || "le destinataire";
  const absolute = link.url.startsWith("/") && typeof window !== "undefined" ? `${window.location.origin}${link.url}` : link.url;

  async function copy() {
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copiez ce lien :", absolute);
    }
  }

  async function share() {
    const text = link.text?.replace(link.url, absolute) ?? absolute;
    if (navigator.share) await navigator.share({ text }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(text).catch(() => window.prompt("Copiez ce message :", text));
      setCopied(true);
    }
  }

  return (
    <section className={`${card} space-y-3 p-5`}>
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        <Icon name="pin" className="h-5 w-5 text-emerald-600" /> Position de {who}
      </h2>
      <p className="text-[15px] text-stone-600">Envoyez ce lien à {who} : en un clic, sa position arrive au livreur. Rien d&apos;autre n&apos;est partagé.</p>
      <button type="button" onClick={copy} className={primary}>
        {copied ? "Lien copié" : "Copier le lien"}
      </button>
      <button type="button" onClick={share} className={secondary}>
        Partager avec un message
      </button>
      <p className="text-center text-sm text-stone-500">Valable jusqu&apos;à {time(link.expiresAt)}. Vous pourrez en envoyer un nouveau depuis le suivi.</p>
    </section>
  );
}
