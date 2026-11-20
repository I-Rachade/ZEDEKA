/**
 * Fournisseurs de gestion (« providers »).
 *
 * Chaque appareil est géré par un canal :
 *  - agent              : application compagnon MDM (Android / iOS) qui interroge le serveur — universel, simple
 *  - android_management : Android Management API de Google (Android Enterprise, comme Intune / Workspace ONE)
 *  - apple_mdm          : protocole MDM natif d'Apple (profil d'enrôlement + APNs), comme tous les MDM du marché
 *
 * Le portail crée toujours une commande dans la table `commands` ; le provider se charge de la livrer.
 * Ajouter un nouveau canal = ajouter un fichier ici et une entrée dans PROVIDERS.
 */
import type { Env } from "../env";
import { androidManagement } from "./android-management";
import { appleMdm } from "./apple-mdm";

export const COMMANDS: Record<string, { label: string; user: boolean; destructive?: boolean }> = {
  locate:          { label: "Localiser", user: true },
  ring:            { label: "Faire sonner", user: true },
  lock:            { label: "Verrouiller", user: true },
  lost_mode_on:    { label: "Activer le mode perdu", user: true },
  lost_mode_off:   { label: "Désactiver le mode perdu", user: false },
  reset_passcode:  { label: "Réinitialiser le code", user: false },
  restart:         { label: "Redémarrer", user: false },
  sync_policy:     { label: "Synchroniser les politiques", user: false },
  install_app:     { label: "Installer une application", user: false },
  remove_app:      { label: "Désinstaller une application", user: false },
  wipe_corporate:  { label: "Effacer les données de l'entreprise", user: false, destructive: true },
  wipe_full:       { label: "Effacement complet (usine)", user: false, destructive: true },
};

export interface Command {
  id: number;
  device_id: string;
  type: string;
  params: Record<string, unknown>;
}

export interface Provider {
  /** Livre la commande. Retourne `true` si elle a été exécutée immédiatement (API synchrone). */
  dispatch(env: Env, device: Record<string, any>, cmd: Command): Promise<boolean>;
}

/** Agent compagnon : rien à pousser, l'appareil récupère ses commandes à son prochain check-in. */
const agent: Provider = { async dispatch() { return false; } };

export const PROVIDERS: Record<string, Provider> = {
  agent,
  android_management: androidManagement,
  apple_mdm: appleMdm,
};

export function providerFor(device: Record<string, any>): Provider {
  return PROVIDERS[device.management] ?? agent;
}
