"use client";

import { useCallback, useEffect, useState } from "react";
import { customerFetch } from "@/lib/customer";
import { useLiveRefresh } from "@/lib/live";

// Nombre de messages des livreurs pas encore lus, toutes conversations confondues (pastille rouge).
export function useUnreadMessages(enabled: boolean, every = 15_000) {
  const [unread, setUnread] = useState(0);
  const load = useCallback(async () => {
    if (!enabled) return setUnread(0);
    const list = await customerFetch<{ unread: number }[]>("/messages").catch(() => null);
    if (list) setUnread(list.reduce((n, c) => n + c.unread, 0));
  }, [enabled]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, { every, enabled });
  return unread;
}
