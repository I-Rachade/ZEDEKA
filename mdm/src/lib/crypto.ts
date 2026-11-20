/** Primitives cryptographiques (WebCrypto natif des Workers, aucune dépendance). */
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf: ArrayBuffer | Uint8Array) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

// ---------- Mots de passe : PBKDF2-SHA256, 100 000 itérations (maximum autorisé par les Workers)
const ITER = 100_000;
async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITER))}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iter, salt, hash] = stored.split("$");
  if (!hash) return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
export function passwordProblems(p: string): string[] {
  const issues: string[] = [];
  if (p.length < 10) issues.push("10 caractères minimum");
  if (!/[A-Z]/.test(p)) issues.push("une majuscule");
  if (!/[a-z]/.test(p)) issues.push("une minuscule");
  if (!/[0-9]/.test(p)) issues.push("un chiffre");
  if (!/[^A-Za-z0-9]/.test(p)) issues.push("un caractère spécial");
  return issues;
}

// ---------- JWT HS256
async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
export async function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): Promise<T | null> {
  try {
    const [head, body, sig] = token.split(".");
    if (!sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(sig), enc.encode(`${head}.${body}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(unb64url(body)));
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
    return payload as T;
  } catch {
    return null;
  }
}

// ---------- Chiffrement des données sensibles au repos : AES-256-GCM
async function dataKey(keyB64: string) {
  return crypto.subtle.importKey("raw", unb64(keyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptJson(obj: unknown, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await dataKey(keyB64), enc.encode(JSON.stringify(obj)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
export async function decryptJson<T = unknown>(blob: string, keyB64: string): Promise<T> {
  const [, iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await dataKey(keyB64), unb64(ct));
  return JSON.parse(dec.decode(pt)) as T;
}

// ---------- RS256 (compte de service Google pour l'Android Management API)
export async function signRs256(payload: Record<string, unknown>, pemKey: string): Promise<string> {
  const der = unb64(pemKey.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
