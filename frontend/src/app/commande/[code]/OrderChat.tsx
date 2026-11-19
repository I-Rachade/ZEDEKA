"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatLauncher } from "@/components/ChatThread";
import { Icon } from "@/components/panel/icons";
import { readChat, sendChat } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

// Suivi : « Écrire à Koffi », la messagerie avec le livreur (compte ou téléphone qui a commandé),
// et « WhatsApp » pour le joindre directement pendant la course (numéro donné par l'API à qui a commandé).
// Ouverte depuis une notification de message : ?chat=1.
export default function OrderChat({ code }: { code: string }) {
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    setAutoOpen(new URLSearchParams(window.location.search).get("chat") === "1");
  }, []);
  const load = useCallback(
    async (peek: boolean) => {
      const chat = await readChat(code, peek);
      if (chat) {
        setName(chat.driverFirstName);
        setWhatsapp(chat.driverWhatsapp ?? null);
      }
      return chat;
    },
    [code],
  );
  const send = useCallback((body: string) => sendChat(code, body), [code]);
  const who = name ?? t("votre livreur");
  const wa = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(t("Bonjour, je suis le client de la commande Zedeka {code}.", { code }))}` : null;
  return (
    <div className="space-y-3 empty:hidden">
      <ChatLauncher
        label={t("Écrire à {name}", { name: who })}
        title={name ?? t("Votre livreur")}
        subtitle={t("Livreur Zedeka · commande {code}", { code })}
        load={load}
        send={send}
        autoOpen={autoOpen}
      />
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="card-gloss flex w-full items-center gap-3 rounded-[12px] bg-surface px-5 py-4 text-left transition active:scale-[0.99]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#25D366] text-white">
            <WhatsappGlyph />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t("WhatsApp avec {name}", { name: who })}</span>
            <span className="block text-[13px] text-stone-500">{t("Message ou appel direct, pendant la livraison")}</span>
          </span>
          <Icon name="chevron" className="h-4 w-4 text-stone-300" />
        </a>
      )}
    </div>
  );
}

function WhatsappGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}
