import admin from "./en/admin";
import app from "./en/app";
import chat from "./en/chat";
import common from "./en/common";
import courses from "./en/courses";
import crm from "./en/crm";
import driver from "./en/driver";
import favorites from "./en/favorites";
import hr from "./en/hr";
import lease from "./en/lease";
import logistics from "./en/logistics";
import school from "./en/school";
import charging from "./en/charging";
import riderFinance from "./en/riderFinance";
import legal from "./en/legal";
import merchant from "./en/merchant";
import partner from "./en/partner";
import services from "./en/services";
import site from "./en/site";
import store from "./en/store";
import screen from "./en/screen";
import zed from "./en/zed";

// Dictionnaire français → anglais, par espace (commun, site public, application client, admin, partenaires, livreurs).
export const EN: Record<string, string> = { ...merchant, ...zed, ...common, ...site, ...app, ...admin, ...partner, ...driver, ...legal, ...services, ...favorites, ...store, ...chat, ...crm, ...lease, ...courses, ...school, ...hr, ...screen, ...logistics, ...charging, ...riderFinance };
