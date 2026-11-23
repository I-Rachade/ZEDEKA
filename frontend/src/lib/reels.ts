"use client";

import { tr } from "@/lib/i18n";
import { API_URL } from "./api";
import { getSession, saveSession } from "./customer";

// Onglet « Nouveautés » : courtes vidéos de produits que le client fait défiler, aime, commente et commande.

export type ReelOrder = { kind: "DISH" | "LINK"; href: string; price: number | null; seller: string | null; available: boolean };
export type Reel = {
  id: string;
  title: string;
  caption: string | null;
  videoUrl: string;
  posterUrl: string | null;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  order: ReelOrder | null;
};
export type ReelComment = { id: string; text: string; createdAt: string; author: string; mine: boolean };

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = getSession();
  const res = await fetch(`${API_URL}/api${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && session) saveSession(null);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? tr("La demande n'a pas abouti.")), { status: res.status });
  return body as T;
}

export const fetchReels = (after?: string | null) => call<{ reels: Reel[]; next: string | null }>(`/reels${after ? `?apres=${encodeURIComponent(after)}` : ""}`);
export const setLike = (id: string, liked: boolean) => call<{ liked: boolean; likeCount: number }>(`/reels/${id}/like`, { method: liked ? "PUT" : "DELETE" });
export const fetchComments = (id: string) => call<ReelComment[]>(`/reels/${id}/comments`);
export const postComment = (id: string, text: string) => call<{ comment: ReelComment; commentCount: number }>(`/reels/${id}/comments`, { method: "POST", body: { text } });
export const deleteComment = (id: string, commentId: string) => call<{ commentCount: number }>(`/reels/${id}/comments/${commentId}`, { method: "DELETE" });
