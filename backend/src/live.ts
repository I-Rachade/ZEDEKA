import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// Temps réel : chaque écran ouvert (suivi client, restaurant, livreur, marchand, admin) garde une connexion WebSocket
// avec le Durable Object « Live » (src/liveHub.ts). Dès qu'une commande change, l'API y publie un simple signal
// « quelque chose a changé » sur les canaux concernés, et les écrans relisent aussitôt leurs données par les routes
// habituelles. Le signal ne transporte aucune donnée : rien ne fuit par là, et les droits restent ceux des routes.
//
// Canaux : « order:<code> » (page de suivi), « restaurant:<id> », « driver:<id> », « customer:<id> »,
// « merchant:<id> », « admin:<id du membre> » et « admin » (toute l'équipe).
// « presence:<appli> » : une connexion par onglet ouvert, qui ne reçoit rien et sert seulement à compter les
// utilisateurs en ligne par appli (écran technique) ; « tech » : écran technique, réveillé à chaque nouvelle erreur.
//
// Pour rejoindre un canal, l'écran demande d'abord un ticket à l'API avec sa connexion habituelle (jeton, code de
// commande) : un ticket signé, valable quelques minutes, qui liste les canaux autorisés.

export type LivePublisher = (channels: string[]) => void;
export const noLive: LivePublisher = () => {};

const TICKET_TTL_MS = 5 * 60_000;
// Un ticket ne sert qu'au temps réel : signature distincte des jetons de connexion, même avec le même secret.
const DOMAIN = "zedeka-live:";
const KINDS = new Set(["order", "restaurant", "driver", "customer", "merchant", "admin", "presence", "tech"]);
// Applis comptées par l'écran technique (canal « presence:<appli> »).
export const PRESENCE_APPS = ["client", "livreur", "restaurant", "marchand", "admin"] as const;
export type PresenceApp = (typeof PRESENCE_APPS)[number];
const ID_CHAR = /[A-Za-z0-9_-]/;
// Canal valide : un type connu, suivi ou non de « :id » (1 à 64 caractères simples). Sans expression régulière
// sur la chaîne entière : longueur bornée d'abord, puis un caractère à la fois.
function isChannel(c: string): boolean {
  if (c.length > 80) return false;
  const i = c.indexOf(":");
  if (i === -1) return KINDS.has(c);
  const id = c.slice(i + 1);
  return KINDS.has(c.slice(0, i)) && id.length >= 1 && id.length <= 64 && [...id].every((ch) => ID_CHAR.test(ch));
}
export const MAX_CHANNELS = 8;

const sign = (body: string, secret: string) => createHmac("sha256", DOMAIN + secret).update(body).digest("base64url");

export function issueLiveTicket(secret: string, channels: string[], now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ c: channels.slice(0, MAX_CHANNELS), e: now + TICKET_TTL_MS })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readLiveTicket(ticket: string, secret: string, now = Date.now()): string[] | null {
  const [body, signature] = ticket.split(".");
  if (!body || !signature || !secret) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as { c?: unknown; e?: unknown };
    if (typeof claims.e !== "number" || claims.e <= now || !Array.isArray(claims.c)) return null;
    const channels = claims.c.filter((c): c is string => typeof c === "string" && isChannel(c)).slice(0, MAX_CHANNELS);
    return channels.length ? channels : null;
  } catch {
    return null;
  }
}

// Canal d'un rôle de notification (src/notify.ts) : une notification envoyée à quelqu'un réveille aussi ses écrans.
export function channelOf(role: string, subject: string): string | null {
  const channel = `${role}:${subject}`;
  return isChannel(channel) ? channel : null;
}

export type OrderKeys = { code: string; restaurantId: string | null; driverId: string | null; customerId: string | null; merchantId: string | null };

// Tous ceux qui suivent une commande : le client (page de suivi et appli), le restaurant, le livreur, le marchand, l'équipe.
export function orderChannels(o: OrderKeys): string[] {
  return [
    `order:${o.code}`,
    o.restaurantId && `restaurant:${o.restaurantId}`,
    o.driverId && `driver:${o.driverId}`,
    o.customerId && `customer:${o.customerId}`,
    o.merchantId && `merchant:${o.merchantId}`,
    "admin",
  ].filter((c): c is string => Boolean(c) && isChannel(c as string));
}

