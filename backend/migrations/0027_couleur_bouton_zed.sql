-- Couleur du bouton Zed au milieu de la barre de l'appli client, choisie dans les Réglages de l'admin.
-- SUN (jaune), GREEN (vert Zedeka), CORAL (corail) ou INK (vert foncé). Migration additive.
ALTER TABLE "Settings" ADD COLUMN "zedButtonColor" TEXT NOT NULL DEFAULT 'SUN';
