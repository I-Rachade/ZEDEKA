// Web Push (RFC 8030, chiffrement RFC 8291, signature VAPID RFC 8292) avec WebCrypto seulement,
// pour tourner sur Cloudflare Workers. Repris de poinderecharge (worker/web-push.ts).
// Les clés VAPID sont au format de `npx web-push generate-vapid-keys` (base64url).

export type VapidKeys = { publicKey: string; privateKey: string; contact: string };
export type WebSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  let s = "";
  new Uint8Array(bytes).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64url = (text: string) => {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// Nouvelle paire de clés (pour le développement local et les tests).
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: b64url((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer), privateKey: jwk.d! };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// RFC 8291 : le message chiffré pour ce navigateur, en un seul enregistrement aes128gcm.
export async function encryptPayload(sub: WebSubscription, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // Les types de Workers écrivent le champ « $public » ; le moteur (comme la norme) lit « public ».
  const ecdh = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256));
  const enc = new TextEncoder();
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 : dernier (et seul) enregistrement.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// RFC 8292 : l'en-tête Authorization pour le service push de ce navigateur.
async function vapidHeader(keys: VapidKeys, endpoint: string): Promise<string> {
  const enc = new TextEncoder();
  const point = fromB64url(keys.publicKey);
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64url(point.slice(1, 33)), y: b64url(point.slice(33, 65)) };
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: keys.contact })));
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto signe l'ECDSA en r||s, la forme attendue par JWS.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

// « gone » : le navigateur a retiré l'abonnement (on l'oublie).
export async function sendWebPush(keys: VapidKeys, sub: WebSubscription, payload: string): Promise<"sent" | "gone" | "failed"> {
  const body = await encryptPayload(sub, new TextEncoder().encode(payload));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidHeader(keys, sub.endpoint),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "600",
      urgency: "high",
    },
    body,
  });
  if (res.ok) return "sent";
  if (res.status === 404 || res.status === 410) return "gone";
  console.error("push", res.status);
  return "failed";
}
