// Notifications des applications Android et iOS par Firebase Cloud Messaging (API HTTP v1), avec WebCrypto
// seulement pour tourner sur Cloudflare Workers. Le compte de service vient de la console Firebase
// (Paramètres du projet > Comptes de service > Générer une clé privée) : son JSON va dans le secret FCM_SERVICE_ACCOUNT.

import { b64url } from "./webPush.js";

export type ServiceAccount = { project_id: string; client_email: string; private_key: string };
export type FcmMessage = { title: string; body: string; url: string; tag?: string; alarm?: boolean };
export type FcmSender = (token: string, message: FcmMessage) => Promise<"sent" | "gone">;

// Canal Android des alertes (créé par l'application) : importance maximale, son et vibration.
export const ALARM_CHANNEL = "alertes";

export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json) return null;
  try {
    const a = JSON.parse(json) as Partial<ServiceAccount>;
    return a.project_id && a.client_email && a.private_key ? { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key } : null;
  } catch {
    return null;
  }
}

async function signJwt(account: ServiceAccount, now: number): Promise<string> {
  const pem = account.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(signature)}`;
}

export function createFcmSender(account: ServiceAccount, fetchFn: typeof fetch = fetch): FcmSender {
  // Jeton d'accès Google valable une heure, gardé en mémoire et renouvelé cinq minutes avant la fin.
  let cached: { token: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.until > now) return cached.token;
    const res = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signJwt(account, now) }),
    });
    if (!res.ok) throw new Error(`FCM : jeton refusé (${res.status})`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    cached = { token: data.access_token, until: now + (data.expires_in ?? 3600) - 300 };
    return data.access_token;
  }

  return async (token, m) => {
    const message = {
      token,
      notification: { title: m.title, body: m.body },
      data: { url: m.url, ...(m.tag ? { tag: m.tag } : {}) },
      android: {
        priority: "HIGH",
        ttl: m.alarm ? "60s" : "3600s",
        notification: { channel_id: ALARM_CHANNEL, sound: "default", ...(m.tag ? { tag: m.tag } : {}) },
      },
      apns: {
        headers: { "apns-priority": "10", ...(m.tag ? { "apns-collapse-id": m.tag.slice(0, 64) } : {}) },
        payload: { aps: { sound: "default", "interruption-level": m.alarm ? "time-sensitive" : "active" } },
      },
    };
    const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return "sent";
    // Application désinstallée ou jeton remplacé : l'abonnement est à supprimer.
    if (res.status === 404) return "gone";
    const detail = await res.text().catch(() => "");
    if (res.status === 400 && /UNREGISTERED|registration token is not a valid/i.test(detail)) return "gone";
    throw new Error(`FCM ${res.status} ${detail.slice(0, 200)}`);
  };
}
