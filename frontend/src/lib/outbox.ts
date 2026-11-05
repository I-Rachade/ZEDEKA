"use client";

import { useSyncExternalStore } from "react";
import { createParcel, type CreatedOrder, type NewParcel } from "./api";

// Envois en attente (planche 7) : un colis préparé sans réseau reste sur le téléphone, avec une clé anti-doublon.
// Rien ne part en silence : au retour du réseau, le client confirme l'envoi ; la même clé ne crée jamais deux colis.

export type OutboxItem = { id: string; kind: "PARCEL"; label: string; estimate: number | null; createdAt: number; payload: NewParcel };

const KEY = "zedeka.outbox";
const listeners = new Set<() => void>();
let cache: OutboxItem[] | null = null;

function read(): OutboxItem[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as OutboxItem[];
  } catch {
    cache = [];
  }
  return cache;
}
function write(items: OutboxItem[]) {
  cache = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Mémoire pleine ou navigation privée : l'envoi reste en mémoire pour cette visite.
  }
  listeners.forEach((l) => l());
}

export const newClientKey = () => `k_${Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

export function queue(item: OutboxItem) {
  write([...read().filter((i) => i.id !== item.id), item]);
}
export function drop(id: string) {
  write(read().filter((i) => i.id !== id));
}

// Envoi confirmé par le client : la clé fait que le serveur renvoie le colis déjà créé si la réponse s'était perdue.
export async function send(item: OutboxItem): Promise<CreatedOrder> {
  const order = await createParcel({ ...item.payload, clientKey: item.id });
  drop(item.id);
  return order;
}

const EMPTY: OutboxItem[] = [];
export function useOutbox() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => e.key === KEY && ((cache = null), l());
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    read,
    () => EMPTY,
  );
}

// Erreur de réseau (pas de réponse du serveur), à distinguer d'un refus de l'API.
export const isNetworkFailure = (e: unknown) => e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
