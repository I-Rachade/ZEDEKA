"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatLauncher } from "@/components/ChatThread";
import type { ChatMessage, ChatThreadData } from "@/lib/api";
import { driverFetch } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";

type DriverChat = ChatThreadData & { customerFirstName: string; customerNotified: boolean };

// Course : « Écrire au client », messagerie écrite gardée avec la commande. Ouverte depuis une notification : ?chat=1.
export default function CourseChat({ orderId, code }: { orderId: string; code: string }) {
  const t = useT();
  const [name, setName] = useState<string | null>(null);
  const [notified, setNotified] = useState(true);
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    setAutoOpen(new URLSearchParams(window.location.search).get("chat") === "1");
  }, []);
  const load = useCallback(
    async (peek: boolean) => {
      const chat = await driverFetch<DriverChat>(`/orders/${orderId}/chat${peek ? "?peek=1" : ""}`);
      setName(chat.customerFirstName);
      setNotified(chat.customerNotified);
      return chat;
    },
    [orderId],
  );
  const send = useCallback((body: string) => driverFetch<ChatMessage>(`/orders/${orderId}/chat`, { method: "POST", body: { body } }), [orderId]);
  return (
    <ChatLauncher
      label={t("Écrire au client")}
      title={name ?? t("Client")}
      subtitle={t("Client · commande {code}", { code })}
      load={load}
      send={send}
      autoOpen={autoOpen}
      every={10_000}
      // Commande sans compte : pas de notification, le client lit sur sa page de suivi. Pour l'urgent, appelez.
      note={notified ? null : t("Ce client n'a pas de compte : il voit vos messages sur sa page de suivi. Pour l'urgent, appelez-le.")}
    />
  );
}
