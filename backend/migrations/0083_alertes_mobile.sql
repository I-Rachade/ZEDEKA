-- Appli mobile de l'admin : un appareil peut ne recevoir que les alertes critiques (additive).
ALTER TABLE "PushSubscription" ADD COLUMN "alarmOnly" BOOLEAN NOT NULL DEFAULT false;
