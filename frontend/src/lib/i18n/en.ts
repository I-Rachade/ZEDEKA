import admin from "./en/admin";
import app from "./en/app";
import common from "./en/common";
import driver from "./en/driver";
import legal from "./en/legal";
import partner from "./en/partner";
import site from "./en/site";

// Dictionnaire français → anglais, par espace (commun, site public, application client, admin, partenaires, livreurs).
export const EN: Record<string, string> = { ...common, ...site, ...app, ...admin, ...partner, ...driver, ...legal };
