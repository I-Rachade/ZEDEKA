-- Numéro WhatsApp de Zedeka modifiable dans les réglages de l'admin, sans redéployer (additive).
-- Vide : la variable ZEDEKA_WHATSAPP du Worker reste utilisée.
ALTER TABLE "Settings" ADD COLUMN "zedekaWhatsapp" TEXT NOT NULL DEFAULT '';
