import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createFcmSender, parseServiceAccount, type ServiceAccount } from "./fcm.js";
import { fromB64url } from "./webPush.js";
import { createNotifier, NATIVE_PREFIX } from "./notify.js";

// Google doit accepter la signature du compte de service, et Firebase recevoir un message qui sonne sur Android et iOS.

async function account(): Promise<{ account: ServiceAccount; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  der.forEach((b) => (bin += String.fromCharCode(b)));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/.{64}/g, "$&\n")}\n-----END PRIVATE KEY-----\n`;
  return { account: { project_id: "zedeka-test", client_email: "push@zedeka-test.iam.gserviceaccount.com", private_key: pem }, publicKey: pair.publicKey };
}

function fakeFetch(send: (url: string, init: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "jeton-google", expires_in: 3600 });
    return send(url, init!);
  });
}

describe("FCM", () => {
  it("lit le JSON du compte de service", () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("pas du json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "p" }))).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "p", client_email: "e", private_key: "k", type: "service_account" }))).toEqual({ project_id: "p", client_email: "e", private_key: "k" });
  });

  it("signe le jeton Google et envoie une alerte prioritaire", async () => {
    const { account: a, publicKey } = await account();
    const fetchFn = fakeFetch(() => Response.json({ name: "ok" }));
    const send = createFcmSender(a, fetchFn as unknown as typeof fetch);

    expect(await send("jeton-appareil", { title: "Nouvelle course", body: "60 secondes", url: "/livreur", tag: "offer-1", alarm: true })).toBe("sent");

    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(String(tokenInit!.body)).get("assertion")!;
    const [header, claims, signature] = assertion.split(".");
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, fromB64url(signature), new TextEncoder().encode(`${header}.${claims}`))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(fromB64url(claims)))).toMatchObject({ iss: a.client_email, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/firebase.messaging" });

    const [sendUrl, sendInit] = fetchFn.mock.calls[1];
    expect(sendUrl).toBe("https://fcm.googleapis.com/v1/projects/zedeka-test/messages:send");
    expect((sendInit!.headers as Record<string, string>).authorization).toBe("Bearer jeton-google");
    const { message } = JSON.parse(String(sendInit!.body));
    expect(message).toMatchObject({
      token: "jeton-appareil",
      notification: { title: "Nouvelle course", body: "60 secondes" },
      data: { url: "/livreur", tag: "offer-1" },
      android: { priority: "HIGH", notification: { channel_id: "alertes" } },
      apns: { payload: { aps: { "interruption-level": "time-sensitive" } } },
    });

    // Le jeton Google est réutilisé.
    await send("jeton-appareil", { title: "t", body: "b", url: "/livreur" });
    expect(fetchFn.mock.calls.filter(([u]) => String(u).includes("oauth2")).length).toBe(1);
  });

  it("signale les jetons d'application désinstallée", async () => {
    const { account: a } = await account();
    const gone = createFcmSender(a, fakeFetch(() => new Response("", { status: 404 })) as unknown as typeof fetch);
    expect(await gone("x", { title: "t", body: "b", url: "/" })).toBe("gone");
    const unregistered = createFcmSender(a, fakeFetch(() => Response.json({ error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 400 })) as unknown as typeof fetch);
    expect(await unregistered("x", { title: "t", body: "b", url: "/" })).toBe("gone");
    const down = createFcmSender(a, fakeFetch(() => new Response("indisponible", { status: 503 })) as unknown as typeof fetch);
    await expect(down("x", { title: "t", body: "b", url: "/" })).rejects.toThrow("FCM 503");
  });

  it("envoie aux applications par Firebase et supprime les jetons morts", async () => {
    const subs = [
      { id: "a", endpoint: `${NATIVE_PREFIX}vivant`, p256dh: "", auth: "android" },
      { id: "b", endpoint: `${NATIVE_PREFIX}mort`, p256dh: "", auth: "ios" },
      { id: "c", endpoint: "https://fcm.googleapis.com/fcm/send/web", p256dh: "x", auth: "y" },
    ];
    const deleted: string[] = [];
    const prisma = {
      pushSubscription: {
        findMany: async () => subs,
        delete: async ({ where }: { where: { id: string } }) => deleted.push(where.id),
      },
    } as unknown as PrismaClient;
    const fcm = vi.fn(async (token: string) => (token === "vivant" ? ("sent" as const) : ("gone" as const)));
    // Sans clés VAPID, l'abonnement du navigateur est ignoré.
    const notifier = createNotifier(prisma, { vapid: null, fcm, silent: true });
    expect(await notifier.push("driver", "d1", { title: "t", body: "b", url: "/livreur" })).toBe(1);
    expect(fcm.mock.calls.map(([t]) => t).sort()).toEqual(["mort", "vivant"]);
    expect(deleted).toEqual(["b"]);
  });
});
