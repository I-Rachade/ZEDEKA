import { afterEach, describe, expect, it, vi } from "vitest";
import { b64url, encryptPayload, fromB64url, generateVapidKeys, sendWebPush, type WebSubscription } from "./webPush.js";

// Le navigateur doit pouvoir déchiffrer ce qu'on envoie (RFC 8291) et le service push doit accepter la signature VAPID.

async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const sub: WebSubscription = { endpoint: "https://push.example.com/abc", keys: { p256dh: b64url(p256dh), auth: b64url(auth) } };
  return { pair, auth, p256dh, sub };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// Déchiffrement côté navigateur, écrit d'après la RFC 8291.
async function decrypt(b: Awaited<ReturnType<typeof browser>>, body: Uint8Array) {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, b.pair.privateKey, 256));
  const enc = new TextEncoder();
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...b.p256dh, ...asPublic]);
  const ikm = await hkdf(b.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, body.slice(21 + idLength)));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

afterEach(() => vi.unstubAllGlobals());

describe("Web Push", () => {
  it("chiffre un message que le navigateur sait lire", async () => {
    const b = await browser();
    const body = await encryptPayload(b.sub, new TextEncoder().encode('{"title":"Nouvelle course"}'));
    expect(await decrypt(b, body)).toBe('{"title":"Nouvelle course"}');
  });

  it("signe l'envoi avec la clé VAPID et dit quand l'abonnement a disparu", async () => {
    const b = await browser();
    const vapid = { ...(await generateVapidKeys()), contact: "mailto:rachadeissaka@gmail.com" };
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 201;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status });
    });

    expect(await sendWebPush(vapid, b.sub, "bonjour")).toBe("sent");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    const [, jwt, k] = headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(vapid.publicKey);
    const [head, claims, signature] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64url(claims)))).toMatchObject({ aud: "https://push.example.com", sub: vapid.contact });
    const publicKey = await crypto.subtle.importKey("raw", fromB64url(vapid.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64url(signature), new TextEncoder().encode(`${head}.${claims}`));
    expect(ok).toBe(true);
    expect(await decrypt(b, new Uint8Array(calls[0].init.body as Uint8Array))).toBe("bonjour");

    status = 410;
    expect(await sendWebPush(vapid, b.sub, "x")).toBe("gone");
    status = 500;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendWebPush(vapid, b.sub, "x")).toBe("failed");
  });
});
