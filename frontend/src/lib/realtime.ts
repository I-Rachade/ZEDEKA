"use client";

import { useEffect, useRef } from "react";
import { API_URL } from "./api";
import { LIVE_EVENT } from "./live";

// Temps réel : connexion WebSocket avec l'API (/api/live, Durable Object « Live »). Quand une commande change, le
// serveur envoie un simple signal et l'écran relit aussitôt ses données, au lieu d'attendre son prochain tour de
// relecture (5 à 15 s). Les relectures régulières restent en secours si la connexion tombe.
//
// Deux événements dans la page à chaque signal :
// - LIVE_EVENT, déjà écouté par useLiveRefresh (suivi client, admin, marchand…) ;
// - REALTIME_EVENT, pour les écrans qui ont leur propre minuterie (cadre du livreur, pouls du restaurant…).
export const REALTIME_EVENT = "zedeka-realtime";

// Écoute du signal par un écran qui a sa propre minuterie.
export function onRealtime(fn: () => void): () => void {
  window.addEventListener(REALTIME_EVENT, fn);
  return () => window.removeEventListener(REALTIME_EVENT, fn);
}

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

function socketUrl(ticket: string): string {
  const base = API_URL || window.location.origin;
  return `${base.replace(/^http/, "ws")}/api/live?t=${encodeURIComponent(ticket)}`;
}

let pending: number | null = null;
// Plusieurs signaux d'affilée (statut + livreur + notification) : une seule relecture.
function signal() {
  if (pending !== null) return;
  pending = window.setTimeout(() => {
    pending = null;
    window.dispatchEvent(new Event(LIVE_EVENT));
    window.dispatchEvent(new Event(REALTIME_EVENT));
  }, 150);
}

// Garde une connexion ouverte tant que l'écran est monté. `ticket` demande un ticket à l'API (route « /realtime » de
// l'espace connecté) ; null ou un échec : on réessaie plus tard, sans bruit. `key` change quand le compte change.
export function useRealtime(ticket: (() => Promise<string | null>) | null, key: string | null = "") {
  const ref = useRef(ticket);
  ref.current = ticket;
  const enabled = Boolean(ticket) && key !== null;

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry: number | null = null;
    let ping: number | null = null;
    let backoff = 1_000;
    let connectedOnce = false;
    let connecting = false;

    const schedule = () => {
      if (stopped || retry !== null) return;
      retry = window.setTimeout(() => {
        retry = null;
        void connect();
      }, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };

    async function connect() {
      if (stopped || ws || connecting) return;
      connecting = true;
      let t: string | null = null;
      try {
        t = (await ref.current?.()) ?? null;
      } catch {
        t = null;
      } finally {
        connecting = false;
      }
      if (stopped) return;
      if (!t) return schedule();
      const socket = new WebSocket(socketUrl(t));
      ws = socket;
      socket.onopen = () => {
        backoff = 1_000;
        // Reconnexion : un changement a pu passer pendant la coupure.
        if (connectedOnce) signal();
        connectedOnce = true;
        ping = window.setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), PING_MS);
      };
      socket.onmessage = (e) => {
        if (typeof e.data === "string" && e.data.startsWith("{")) signal();
      };
      socket.onclose = () => {
        if (ping !== null) window.clearInterval(ping);
        ping = null;
        if (ws === socket) ws = null;
        schedule();
      };
      socket.onerror = () => socket.close();
    }

    // Retour sur l'écran ou réseau revenu : reconnexion tout de suite.
    const wake = () => {
      if (document.visibilityState !== "visible" || ws || connecting) return;
      if (retry !== null) window.clearTimeout(retry);
      retry = null;
      backoff = 1_000;
      void connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    void connect();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      if (retry !== null) window.clearTimeout(retry);
      if (ping !== null) window.clearInterval(ping);
      ws?.close(1000);
      ws = null;
    };
  }, [enabled, key]);
}

type TicketResponse = { ticket?: string };
// Ticket depuis une fonction de lecture de l'espace connecté (restaurantFetch, driverFetch…).
export const ticketFrom = (get: (path: string) => Promise<TicketResponse>) => async () => (await get("/realtime")).ticket ?? null;
