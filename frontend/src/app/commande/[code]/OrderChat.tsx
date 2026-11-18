"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatLauncher } from "@/components/ChatThread";
import { readChat, sendChat } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

// Suivi : « Écrire à Koffi », la messagerie avec le livreur (compte ou téléphone qui a commandé).
// Ouverte depuis une notification de message : ?chat=1.
export default function OrderChat({ code }: { code: string }) {
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    setAutoOpen(new URLSearchParams(window.location.search).get("chat") === "1");
  }, []);
  const load = useCallback(
    async (peek: boolean) => {
      const chat = await readChat(code, peek);
      if (chat) setName(chat.driverFirstName);
      return chat;
    },
    [code],
  );
  const send = useCallback((body: string) => sendChat(code, body), [code]);
  const who = name ?? t("votre livreur");
  return (
    <ChatLauncher
      label={t("Écrire à {name}", { name: who })}
      title={name ?? t("Votre livreur")}
      subtitle={t("Livreur Zedeka · commande {code}", { code })}
      load={load}
      send={send}
      autoOpen={autoOpen}
    />
  );
}
