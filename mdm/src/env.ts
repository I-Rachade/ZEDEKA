/** Liaisons (bindings) et variables disponibles dans le Worker. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // Variables (wrangler.jsonc > vars)
  ORG_NAME: string;
  LOCATION_MODE: "on_demand" | "continuous";
  LOCATION_RETENTION_DAYS: string;
  AUDIT_RETENTION_DAYS: string;
  OFFLINE_ALERT_HOURS: string;
  CHECKIN_INTERVAL_SECONDS: string;
  LOST_MODE_INTERVAL_SECONDS: string;
  /** Empreinte SHA-256 (base64url) du certificat qui signe l'APK de l'agent : QR de mise en service. */
  AGENT_APK_CHECKSUM?: string;
  GEOFENCE: string;
  MIN_OS_ANDROID: string;
  MIN_OS_IOS: string;
  TOKEN_MINUTES: string;
  // Secrets (wrangler secret put …)
  JWT_SECRET: string;
  DATA_KEY: string;
  SETUP_TOKEN: string;
  NETWORK_TOKEN: string;
  // Secret partagé avec le back-office Zedeka (MDM_SSO_SECRET de zedeka-api) : ouverture de la console sans second mot de passe.
  SSO_SECRET?: string;
  AMA_ENTERPRISE?: string;
  AMA_SERVICE_ACCOUNT?: string;
  APPLE_MDM_TOPIC?: string;
  APNS?: Fetcher; // liaison mTLS (certificat push MDM Apple), optionnelle
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "user";
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
