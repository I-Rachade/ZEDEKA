-- Schéma initial de la plateforme MDM (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  password_hash TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Jetons d'enrôlement (QR code, lien, ou émis automatiquement à la connexion réseau)
CREATE TABLE enrollment_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash    TEXT NOT NULL UNIQUE,
  label         TEXT,
  owner_user_id INTEGER REFERENCES users(id),
  platform      TEXT CHECK (platform IN ('android', 'ios', 'any')) DEFAULT 'any',
  ownership     TEXT CHECK (ownership IN ('entreprise', 'personnel')) DEFAULT 'entreprise',
  max_uses      INTEGER NOT NULL DEFAULT 1,
  uses          INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manuel',   -- manuel | réseau
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE devices (
  id                TEXT PRIMARY KEY,               -- UUID
  name              TEXT NOT NULL,
  platform          TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  management        TEXT NOT NULL DEFAULT 'agent',  -- agent | android_management | apple_mdm
  provider_ref      TEXT,                           -- ex. enterprises/x/devices/y ou UDID Apple
  model             TEXT,
  os_version        TEXT,
  serial            TEXT,
  imei_enc          TEXT,                           -- chiffré AES-GCM
  wifi_mac          TEXT,
  owner_user_id     INTEGER REFERENCES users(id),
  ownership         TEXT NOT NULL DEFAULT 'entreprise',
  status            TEXT NOT NULL DEFAULT 'actif',  -- en_attente | actif | perdu | effacé | retiré
  lost_mode         INTEGER NOT NULL DEFAULT 0,
  battery           INTEGER,
  storage_used_pct  INTEGER,
  data_usage_mb     INTEGER,
  encrypted         INTEGER,
  passcode_set      INTEGER,
  rooted            INTEGER,
  supervised        INTEGER,
  compliant         INTEGER NOT NULL DEFAULT 1,
  compliance_issues TEXT NOT NULL DEFAULT '[]',     -- JSON
  agent_token_hash  TEXT UNIQUE,
  last_seen         TEXT,
  enrolled_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_devices_owner ON devices(owner_user_id);
CREATE INDEX idx_devices_mac ON devices(wifi_mac);

-- File de commandes à distance (verrouillage, effacement, localisation, apps…)
CREATE TABLE commands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  params      TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'en_file',  -- en_file | envoyée | terminée | échec | annulée
  created_by  TEXT NOT NULL,
  reason      TEXT,
  result      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  sent_at     TEXT,
  done_at     TEXT
);
CREATE INDEX idx_commands_device ON commands(device_id, status);

-- Catalogue d'applications de l'entreprise
CREATE TABLE apps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  identifier   TEXT NOT NULL,                  -- package Android ou bundle ID iOS
  platform     TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  version      TEXT,
  category     TEXT,
  source       TEXT NOT NULL DEFAULT 'store',  -- store | entreprise
  download_url TEXT,
  mandatory    INTEGER NOT NULL DEFAULT 0,     -- installée d'office sur tout le parc
  blocked      INTEGER NOT NULL DEFAULT 0,     -- interdite (liste noire)
  UNIQUE (identifier, platform)
);

-- Inventaire des applications remonté par les appareils
CREATE TABLE device_apps (
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  identifier  TEXT NOT NULL,
  name        TEXT,
  version     TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (device_id, identifier)
);

-- Politiques (mot de passe, restrictions, conformité). scope = all | android | ios
CREATE TABLE policies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  scope      TEXT NOT NULL DEFAULT 'all',
  settings   TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (type, scope)
);

-- Historique de localisation : coordonnées chiffrées, purgé selon la durée de conservation
CREATE TABLE locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  payload    TEXT NOT NULL,
  source     TEXT,
  located_at TEXT NOT NULL
);
CREATE INDEX idx_locations_device ON locations(device_id, located_at);

CREATE TABLE alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT REFERENCES devices(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('critique', 'haute', 'moyenne', 'info')),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ouverte',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  closed_at   TEXT
);
CREATE INDEX idx_alerts_open ON alerts(device_id, type, status);

CREATE TABLE audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT,
  reason  TEXT,
  ip      TEXT
);

-- Événements remontés par le contrôleur Wi-Fi / RADIUS / NAC
CREATE TABLE network_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  mac       TEXT NOT NULL,
  ip        TEXT,
  ssid      TEXT,
  username  TEXT,
  decision  TEXT NOT NULL,          -- autoriser | quarantaine | enrôlement
  device_id TEXT,
  at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Politiques par défaut
INSERT INTO policies (type, scope, settings) VALUES
 ('passcode', 'all', '{"min_length":6,"require_alphanumeric":false,"max_failed_attempts":10,"max_age_days":90,"auto_lock_minutes":5,"history":3,"biometrics_allowed":true}'),
 ('restrictions', 'all', '{"camera":true,"screen_capture":true,"usb_file_transfer":false,"unknown_sources":false,"bluetooth":true}'),
 ('compliance', 'all', '{"require_encryption":true,"require_passcode":true,"block_rooted":true,"min_os_android":"10","min_os_ios":"16","quarantine_noncompliant":true}');