// Ids et codes visés par le « where » d'une écriture (id: "x", id: { in: [...] }, code: "x").
// Le livreur nommé dans le filtre est gardé aussi : quand une course lui est retirée (driverId remis à vide), son
// écran doit le voir alors que la commande ne le désigne plus.
export function targetsOf(where: unknown): { ids: string[]; codes: string[]; drivers: string[] } {
  const out = { ids: [] as string[], codes: [] as string[], drivers: [] as string[] };
  if (!where || typeof where !== "object") return out;
  const w = where as Record<string, unknown>;
  const collect = (value: unknown, into: string[]) => {
    if (typeof value === "string") into.push(value);
    else if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if (typeof v.equals === "string") into.push(v.equals);
      if (Array.isArray(v.in)) into.push(...v.in.filter((x): x is string => typeof x === "string"));
    }
  };
  collect(w.id, out.ids);
  collect(w.code, out.codes);
  if (typeof w.driverId === "string") out.drivers.push(w.driverId);
  return out;
}

// Au-delà, c'est un traitement de masse (finances, reversements) : seule l'équipe est prévenue.
const MAX_ORDERS = 50;

const KEYS = { id: true, code: true, restaurantId: true, driverId: true, customerId: true, merchantId: true } as const;

type Targets = { ids: string[]; codes: string[]; drivers: string[] };
type FindKeys = (where: { OR: object[] }) => Promise<(OrderKeys & { id: string })[]>;

// Commandes visées par une écriture terminée (create, update, upsert, updateMany).
export function writeTargets(operation: string, args: { where?: unknown }, result: unknown): Targets | null {
  const id = result && typeof result === "object" && typeof (result as { id?: unknown }).id === "string" ? [(result as { id: string }).id] : [];
  if (operation === "create") return { ids: id, codes: [], drivers: [] };
  if (operation === "updateMany" && !(result as { count?: number } | null)?.count) return null;
  const t = targetsOf(args.where);
  return { ...t, ids: [...t.ids, ...id] };
}

// Lit les destinataires des commandes visées (en arrière-plan, `defer`) puis publie le signal.
export function orderSignal(findKeys: FindKeys, publish: LivePublisher, defer: (p: Promise<unknown>) => void) {
  return (targets: Targets | null) => {
    if (!targets) return;
    const ids = [...new Set(targets.ids)];
    const codes = [...new Set(targets.codes)];
    if (!ids.length && !codes.length) return;
    if (ids.length + codes.length > MAX_ORDERS) {
      publish(["admin"]);
      return;
    }
    defer(
      findKeys({ OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(codes.length ? [{ code: { in: codes } }] : [])] })
        .then((rows) => {
          const channels = new Set<string>(targets.drivers.map((d) => `driver:${d}`));
          for (const row of rows) for (const c of orderChannels(row)) channels.add(c);
          if (channels.size) publish([...channels]);
        })
        .catch((e) => console.error("temps réel", e)),
    );
  };
}

// Client Prisma qui publie un signal après chaque écriture d'une commande, d'où qu'elle vienne (restaurant, livreur,
// admin, tâches de chaque minute…). La lecture des destinataires part en arrière-plan (waitUntil) : la réponse de
// l'action n'attend pas.
export function withLive(base: PrismaClient, publish: LivePublisher, defer: (p: Promise<unknown>) => void): PrismaClient {
  const signal = orderSignal((where) => base.order.findMany({ where, select: KEYS }), publish, defer);
  const after =
    (operation: string) =>
    async ({ args, query }: { args: { where?: unknown }; query: (args: never) => Promise<unknown> }) => {
      const result = await query(args as never);
      signal(writeTargets(operation, args, result));
      return result;
    };
  return base.$extends({
    query: {
      order: {
        create: after("create") as never,
        update: after("update") as never,
        upsert: after("upsert") as never,
        updateMany: after("updateMany") as never,
      },
    },
  }) as unknown as PrismaClient;
}
