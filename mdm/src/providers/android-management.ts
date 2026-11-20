/**
 * Android Management API (Google) — https://developers.google.com/android/management
 * Canal recommandé pour Android Enterprise : enrôlement par QR code / zero-touch, politiques
 * de mot de passe, installation forcée d'applications Play, verrouillage, effacement, mode perdu.
 * Activé si les secrets AMA_ENTERPRISE et AMA_SERVICE_ACCOUNT sont définis.
 */
import type { Env } from "../env";
import { signRs256 } from "../lib/crypto";
import type { Command, Provider } from "./index";

const API = "https://androidmanagement.googleapis.com/v1";
let cached: { token: string; exp: number } | null = null;

async function accessToken(env: Env): Promise<string> {
  if (cached && cached.exp > Date.now() / 1000 + 60) return cached.token;
  const sa = JSON.parse(env.AMA_SERVICE_ACCOUNT!);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signRs256({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidmanagement",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }, sa.private_key);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
  });
  const data = await r.json<{ access_token: string; expires_in: number }>();
  cached = { token: data.access_token, exp: now + data.expires_in };
  return cached.token;
}

async function call(env: Env, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Android Management API ${r.status} : ${await r.text()}`);
  return r.status === 204 ? {} : r.json<Record<string, any>>();
}

/** Construit la politique AMA à partir des politiques du portail. */
export function buildAmaPolicy(passcode: any, restrictions: any, apps: { identifier: string; mandatory: number; blocked: number }[]) {
  return {
    passwordPolicies: [{
      passwordMinimumLength: passcode.min_length,
      passwordQuality: passcode.require_alphanumeric ? "ALPHANUMERIC" : "NUMERIC_COMPLEX",
      maximumFailedPasswordsForWipe: passcode.max_failed_attempts,
      passwordExpirationTimeout: `${passcode.max_age_days * 86400}s`,
      passwordHistoryLength: passcode.history,
    }],
    maximumTimeToLock: String(passcode.auto_lock_minutes * 60_000),
    cameraAccess: restrictions.camera ? "CAMERA_ACCESS_USER_CHOICE" : "CAMERA_ACCESS_DISABLED",
    screenCaptureDisabled: !restrictions.screen_capture,
    usbDataAccess: restrictions.usb_file_transfer ? "ALLOW_USB_DATA_TRANSFER" : "DISALLOW_USB_FILE_TRANSFER",
    applications: apps.map((a) => ({
      packageName: a.identifier,
      installType: a.blocked ? "BLOCKED" : a.mandatory ? "FORCE_INSTALLED" : "AVAILABLE",
    })),
  };
}

export const androidManagement: Provider = {
  async dispatch(env, device, cmd: Command) {
    if (!env.AMA_ENTERPRISE || !env.AMA_SERVICE_ACCOUNT || !device.provider_ref) return false;
    const name = device.provider_ref as string; // enterprises/{e}/devices/{d}
    const issue = (type: string, extra: Record<string, unknown> = {}) =>
      call(env, "POST", `${name}:issueCommand`, { type, ...extra });
    switch (cmd.type) {
      case "lock": await issue("LOCK"); return true;
      case "restart": await issue("REBOOT"); return true;
      case "reset_passcode": await issue("RESET_PASSWORD", { newPassword: cmd.params.new_passcode ?? "" }); return true;
      case "lost_mode_on":
        await issue("START_LOST_MODE", { startLostModeParams: {
          lostMessage: { defaultMessage: String(cmd.params.message ?? "Appareil perdu, merci de contacter l'entreprise") },
          lostPhoneNumber: { defaultMessage: String(cmd.params.phone ?? "") },
        } });
        return true;
      case "lost_mode_off": await issue("STOP_LOST_MODE"); return true;
      case "wipe_full": await call(env, "DELETE", `${name}?wipeDataFlags=WIPE_EXTERNAL_STORAGE`); return true;
      case "wipe_corporate": await call(env, "DELETE", name); return true; // supprime le profil de travail
      default:
        // locate / ring / install_app / remove_app / sync_policy : via la politique AMA ou l'agent compagnon
        return false;
    }
  },
};
