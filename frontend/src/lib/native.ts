import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { tr } from "@/lib/i18n";

// Applications Android et iOS (coques Capacitor de mobile/) : le site y tourne tel quel, et y trouve en plus
// les notifications Firebase (plugin @capacitor-firebase/messaging installé dans l'application).

export const isNativeApp = () => typeof window !== "undefined" && Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform() as "android" | "ios" | "web";

type Permission = { receive: "granted" | "denied" | "prompt" | "prompt-with-rationale" };
type Notification = { data?: { url?: string } };

interface FirebaseMessagingPlugin {
  checkPermissions(): Promise<Permission>;
  requestPermissions(): Promise<Permission>;
  getToken(): Promise<{ token: string }>;
  deleteToken(): Promise<void>;
  createChannel(channel: { id: string; name: string; description?: string; importance?: 1 | 2 | 3 | 4 | 5; vibration?: boolean; visibility?: -1 | 0 | 1 }): Promise<void>;
  addListener(event: "notificationActionPerformed", fn: (e: { notification: Notification }) => void): Promise<PluginListenerHandle>;
  addListener(event: "tokenReceived", fn: (e: { token: string }) => void): Promise<PluginListenerHandle>;
}

export const FirebaseMessaging = registerPlugin<FirebaseMessagingPlugin>("FirebaseMessaging");

// Le canal des alertes, au même nom que dans l'API (backend/src/fcm.ts) : son, vibration, visible écran verrouillé.
export async function createAlertChannel() {
  if (nativePlatform() !== "android") return;
  await FirebaseMessaging.createChannel({ id: "alertes", name: tr("Alertes Zedeka"), description: tr("Nouvelles courses et commandes"), importance: 5, vibration: true, visibility: 1 });
}

// Toucher une notification ouvre la page qu'elle désigne (sur le même site seulement).
export function openNotificationTarget() {
  if (!isNativeApp()) return () => {};
  const handle = FirebaseMessaging.addListener("notificationActionPerformed", ({ notification }) => {
    const url = notification.data?.url;
    if (url && url.startsWith("/") && !url.startsWith("//")) window.location.assign(url);
  });
  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}
