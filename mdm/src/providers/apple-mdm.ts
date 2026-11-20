/**
 * Protocole MDM d'Apple (iOS / iPadOS) — https://developer.apple.com/documentation/devicemanagement
 *
 * Fonctionnement : l'iPhone installe un profil d'enrôlement qui pointe vers /mdm/apple/checkin et
 * /mdm/apple/server. Pour lui envoyer une commande, le serveur le « réveille » par une notification
 * APNs (certificat push MDM obtenu via Apple Push Certificates Portal) ; l'appareil vient alors
 * chercher sa commande en plist sur /mdm/apple/server et renvoie le résultat.
 *
 * Prérequis de production : certificat APNs MDM (liaison mTLS `APNS` dans wrangler.jsonc),
 * identité d'appareil (SCEP/ACME) et idéalement Apple Business Manager pour l'enrôlement automatique (ADE).
 */
import type { Env } from "../env";
import type { Command, Provider } from "./index";

// ---------------------------------------------------------------- plist minimal
type Plist = string | number | boolean | Plist[] | { [k: string]: Plist } | { __data: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function toXml(v: Plist): string {
  if (typeof v === "string") return `<string>${esc(v)}</string>`;
  if (typeof v === "number") return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (Array.isArray(v)) return `<array>${v.map(toXml).join("")}</array>`;
  if ("__data" in v) return `<data>${v.__data}</data>`;
  return `<dict>${Object.entries(v).map(([k, x]) => `<key>${esc(k)}</key>${toXml(x)}`).join("")}</dict>`;
}
export function buildPlist(v: Plist): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${toXml(v)}</plist>`;
}

/** Lecture des plists envoyées par les appareils (dict / string / integer / bool / data / array). */
export function parsePlist(xml: string): Record<string, any> {
  // Découpe en balises et textes, puis ignore l'en-tête XML, le DOCTYPE et l'enveloppe <plist>.
  const tokens = (xml.match(/<[^>]+>|[^<]+/g) ?? []).map((t) => t.trim())
    .filter((t) => t && !t.startsWith("<?") && !t.startsWith("<!") && !/^<\/?plist[\s>]/.test(t));
  let i = 0;
  const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  function value(): any {
    const t = tokens[i++];
    if (t === "<dict>") {
      const o: Record<string, any> = {};
      while (tokens[i] !== "</dict>") { i++; const k = unesc(tokens[i++]); i++; o[k] = value(); }
      i++; return o;
    }
    if (t === "<array>") { const a = []; while (tokens[i] !== "</array>") a.push(value()); i++; return a; }
    if (t === "<true/>") return true;
    if (t === "<false/>") return false;
    if (t === "<dict/>") return {};
    if (t === "<array/>") return [];
    if (/^<(string|data|date)\/>$/.test(t)) return "";
    const m = t.match(/^<(\w+)>$/);
    if (m) { const raw = tokens[i] === `</${m[1]}>` ? "" : tokens[i++]; i++;
      return m[1] === "integer" || m[1] === "real" ? Number(raw) : unesc(raw); }
    return t;
  }
  return value();
}

// ---------------------------------------------------------------- commandes
/** Traduit une commande du portail en commande MDM Apple (RequestType). */
export function appleCommand(cmd: Command): Record<string, Plist> | null {
  const p = cmd.params as Record<string, any>;
  switch (cmd.type) {
    case "lock": return { RequestType: "DeviceLock", Message: p.message ?? "Appareil verrouillé par l'entreprise", PhoneNumber: p.phone ?? "" };
    case "wipe_full": return { RequestType: "EraseDevice", PIN: p.pin ?? "" };
    case "wipe_corporate": return { RequestType: "RemoveProfile", Identifier: p.profile_identifier ?? "fr.entreprise.mdm.enrollment" };
    case "lost_mode_on": return { RequestType: "EnableLostMode", Message: p.message ?? "Appareil perdu, merci de contacter l'entreprise", PhoneNumber: p.phone ?? "" };
    case "lost_mode_off": return { RequestType: "DisableLostMode" };
    case "locate": return { RequestType: "DeviceLocation" }; // uniquement en mode perdu (appareil supervisé)
    case "ring": return { RequestType: "PlayLostModeSound" };
    case "restart": return { RequestType: "RestartDevice" };
    case "reset_passcode": return { RequestType: "ClearPasscode" };
    case "install_app": return p.manifest_url
      ? { RequestType: "InstallApplication", ManifestURL: p.manifest_url, ManagementFlags: 1 }
      : { RequestType: "InstallApplication", iTunesStoreID: Number(p.store_id ?? 0), ManagementFlags: 1 };
    case "remove_app": return { RequestType: "RemoveApplication", Identifier: String(p.identifier) };
    case "sync_policy": return { RequestType: "ProfileList" };
    default: return null;
  }
}

/** Réveille l'appareil via APNs (HTTP/2 + certificat client MDM fourni par la liaison mTLS). */
async function pushWake(env: Env, device: Record<string, any>) {
  const ref = device.provider_ref ? JSON.parse(device.provider_ref) : null;
  if (!env.APNS || !env.APPLE_MDM_TOPIC || !ref?.token || !ref?.push_magic) return;
  await env.APNS.fetch(`https://api.push.apple.com/3/device/${ref.token}`, {
    method: "POST",
    headers: { "apns-topic": env.APPLE_MDM_TOPIC, "apns-push-type": "mdm" },
    body: JSON.stringify({ mdm: ref.push_magic }),
  });
}

export const appleMdm: Provider = {
  async dispatch(env, device) {
    await pushWake(env, device);
    return false; // la commande sera récupérée par l'appareil sur /mdm/apple/server
  },
};
