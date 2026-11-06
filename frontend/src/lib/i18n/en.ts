import admin from "./en/admin";
import app from "./en/app";
import common from "./en/common";
import driver from "./en/driver";
import legal from "./en/legal";
import merchant from "./en/merchant";
import partner from "./en/partner";
import services from "./en/services";
import site from "./en/site";
import zed from "./en/zed";

// Dictionnaire français → anglais, par espace (commun, site public, application client, admin, partenaires, livreurs).
export const EN: Record<string, string> = { ...merchant, ...zed, ...common, ...site, ...app, ...admin, ...partner, ...driver, ...legal, ...services };
